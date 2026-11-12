import { botOrganizesNews } from "../core/bot-mode.mjs";

export function createNewsOrganizationService({ getSettings, organizeNative, organizeBot, summarizeNative, getStatus, onComplete = async () => {} }) {
  let tail = Promise.resolve(), batch = null;
  const singles = new Map();
  const serialize = operation => { const next = tail.then(operation); tail = next.catch(() => {}); return next; };
  return { start, summarize, wait: () => tail, isRunning: () => Boolean(batch) };

  async function start(options = {}) {
    if (botOrganizesNews(await getSettings())) return organizeBot(options);
    if (batch) return { started: false, status: await getStatus() };
    batch = serialize(async () => {
      await organizeNative(options);
      if (options.allowDigest) await onComplete();
    });
    batch.finally(() => { batch = null; }).catch(() => {});
    return { started: true, status: await getStatus() };
  }
  function summarize(body) {
    const key = `${body.sourceKey}|${body.articleId || body.url}`;
    if (singles.has(key)) return singles.get(key);
    const operation = serialize(async () => botOrganizesNews(await getSettings())
      ? organizeBot({ item: body }) : summarizeNative(body));
    singles.set(key, operation);
    operation.finally(() => singles.delete(key)).catch(() => {});
    return operation;
  }
}
