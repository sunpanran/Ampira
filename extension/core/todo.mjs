export const TODO_ITEM_LIMIT = 50;
export const TODO_TEXT_LIMIT = 120;

export function normalizeTodoItems(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = normalizeTodoId(item.id);
    const text = normalizeTodoText(item.text, TODO_TEXT_LIMIT, true);
    const createdAt = normalizeTodoDate(item.createdAt);
    if (!id || !text || !createdAt || seen.has(id)) continue;
    const completed = item.completed === true;
    const completedAt = completed ? normalizeTodoDate(item.completedAt) : "";
    if (completed && !completedAt) continue;
    seen.add(id);
    normalized.push({ id, text, completed, createdAt, completedAt });
    if (normalized.length >= TODO_ITEM_LIMIT) break;
  }
  return normalized;
}

export function normalizeTodoId(value) {
  const id = String(value ?? "").trim();
  if (Array.from(id).length > 100) return "";
  return id && /^[\p{L}\p{N}._:-]+$/u.test(id) ? id : "";
}

export function normalizeTodoDate(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

export function normalizeTodoText(value, maxLength = TODO_TEXT_LIMIT, strict = false) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const characters = Array.from(text);
  if (strict && characters.length > maxLength) return "";
  return characters.slice(0, maxLength).join("");
}
