import path from "node:path";
import os from "node:os";
import { ensureLocalService, callBridge } from "./launcher.mjs";
import { serveStdio } from "./mcp.mjs";

try {
  const args = process.argv.slice(2);
  let directory = path.join(os.homedir(), ".ampira-mcp"), port = 43123;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--data-dir" && args[index + 1]) directory = path.resolve(args[++index]);
    else if (args[index] === "--port" && args[index + 1]) port = Number(args[++index]);
    else throw new Error("invalid-arguments");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid-port");
  const connection = await ensureLocalService(directory, port);
  await serveStdio(message => callBridge(connection, "/rpc", message));
} catch { process.stderr.write("Ampira MCP could not connect. Check the local service and configuration.\n"); process.exitCode = 1; }
