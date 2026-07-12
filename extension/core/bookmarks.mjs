import { DEFAULT_SETTINGS } from "./constants.mjs";

export function buildBookmarkModel(tree, settings = {}) {
  const folders = topLevelFolders(tree);
  const folderNames = folders.map((folder) => clean(folder.title)).filter(Boolean);
  const newsName = pickFolderName(settings.newsBookmarkFolder, DEFAULT_SETTINGS.newsBookmarkFolder, folderNames);
  const inspirationName = pickFolderName(settings.inspirationBookmarkFolder, DEFAULT_SETTINGS.inspirationBookmarkFolder, folderNames, [newsName]);
  const extras = uniqueStrings(settings.bookmarkOnlyFolders).filter((name) => ![newsName, inspirationName].includes(name));
  const specs = [
    { name: newsName, cardType: "news" },
    { name: inspirationName, cardType: "inspiration" },
    ...extras.map((name) => ({ name, cardType: "bookmark" })),
  ].filter((spec) => spec.name);
  const bookmarks = [];
  const sections = [];
  for (const spec of specs) {
    const folder = folders.find((candidate) => clean(candidate.title) === spec.name);
    if (!folder) {
      sections.push({ name: spec.name, cardType: spec.cardType, missing: true, categories: [] });
      continue;
    }
    const start = bookmarks.length;
    collectFolder(folder, spec, bookmarks, [], settings, new Map());
    const sectionItems = bookmarks.slice(start);
    const categoryCounts = new Map();
    for (const item of sectionItems) categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
    sections.push({
      name: spec.name,
      cardType: spec.cardType,
      categories: Array.from(categoryCounts, ([name, count]) => ({ name, count })),
    });
  }
  return {
    folderOptions: folderNames.map((name) => ({ name })),
    sections,
    bookmarks,
    availableNewsFolders: availableFolders(sections, bookmarks, newsName),
    missingFolders: sections.filter((section) => section.missing).map((section) => section.name),
  };
}

export function originsFromUrls(urls) {
  const origins = new Set();
  for (const value of urls || []) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:") origins.add(`${url.origin}/*`);
      if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) origins.add(`${url.origin}/*`);
    } catch {
      // Invalid bookmark URLs remain visible as bookmark-only entries.
    }
  }
  return [...origins].sort();
}

export function inspirationPreviewSourceUrls(bookmarks) {
  return [...new Set(inspirationPreviewTargets(bookmarks).map((item) => item.url))];
}

export function inspirationPreviewTargets(bookmarks) {
  return (Array.isArray(bookmarks) ? bookmarks : [])
    .filter((item) => item?.cardType === "inspiration")
    .map((item) => ({
      url: String(item?.url || "").trim(),
      title: clean(item?.title),
    }))
    .filter((item) => item.url);
}

function topLevelFolders(tree) {
  const root = Array.isArray(tree) ? tree[0] : tree;
  const containers = root?.children || [];
  const folders = [];
  for (const container of containers) {
    if (!container?.url && Array.isArray(container.children)) {
      for (const child of container.children) if (!child?.url) folders.push(child);
    }
  }
  if (!folders.length) for (const child of containers) if (!child?.url) folders.push(child);
  return folders;
}

function collectFolder(folder, spec, output, pathParts, settings, categoryCounts) {
  const children = Array.isArray(folder.children) ? folder.children : [];
  const folderPart = clean(folder.title);
  const nextPath = pathParts.length || folderPart === spec.name ? pathParts : [...pathParts, folderPart];
  const directCategory = nextPath[0] || spec.name;
  for (const child of children) {
    if (!child?.url) continue;
    const category = directCategory;
    const current = categoryCounts.get(category) || 0;
    const limit = spec.cardType === "news" ? normalizeLimit(settings.newsEntriesPerCategory, 12) : Infinity;
    if (current >= limit) continue;
    categoryCounts.set(category, current + 1);
    output.push(bookmarkItem(child, spec, category, nextPath, settings));
  }
  for (const child of children) {
    if (child?.url) continue;
    collectFolder(child, spec, output, [...nextPath, clean(child.title)].filter(Boolean), settings, categoryCounts);
  }
}

function bookmarkItem(node, spec, category, pathParts, settings) {
  const url = String(node.url || "").trim();
  const host = hostOf(url);
  const folderPath = pathParts.filter(Boolean).join("/") || category;
  return {
    key: `bookmark-${hashText(url || `${spec.name}:${node.id}`)}`,
    bookmarkId: String(node.id || ""),
    title: clean(node.title) || host || url,
    url,
    host,
    section: spec.name,
    category,
    folderPath,
    cardType: spec.cardType,
    dateAdded: Number(node.dateAdded || 0),
    feedExcluded: isExcluded({ url, host, section: spec.name, category, folderPath }, settings.excludedNewsSources),
  };
}

function availableFolders(sections, bookmarks, newsName) {
  const section = sections.find((item) => item.name === newsName && item.cardType === "news");
  if (!section) return [];
  return section.categories.map((category) => {
    const item = bookmarks.find((candidate) => candidate.section === newsName && candidate.category === category.name);
    const folderPath = item?.folderPath || category.name;
    return {
      type: "folder",
      section: newsName,
      category: category.name,
      folderPath,
      value: `${newsName}/${folderPath}`,
      title: `${newsName} / ${folderPath}`,
      count: category.count,
    };
  });
}

function isExcluded(item, exclusions) {
  return (Array.isArray(exclusions) ? exclusions : []).some((entry) => {
    const value = String(entry?.value || entry?.host || entry?.url || "").trim().toLowerCase();
    if (!value) return false;
    const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
    if (entry?.type === "folder" || !isUrl && value.includes("/")) {
      const target = `${item.section}/${item.folderPath}`.toLowerCase();
      return target === value || target.startsWith(`${value}/`);
    }
    const host = value.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
    return item.host === host || item.host.endsWith(`.${host}`);
  });
}

function pickFolderName(saved, preferred, names, excluded = []) {
  const unavailable = new Set(excluded.filter(Boolean));
  const value = clean(saved);
  if (value && names.includes(value) && !unavailable.has(value)) return value;
  if (names.includes(preferred) && !unavailable.has(preferred)) return preferred;
  const fallback = names.find((name) => !unavailable.has(name));
  if (fallback) return fallback;
  if (value && !unavailable.has(value)) return value;
  return preferred && !unavailable.has(preferred) ? preferred : "";
}

function normalizeLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number === 0 ? Infinity : Math.max(1, Math.min(100, Math.floor(number)));
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

export function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
