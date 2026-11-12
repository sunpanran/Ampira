export function createSummarySessionOrder() {
  let mode, positions = new Map(), next = 0;
  return {
    arrange(items, order) {
      if (mode !== order) { mode = order; positions = new Map(); next = 0; }
      for (const item of items) if (!positions.has(item.key)) positions.set(item.key, next++);
      return [...items].sort((a, b) => positions.get(a.key) - positions.get(b.key));
    },
  };
}
