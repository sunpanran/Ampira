export function orderPresetInspiration(items, { seed = "", shuffle } = {}) {
  const source = Array.isArray(items) ? items.filter((item) => item?.sourceKind === "preset") : [];
  if (!source.length) return [];
  const shuffleItems = typeof shuffle === "function" ? shuffle : (values) => [...values];
  const coverGroups = new Map();
  for (const item of source) {
    const cover = String(item.coverAsset || item.coverKey || "");
    if (!coverGroups.has(cover)) coverGroups.set(cover, []);
    coverGroups.get(cover).push(item);
  }
  const firstByCategory = new Map();
  const remainder = [];
  for (const [cover, group] of coverGroups) {
    const ordered = shuffleItems(group, `${seed}.cover.${cover}`);
    const first = ordered[0];
    const category = String(first?.categoryKey || first?.category || "");
    if (!firstByCategory.has(category)) firstByCategory.set(category, []);
    firstByCategory.get(category).push(first);
    remainder.push(...ordered.slice(1));
  }
  for (const [category, group] of firstByCategory) {
    firstByCategory.set(category, shuffleItems(group, `${seed}.category.${category}`));
  }
  const categoryOrder = shuffleItems([...firstByCategory.keys()], `${seed}.categories`);
  const uniqueCoversFirst = interleaveCategories(firstByCategory, categoryOrder, 5);
  return [...uniqueCoversFirst, ...orderRemainder(remainder, uniqueCoversFirst, seed, shuffleItems)];
}

function interleaveCategories(groups, categories, pageSize) {
  const output = [];
  let remaining = [...groups.values()].reduce((total, group) => total + group.length, 0);
  let cursor = 0;
  while (remaining > 0) {
    const pageCategories = new Set();
    const pageTarget = Math.min(pageSize, remaining);
    while (pageCategories.size < pageTarget) {
      const category = findAvailableCategory(groups, categories, cursor, pageCategories);
      if (!category) break;
      output.push(groups.get(category).shift());
      pageCategories.add(category);
      remaining -= 1;
      cursor = (categories.indexOf(category) + 1) % Math.max(1, categories.length);
    }
    while (output.length % pageSize && remaining > 0) {
      const category = findAvailableCategory(groups, categories, cursor, new Set());
      if (!category) break;
      output.push(groups.get(category).shift());
      remaining -= 1;
      cursor = (categories.indexOf(category) + 1) % Math.max(1, categories.length);
    }
    cursor = (cursor + pageSize) % Math.max(1, categories.length);
  }
  return output;
}

function findAvailableCategory(groups, categories, cursor, excluded) {
  for (let offset = 0; offset < categories.length; offset += 1) {
    const category = categories[(cursor + offset) % categories.length];
    if (!excluded.has(category) && groups.get(category)?.length) return category;
  }
  return "";
}

function orderRemainder(items, output, seed, shuffleItems) {
  const pool = shuffleItems(items, `${seed}.remainder`);
  const ordered = [];
  while (pool.length) {
    const combined = [...output, ...ordered];
    const pageCount = combined.length % 5;
    const page = pageCount ? combined.slice(-pageCount) : [];
    const covers = new Set(page.map((item) => item.coverAsset || item.coverKey));
    const categories = new Set(page.map((item) => item.categoryKey || item.category));
    let index = pool.findIndex((item) => (
      !covers.has(item.coverAsset || item.coverKey)
      && !categories.has(item.categoryKey || item.category)
    ));
    if (index < 0) index = pool.findIndex((item) => !covers.has(item.coverAsset || item.coverKey));
    if (index < 0) index = 0;
    ordered.push(pool.splice(index, 1)[0]);
  }
  return ordered;
}
