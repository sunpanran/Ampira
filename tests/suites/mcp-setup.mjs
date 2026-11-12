import assert from "node:assert/strict";
import { createMcpSetupService } from "../../extension/runtime/mcp-setup-service.mjs";

function harness() {
  const values = {}, calls = [], configurations = [];
  let enabled = true, permission = true, time = 100000, sequence = 0, afterFetch;
  const connection = { endpoint: "http://127.0.0.1:43123", boardId: "synthetic-board", hasToken: true };
  const service = createMcpSetupService({
    storage: { get: async key => ({ [key]: values[key] }), set: async data => Object.assign(values, data), remove: async key => { delete values[key]; } },
    getSettings: async () => ({ mcpEnabled: enabled }), hasOriginPermission: async () => permission,
    getExtensionId: () => "a".repeat(32), now: () => time, createCode: () => String(++sequence).repeat(64),
    botBoard: { config: async () => ({ connection }), configure: async input => { configurations.push(input); return { mcpEnabled: true, connection }; } },
    fetchContent: async (url, options) => {
      calls.push({ url, options });
      if (afterFetch) { const action = afterFetch; afterFetch = null; await action(); }
      return { response: { ok: true }, buffer: new TextEncoder().encode(JSON.stringify({ app: "ampira-local-mcp", token: "e".repeat(64) })).buffer };
    },
  });
  return { service, calls, configurations, disable: () => { enabled = false; }, deny: () => { permission = false; },
    advance: () => { time += 600001; }, interrupt: action => { afterFetch = action; } };
}
{
  const h = harness(), setup = await h.service.begin();
  assert(setup.command.includes("connect.mjs --code"));
  assert(!setup.command.includes("e".repeat(64)), "setup never exposes a long-term key");
  const result = await h.service.poll();
  assert.equal(result.status, "connected");
  assert(!JSON.stringify(result).includes("e".repeat(64)), "public pairing results contain no key");
  assert.equal(h.configurations.length, 1);
  assert.equal(h.calls[0].options.headers["X-Ampira-Extension"], "a".repeat(32));
  assert.equal((await h.service.poll()).status, "idle");
}
{
  const h = harness(); await h.service.begin(); h.advance();
  assert.equal((await h.service.poll()).status, "expired"); assert.equal(h.calls.length, 0);
}
{
  const h = harness(); h.disable(); await assert.rejects(h.service.begin(), { code: "mcpDisabled" });
  assert.equal(h.calls.length, 0);
}
{
  const h = harness(); await h.service.begin(); h.interrupt(h.disable);
  await assert.rejects(h.service.poll(), { code: "mcpDisabled" }); assert.equal(h.configurations.length, 0);
}
{
  const h = harness(); await h.service.begin(); h.interrupt(() => h.service.begin());
  assert.equal((await h.service.poll()).status, "cancelled"); assert.equal(h.configurations.length, 0);
}
{
  const h = harness(); await h.service.begin(); h.interrupt(h.advance);
  assert.equal((await h.service.poll()).status, "expired"); assert.equal(h.configurations.length, 0);
}
console.log("MCP setup tests passed");
