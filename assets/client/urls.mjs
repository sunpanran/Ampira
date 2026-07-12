const FALLBACK_FAVICON_URL = "favicon.svg";
const FAVICON_SIZE = 32;
let nativeFaviconEnabled = false;

export function setNativeFaviconEnabled(value) {
  nativeFaviconEnabled = value === true;
}

export function faviconUrl(item, {
  runtime = globalThis.chrome?.runtime,
  nativeEnabled = nativeFaviconEnabled,
} = {}) {
  const pageUrl = httpUrl(item?.url);
  if (nativeEnabled && pageUrl && runtime?.id && typeof runtime.getURL === "function") {
    try {
      const url = new URL(runtime.getURL("/_favicon/"));
      if (url.protocol === "chrome-extension:") {
        url.searchParams.set("pageUrl", pageUrl);
        url.searchParams.set("size", String(FAVICON_SIZE));
        return url.href;
      }
    } catch {
      // Use the packaged fallback when Chrome cannot construct its favicon URL.
    }
  }
  return FALLBACK_FAVICON_URL;
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

export function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => parsed.searchParams.delete(key));
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const host = parsed.host.replace(/^www\./, "");
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return "";
  }
}

export function isHttpUrl(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function isReaderUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      || parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
