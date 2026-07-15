export async function copyText(text, options = {}) {
  const value = String(text || "");
  if (!value.trim()) return false;
  const clipboard = options.clipboard || globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the local selection fallback.
    }
  }
  const doc = options.document || globalThis.document;
  if (!doc?.body?.append || typeof doc.execCommand !== "function") return false;
  const input = doc.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  doc.body.append(input);
  input.select();
  try {
    return doc.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    input.remove();
  }
}
