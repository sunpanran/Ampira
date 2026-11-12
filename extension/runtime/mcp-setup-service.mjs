import { fetchBounded } from "../core/network.mjs";
import { BOT_DEFAULT_ENDPOINT, BOT_LOCAL_ORIGIN, botError, normalizeBotConnection } from "../core/bot-board.mjs";
import { mcpIsEnabled } from "../core/bot-mode.mjs";

const SETUP_KEY = "ampira.mcp.setup.v1";
const SETUP_LIFETIME = 10 * 60 * 1000;

export function createMcpSetupService({ storage, getSettings, hasOriginPermission, getExtensionId, botBoard,
  fetchContent = fetchBounded, now = () => Date.now(), createCode = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("") }) {
  let pollPromise;
  const saved = async () => (await storage.get(SETUP_KEY))[SETUP_KEY];
  async function allowed() {
    if (!mcpIsEnabled(await getSettings())) throw botError("mcpDisabled");
    if (!await hasOriginPermission(BOT_LOCAL_ORIGIN)) throw botError("permissionRequired");
  }
  const cancel = () => storage.remove(SETUP_KEY);
  async function begin() {
    await allowed();
    const extensionId = getExtensionId();
    if (!/^[a-p]{32}$/.test(extensionId)) throw botError("invalidData");
    const config = await botBoard.config();
    const endpoint = normalizeBotConnection({ endpoint: config.connection?.endpoint || BOT_DEFAULT_ENDPOINT }).endpoint;
    const setup = { code: createCode(), extensionId, endpoint, expiresAt: now() + SETUP_LIFETIME };
    await storage.set({ [SETUP_KEY]: setup });
    return { expiresAt: setup.expiresAt, command: `node integrations/local-mcp/connect.mjs --code ${setup.code} --extension ${extensionId} --expires ${setup.expiresAt} --port ${new URL(endpoint).port}` };
  }
  async function check() {
    await allowed();
    const setup = await saved();
    if (!setup) return { status: "idle" };
    if (setup.expiresAt <= now()) { await cancel(); return { status: "expired" }; }
    try {
      const { response, buffer } = await fetchContent(`${setup.endpoint}/pair`, {
        method: "POST", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Ampira-Extension": setup.extensionId }, body: JSON.stringify({ code: setup.code }),
      }, { timeoutMs: 2000, maxBytes: 4096 });
      await allowed();
      if ((await saved())?.code !== setup.code) return { status: "cancelled" };
      if (setup.expiresAt <= now()) { await cancel(); return { status: "expired" }; }
      if (!response.ok) return { status: "waiting" };
      const data = JSON.parse(new TextDecoder().decode(buffer));
      if (data.app !== "ampira-local-mcp" || typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token)) throw botError("invalidData");
      const configuration = await botBoard.configure({ endpoint: setup.endpoint, token: data.token, consent: true });
      if ((await saved())?.code === setup.code) await cancel();
      // A lost acknowledgement remains retryable until the short pairing window expires.
      await fetchContent(`${setup.endpoint}/pair/finish`, { method: "POST", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
        headers: { Authorization: `Bearer ${data.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ code: setup.code }) },
      { timeoutMs: 2000, maxBytes: 4096 }).catch(() => {});
      return { status: "connected", configuration };
    } catch (error) {
      if (["mcpDisabled", "permissionRequired", "connectionChanged", "invalidData"].includes(error.code)) throw error;
      return { status: "waiting" };
    }
  }
  return { begin, cancel, poll: () => {
    if (!pollPromise) pollPromise = check().finally(() => { pollPromise = null; });
    return pollPromise;
  } };
}
