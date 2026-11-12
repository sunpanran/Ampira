import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { openBoardStore } from "./board-store.mjs";
import { startBridge } from "./http-bridge.mjs";
import { startTaskRunner } from "./task-runner.mjs";

let store, bridge, runner;
let stopping;
async function close() {
  stopping ||= (async () => { await bridge?.close(); await runner?.close(); await store?.close(); })();
  return stopping;
}
try {
  const args = process.argv.slice(2);
  let directory = path.join(os.homedir(), ".ampira-mcp"), port = 43123;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--data-dir" && args[index + 1]) directory = path.resolve(args[++index]);
    else if (args[index] === "--port" && /^[1-9][0-9]{0,4}$/.test(args[index + 1] || "")) port = Number(args[++index]);
    else throw new Error("invalid-arguments");
  }
  if (port > 65535) throw new Error("invalid-port");
  store = await openBoardStore(directory);
  await store.configureEndpoint(`http://127.0.0.1:${port}`);
  const { version } = JSON.parse(await fs.readFile(new URL("../../manifest.json", import.meta.url), "utf8"));
  bridge = await startBridge(store, port, { version, onShutdown: () => { void close().finally(() => process.exit(0)); } });
  runner = await startTaskRunner(store);
  process.stderr.write(`Ampira Bot board listening at ${bridge.endpoint}. Use Settings > MCP to pair.\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void close().finally(() => process.exit(0)); });
  await new Promise(() => {});
} catch (error) {
  const code = String(error.code || error.message || "startup-failed");
  process.stderr.write(`Ampira local MCP: ${/^[a-zA-Z0-9_-]+$/.test(code) ? code : "startup-failed"}.\n`);
  process.exitCode = 1;
} finally { await close(); }
