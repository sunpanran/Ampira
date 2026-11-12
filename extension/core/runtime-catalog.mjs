import keys from "./runtime-locales/keys.mjs";

// Share the key table across all three generated catalogs.
export function createRuntimeCatalog(values) {
  return Object.freeze(Object.fromEntries(keys.map((key, index) => [key, values[index]])));
}
