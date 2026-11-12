import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeBotConnection } from "../../extension/core/bot-board.mjs";

export async function localConnection(directory) {
  const file = path.join(directory, "connection.json"), info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("invalid-local-connection");
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  if (!/^[a-f0-9]{64}$/.test(value.token)) throw new Error("invalid-local-connection");
  return { ...normalizeBotConnection(value), token: value.token };
}
export async function callBridge(connection, route, body) {
  const response = await fetch(connection.endpoint + route, { method: body === undefined ? "GET" : "POST", redirect: "error",
    headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("local-service-unavailable");
  return response.status === 202 ? null : response.json();
}
export async function ensureLocalService(directory, port = 43123) {
  const endpoint = normalizeBotConnection({ endpoint: `http://127.0.0.1:${port}` }).endpoint;
  const healthy = async () => {
    try {
      const connection = await localConnection(directory);
      if (connection.endpoint !== endpoint) return null;
      const status = await callBridge(connection, "/health");
      return status.app === "ampira-local-mcp" ? connection : null;
    } catch { return null; }
  };
  let connection = await healthy();
  if (connection) return connection;
  const child = spawn(process.execPath, [fileURLToPath(new URL("server.mjs", import.meta.url)), "--data-dir", directory, "--port", String(port)],
    { detached: true, windowsHide: true, stdio: "ignore" });
  let failed = false;
  child.on("error", () => { failed = true; }); child.unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(200);
    connection = await healthy();
    if (connection) return connection;
    if (failed) break;
  }
  throw new Error("service-start-failed-check-port-or-lock");
}
