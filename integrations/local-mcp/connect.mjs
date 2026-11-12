import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { savePairing } from "./pairing.mjs";
import { callBridge, ensureLocalService, localConnection } from "./launcher.mjs";

try {
  const args = process.argv.slice(2), values = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--stop") values.stop = true;
    else if (["--code", "--extension", "--expires", "--port", "--data-dir", "--runner", "--codex-path"].includes(args[index]) && args[index + 1]) values[args[index].slice(2)] = args[++index];
    else throw new Error("invalid-arguments");
  }
  const directory = values["data-dir"] ? path.resolve(values["data-dir"]) : path.join(os.homedir(), ".ampira-mcp");
  if (values.stop) {
    await callBridge(await localConnection(directory), "/shutdown", {});
    console.log("Ampira local service stopped.");
  } else {
    if (values.code) await savePairing(directory, { code: values.code, extensionId: values.extension, expiresAt: Number(values.expires) });
    else if (!values.runner) throw new Error("invalid-arguments");
    const port = Number(values.port || 43123);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid-port");
    const connection = await ensureLocalService(directory, port);
    if (values.runner) {
      if (!["codex", "manual"].includes(values.runner)) throw new Error("invalid-runner");
      if (!(await callBridge(connection, "/health")).automaticTasks) throw new Error("restart-local-service-required");
      const executable = values.runner === "codex" ? await findCodex(values["codex-path"]) : undefined;
      await callBridge(connection, "/runner/config", { mode: values.runner, ...(executable ? { executable } : {}) });
    }
    console.log(JSON.stringify({ status: "local-service-ready", browser: "Return to the Ampira MCP settings page to finish automatic pairing.",
      mcpServer: { name: "ampira", command: process.execPath, args: [fileURLToPath(new URL("client.mjs", import.meta.url)), "--data-dir", directory, "--port", String(port)] },
      next: "Register this stdio server in the current AI client. Reload MCP if required and verify tools/list before claiming that AI tools are connected. Never read or print the pairing key." }, null, 2));
  }
} catch (error) { console.error(`Ampira connection: ${/^[a-zA-Z0-9_-]+$/.test(error.message) ? error.message : "setup-failed"}.`); process.exitCode = 1; }

async function findCodex(explicit) {
  const candidates = explicit ? [path.resolve(explicit)] : (process.env.PATH || "").split(path.delimiter)
    .filter(Boolean).map(directory => path.join(directory.replace(/^"|"$/g, ""), process.platform === "win32" ? "codex.exe" : "codex"));
  for (const candidate of candidates) {
    const info = await fs.stat(candidate).catch(() => null);
    if (info?.isFile() && (process.platform !== "win32" || path.extname(candidate).toLowerCase() === ".exe")) return candidate;
  }
  throw new Error("codex-executable-not-found");
}
