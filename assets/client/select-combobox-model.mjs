export function nextEnabledOptionIndex(options, startIndex, direction) {
  if (!options?.length || !direction) return -1;
  if (startIndex < 0 || startIndex >= options.length) {
    return edgeEnabledOptionIndex(options, direction < 0);
  }
  for (let step = 1; step <= options.length; step += 1) {
    const index = (startIndex + (step * direction) + options.length) % options.length;
    if (!optionUnavailable(options[index])) return index;
  }
  return -1;
}

export function edgeEnabledOptionIndex(options, fromEnd = false) {
  if (!options?.length) return -1;
  const start = fromEnd ? options.length - 1 : 0;
  const end = fromEnd ? -1 : options.length;
  const step = fromEnd ? -1 : 1;
  for (let index = start; index !== end; index += step) {
    if (!optionUnavailable(options[index])) return index;
  }
  return -1;
}

export function typeaheadOptionIndex(options, query, startIndex = -1) {
  const normalizedQuery = normalizeSearchText(query);
  if (!options?.length || !normalizedQuery) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (startIndex + step + options.length) % options.length;
    const option = options[index];
    if (!optionUnavailable(option) && optionSearchText(option).startsWith(normalizedQuery)) return index;
  }
  return -1;
}

export function optionUnavailable(option) {
  return !option || option.disabled || option.hidden || option.parentElement?.disabled === true;
}

function optionLabel(option) {
  return String(option?.label || option?.textContent || "").trim();
}

function optionSearchText(option) {
  return normalizeSearchText(optionLabel(option));
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLocaleLowerCase();
}
