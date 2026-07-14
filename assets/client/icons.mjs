const FILLED_BOOKMARK_ICON = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path fill="#000" d="M6.5 2A2.5 2.5 0 0 0 4 4.5v16.25a1 1 0 0 0 1.57.82L12 17l6.43 4.57a1 1 0 0 0 1.57-.82V4.5A2.5 2.5 0 0 0 17.5 2h-11Z"/>
  </svg>
`)}`;

const OUTLINE_BOOKMARK_ICON = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5v16L12 16l-7 4.5v-16A1.5 1.5 0 0 1 6.5 3Z"/>
  </svg>
`)}`;

const CHECKMARK_ICON = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 12.5 4.2 4.2L19 7"/>
  </svg>
`)}`;

const ICON_URLS = {
  "arrow-up-right": "/assets/icons/arrow-up-right.svg",
  bookmark: "/assets/icons/bookmark.svg",
  "bookmark-filled": FILLED_BOOKMARK_ICON,
  calendar: "/assets/icons/calendar.svg",
  check: "/assets/icons/check.svg",
  clock: "/assets/icons/clock.svg",
  cloud: "/assets/icons/cloud.svg",
  "cloud-drizzle": "/assets/icons/cloud-drizzle.svg",
  "cloud-fog": "/assets/icons/cloud-fog.svg",
  "cloud-lightning": "/assets/icons/cloud-lightning.svg",
  "cloud-rain": "/assets/icons/cloud-rain.svg",
  "cloud-snow": "/assets/icons/cloud-snow.svg",
  "cloud-sun": "/assets/icons/cloud-sun.svg",
  "copy-01": "/assets/icons/copy-01.svg",
  "database-01": "/assets/icons/database-01.svg",
  eye: "/assets/icons/eye.svg",
  "eye-off": "/assets/icons/eye-off.svg",
  "file-search-01": "/assets/icons/file-search-01.svg",
  "filter-lines": "/assets/icons/filter-lines.svg",
  folder: "/assets/icons/folder.svg",
  "info-circle": "/assets/icons/info-circle.svg",
  "key-01": "/assets/icons/key-01.svg",
  "link-external-01": "/assets/icons/link-external-01.svg",
  "message-question-circle": "/assets/icons/message-question-circle.svg",
  "monitor-01": "/assets/icons/monitor-01.svg",
  "moon-01": "/assets/icons/moon-01.svg",
  palette: "/assets/icons/palette.svg",
  plus: "/assets/icons/plus.svg",
  "refresh-cw-01": "/assets/icons/refresh-cw-01.svg",
  "rss-01": "/assets/icons/rss-01.svg",
  "save-01": "/assets/icons/save-01.svg",
  "search-lg": "/assets/icons/search-lg.svg",
  "server-01": "/assets/icons/server-01.svg",
  "settings-01": "/assets/icons/settings-01.svg",
  "shuffle-01": "/assets/icons/shuffle-01.svg",
  "slash-circle-01": "/assets/icons/slash-circle-01.svg",
  "stars-01": "/assets/icons/stars-01.svg",
  sun: "/assets/icons/sun.svg",
  "trash-01": "/assets/icons/trash-01.svg",
  "x-close": "/assets/icons/x-close.svg",
  zap: "/assets/icons/flash.svg",
};

const ICON_ALIASES = {
  block: "slash-circle-01",
  "bookmark-ribbon": "bookmark",
  checkmark: "check",
  close: "x-close",
  code: "database-01",
  copy: "copy-01",
  data: "database-01",
  database: "database-01",
  "delete-sign": "x-close",
  external: "link-external-01",
  "external-link": "link-external-01",
  image: "stars-01",
  info: "info-circle",
  news: "rss-01",
  "paint-palette": "palette",
  restart: "refresh-cw-01",
  search: "search-lg",
  settings: "settings-01",
  shuffle: "shuffle-01",
  shopping: "bookmark",
  "shopping-bag": "bookmark",
  spark: "stars-01",
  sparkling: "stars-01",
  star: "stars-01",
  sync: "refresh-cw-01",
  synchronize: "refresh-cw-01",
  time: "clock",
  trash: "trash-01",
  video: "rss-01",
};

const THEMED_ICON_URLS = {
  bookmark: OUTLINE_BOOKMARK_ICON,
  "bookmark-filled": FILLED_BOOKMARK_ICON,
  check: CHECKMARK_ICON,
};

function iconKey(name) {
  const normalized = String(name || "info-circle").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const key = ICON_ALIASES[normalized] || normalized || "info-circle";
  return ICON_URLS[key] ? key : "info-circle";
}

export function createIcon(name, className) {
  const key = iconKey(name);
  const icon = document.createElement("img");
  icon.className = `${className || "inline-icon"} industrial-icon untitled-icon icon-${key}`;
  icon.src = ICON_URLS[key];
  icon.alt = "";
  icon.decoding = "async";
  icon.loading = "eager";
  icon.referrerPolicy = "no-referrer";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function createThemedIcon(name, className) {
  const key = iconKey(name);
  const icon = document.createElement("span");
  icon.className = `${className || "inline-icon"} industrial-icon themed-icon icon-${key}`;
  icon.style.setProperty("--themed-icon-mask", `url("${THEMED_ICON_URLS[key] || ICON_URLS[key]}")`);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((icon) => {
    const key = iconKey(icon.dataset.icon);
    icon.src = ICON_URLS[key];
    icon.alt = "";
    icon.decoding = "async";
    icon.loading = "eager";
    icon.referrerPolicy = "no-referrer";
    icon.classList.add("industrial-icon", "untitled-icon", `icon-${key}`);
    icon.setAttribute("aria-hidden", "true");
  });
}
