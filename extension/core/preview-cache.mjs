function previewIdentityUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const permittedProtocol = url.protocol === "https:"
      || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
    if (!permittedProtocol || url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function isPreviewRecord(record) {
  return String(record?.key || "").startsWith("preview-")
    || /^(?:image-preview|site-preview-)/.test(String(record?.value?.capability || ""));
}

function previewTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

export function previewCacheKeysOutsideTargets(records, targetItems) {
  const targets = (targetItems || []).map((item) => ({
    url: previewIdentityUrl(typeof item === "string" ? item : item?.url),
    title: previewTitle(typeof item === "string" ? "" : item?.title),
  })).filter((item) => item.url);
  const originTargets = new Set(targets.map((item) => item.url));
  const braveTargets = new Set(targets.map((item) => `${item.url}\n${item.title}`));
  return [...new Set((records || [])
    .filter(isPreviewRecord)
    .filter((record) => {
      const capability = String(record?.value?.capability || "");
      const url = previewIdentityUrl(record?.value?.requestedUrl);
      if (capability === "site-preview-origin") return !originTargets.has(url);
      if (capability === "site-preview-brave") {
        return !braveTargets.has(`${url}\n${previewTitle(record?.value?.title)}`);
      }
      return true;
    })
    .map((record) => String(record?.key || ""))
    .filter(Boolean))];
}

export function bravePreviewCacheKeys(records) {
  return [...new Set((records || [])
    .filter((record) => {
      const capability = String(record?.value?.capability || "");
      return capability === "site-preview-brave"
        || capability === "image-preview"
        || String(record?.key || "").startsWith("preview-brave-");
    })
    .map((record) => String(record?.key || ""))
    .filter(Boolean))];
}
