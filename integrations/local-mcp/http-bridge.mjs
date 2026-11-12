import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { digest } from "./tasks.mjs";
import { matchPairing, finishPairing } from "./pairing.mjs";
import { createMcpHandler } from "./mcp.mjs";

export async function startBridge(store, port = 43123, { onShutdown, version } = {}) {
  const expectedToken = Buffer.from(`Bearer ${store.token}`);
  const mcp = createMcpHandler(store, version);
  const server = http.createServer(async (request, response) => {
    const reply = (status, value, headers = {}) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff", "X-Ampira-Board": store.boardId, ...headers });
      response.end(value === undefined ? undefined : JSON.stringify(value));
    };
    // A random credential is mandatory even on loopback; websites cannot use this bridge.
    if (request.headers.host !== `127.0.0.1:${server.address().port}`
      || request.headers.origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(request.headers.origin)) return reply(403, { error: "accessDenied" });
    if (request.method === "POST" && request.url === "/pair") {
      try {
        const input = await readJson(request, 1024);
        const extensionId = request.headers["x-ampira-extension"];
        if (request.headers.origin && request.headers.origin !== `chrome-extension://${extensionId}`) return reply(403, { error: "accessDenied" });
        if (!await matchPairing(store.root, input.code, extensionId)) return reply(401, { error: "accessDenied" });
        return reply(200, { app: "ampira-local-mcp", token: store.token });
      } catch { return reply(400, { error: "invalidData" }); }
    }
    const actualToken = Buffer.from(request.headers.authorization || "");
    if (actualToken.length !== expectedToken.length || !timingSafeEqual(actualToken, expectedToken)) return reply(401, { error: "accessDenied" });
    try {
      if (request.method === "GET" && request.url === "/health") return reply(200, { app: "ampira-local-mcp", schemaVersion: 1, boardId: store.boardId, automaticTasks: true });
      if (request.method === "GET" && request.url === "/v1/runner.json") return reply(200, store.runnerStatus());
      if (request.method === "POST" && request.url === "/v1/runner.json") {
        const input = await readJson(request, 1024);
        if (input?.retry !== true || Object.keys(input).length !== 1) return reply(400, { error: "invalidData" });
        return reply(200, await store.retryRunner());
      }
      if (request.method === "POST" && request.url === "/runner/config") {
        // Only the local setup command can select an executable, never browser content.
        if (request.headers.origin || request.headers["sec-fetch-site"]) return reply(403, { error: "accessDenied" });
        return reply(200, await store.configureRunner(await readJson(request, 4096)));
      }
      if (request.method === "POST" && request.url === "/pair/finish") {
        await finishPairing(store.root, (await readJson(request, 1024)).code); return reply(200, { paired: true });
      }
      if (request.method === "POST" && request.url === "/rpc") {
        const result = await mcp(await readJson(request, 1024 * 1024));
        return reply(result ? 200 : 202, result || undefined);
      }
      if (request.method === "POST" && request.url === "/v1/summaries.json") {
        const input = await readJson(request, 49152), result = await store.syncSummaries(input);
        if (input.retry === true) await store.retryRunner();
        return reply(200, { ...result, runner: store.runnerStatus() });
      }
      if (request.method === "POST" && request.url === "/v1/briefs.json") {
        const input = await readJson(request, 128 * 1024);
        const result = await store.syncBrief(input);
        if (input.force && input.request) await store.retryRunner();
        return reply(200, result);
      }
      if (request.method === "POST" && request.url === "/shutdown" && onShutdown) {
        reply(200, { stopped: true }); setTimeout(onShutdown, 50); return;
      }
      const module = /^\/v1\/(today|replies)\.json$/.exec(request.url);
      const action = /^\/v1\/inbox\/([a-zA-Z0-9_-]{1,100})\.json$/.exec(request.url);
      if (request.method === "GET" && (module || action)) {
        const value = module ? store.module(module[1]) : store.action(action[1]);
        if (!value) return reply(404, { error: "missingFile" });
        const etag = `"${digest(value)}"`;
        return request.headers["if-none-match"] === etag ? reply(304, undefined, { ETag: etag }) : reply(200, value, { ETag: etag });
      }
      if (request.method === "PUT" && action) {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) return reply(415, { error: "invalidData" });
        let size = 0, content = "";
        request.setEncoding("utf8");
        for await (const chunk of request) {
          size += Buffer.byteLength(chunk);
          if (size > 65536) { reply(413, { error: "invalidData" }); request.resume(); return; }
          content += chunk;
        }
        const input = JSON.parse(content);
        if (input?.id !== action[1]) return reply(409, { error: "conflict" });
        return reply(200, await store.submit(input));
      }
      return reply(404, { error: "missingFile" });
    } catch (error) {
      const status = error.code === "conflict" ? 409 : error.code === "storage-full" ? 507 : error.code === "missingFile" ? 404 : 400;
      reply(status, { error: status === 409 ? "conflict" : status === 507 ? "storageFull" : status === 404 ? "missingFile" : "invalidData" });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { endpoint: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}

async function readJson(request, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) throw new Error("invalid-content-type");
  let size = 0, content = "";
  request.setEncoding("utf8");
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw new Error("request-too-large");
    content += chunk;
  }
  return JSON.parse(content);
}
