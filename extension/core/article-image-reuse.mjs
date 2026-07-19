import { IMAGE_CANDIDATE_POLICY_VERSION } from "./image-candidates.mjs";
import { hashText as defaultHashText } from "./bookmarks.mjs";

const ARTICLE_REUSE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ARTICLE_REUSE_WINDOW = 12;
const ARTICLE_REUSE_MIN_COUNT = 4;
const ARTICLE_REUSE_MIN_RATIO = 0.5;
const reuseQueues = new Map();
const ARTICLE_TRACKING_PARAMETERS = new Set([
  "_hsenc", "_hsmi", "dclid", "fbclid", "gclid", "igshid", "mc_cid", "mc_eid",
  "msclkid", "vero_conv", "vero_id", "yclid",
]);

export function createArticleImageReuseFilter(adapters) {
  const now = adapters.now || Date.now;
  const hashText = adapters.hashText || defaultHashText;

  return async function filterArticleImageReuse(url, candidates, options = {}) {
    const values = Array.isArray(candidates) ? candidates : [];
    const origin = new URL(url).origin;
    return withReuseQueue(origin, async () => {
      const registryKey = `preview-image-reuse-v${IMAGE_CANDIDATE_POLICY_VERSION}-${hashText(origin)}`;
      const stored = await safeGetRecord(adapters.getRecord, registryKey);
      const cutoff = now() - ARTICLE_REUSE_RETENTION_MS;
      const observations = Array.isArray(stored?.observations)
        ? stored.observations.filter((entry) => Number(entry?.seenAt) >= cutoff)
        : [];
      const primary = values[0];
      const signature = ["metadata", "main"].includes(primary?.provenance)
        ? articleImageSignature(primary.url, hashText)
        : "";
      const pageHash = articlePageSignature(url, hashText);
      const next = observations.filter((entry) => entry.pageHash !== pageHash);
      next.push({ pageHash, signature, seenAt: now() });
      observations.splice(0, observations.length, ...next.slice(-ARTICLE_REUSE_WINDOW));
      const defaultSignatures = repeatedArticleImageSignatures(observations);
      const record = {
        capability: "site-preview-image-reuse",
        policyVersion: IMAGE_CANDIDATE_POLICY_VERSION,
        requestedUrl: `${origin}/`,
        sourceOrigin: origin,
        observations,
        checkedAt: new Date(now()).toISOString(),
        requiredOrigins: [origin],
      };
      const storeRecord = options.storeRecord || adapters.setRecord;
      try {
        await storeRecord?.(registryKey, record, "cache", options.cacheEpoch);
      } catch {
        // A live candidate remains useful when reuse history cannot be stored.
      }
      return values.filter((candidate) => (
        !["metadata", "main"].includes(candidate?.provenance)
        || !defaultSignatures.has(articleImageSignature(candidate.url, hashText))
      ));
    });
  };
}

export function repeatedArticleImageSignatures(observations) {
  const list = Array.isArray(observations) ? observations.slice(-ARTICLE_REUSE_WINDOW) : [];
  if (list.length < ARTICLE_REUSE_MIN_COUNT) return new Set();
  const counts = new Map();
  for (const entry of list) {
    const signature = String(entry?.signature || "");
    if (signature) counts.set(signature, (counts.get(signature) || 0) + 1);
  }
  return new Set([...counts.entries()]
    .filter(([, count]) => count >= ARTICLE_REUSE_MIN_COUNT && count / list.length >= ARTICLE_REUSE_MIN_RATIO)
    .map(([signature]) => signature));
}

export function articleImageSignature(value, hashText = defaultHashText) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    for (const key of [
      "crop", "fit", "format", "h", "height", "q", "quality", "w", "width", "x-oss-process",
    ]) url.searchParams.delete(key);
    url.searchParams.sort();
    return String(hashText(url.href));
  } catch {
    return "";
  }
}

export function articlePageSignature(value, hashText = defaultHashText) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith("utm_") || ARTICLE_TRACKING_PARAMETERS.has(normalizedKey)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return String(hashText(url.href));
  } catch {
    return String(hashText(String(value || "").trim()));
  }
}

async function safeGetRecord(getRecord, key) {
  try {
    return await getRecord?.(key, null);
  } catch {
    return null;
  }
}

function withReuseQueue(origin, operation) {
  const previous = reuseQueues.get(origin) || Promise.resolve();
  const request = previous.catch(() => {}).then(operation).finally(() => {
    if (reuseQueues.get(origin) === request) reuseQueues.delete(origin);
  });
  reuseQueues.set(origin, request);
  return request;
}
