export async function recoverInspirationImage(options = {}) {
  const isCurrent = typeof options.isCurrent === "function" ? options.isCurrent : () => false;
  if (!isCurrent()) return "stale";
  let next = null;
  try {
    next = typeof options.reject === "function" ? await options.reject() : null;
  } catch {
    next = null;
  }
  if (!isCurrent()) return "replaced";
  const nextUrl = String(next?.imageUrl || "").trim();
  if (nextUrl && nextUrl !== String(options.failedUrl || "").trim()) {
    options.renderNext?.(nextUrl);
    return "next";
  }
  options.renderFallback?.();
  return "fallback";
}
