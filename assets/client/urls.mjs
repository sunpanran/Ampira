export function faviconUrl(item) {
  const candidate = String(item?.faviconUrl || "").trim();
  if (candidate) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return url.href;
    } catch {
      // Use the packaged fallback for malformed or insecure favicon URLs.
    }
  }
  return "favicon.svg";
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
