export function cleanTitleText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function textLength(value) {
  return Array.from(String(value || "")).length;
}

export function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function similarityScore(left, right) {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (!shorter || shorter.length < 8) return 0;
  let matches = 0;
  const used = new Set();
  for (const char of Array.from(shorter)) {
    const index = Array.from(longer).findIndex((candidate, i) => candidate === char && !used.has(i));
    if (index >= 0) {
      used.add(index);
      matches += 1;
    }
  }
  return matches / Array.from(shorter).length;
}
