const ICON_URLS = {
  dashboard: "/assets/icons/dashboard.svg",
  sliders: "/assets/icons/sliders.svg",
  stocks: "/assets/icons/trending-up.svg",
  "arrow-down": "/assets/icons/arrow-down.svg",
  "arrow-up-right": "/assets/icons/arrow-up-right.svg",
  bookmark: "/assets/icons/bookmark.svg",
  "bookmark-filled": "/assets/icons/bookmark-filled.svg",
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
  coffee: "/assets/icons/coffee.svg",
  "copy-01": "/assets/icons/copy-01.svg",
  "database-01": "/assets/icons/database-01.svg",
  eye: "/assets/icons/eye.svg",
  "eye-off": "/assets/icons/eye-off.svg",
  "file-search-01": "/assets/icons/file-search-01.svg",
  "edit-05": "/assets/icons/edit-05.svg",
  "filter-lines": "/assets/icons/filter-lines.svg",
  flag: "/assets/icons/flag.svg",
  folder: "/assets/icons/folder.svg",
  github: "/assets/icons/github.svg",
  "grid-view": "/assets/icons/grid-view.svg",
  "info-circle": "/assets/icons/info-circle.svg",
  "key-01": "/assets/icons/key-01.svg",
  "keyboard-return": "/assets/icons/keyboard-return.svg",
  lightbulb: "/assets/icons/lightbulb.svg",
  "link-external-01": "/assets/icons/link-external-01.svg",
  loader: "/assets/icons/loader.svg",
  "list-check": "/assets/icons/list-check.svg",
  "message-question-circle": "/assets/icons/message-question-circle.svg",
  mcp: "/assets/icons/mcp.svg",
  minus: "/assets/icons/minus.svg",
  "more-horizontal": "/assets/icons/more-horizontal.svg",
  "monitor-01": "/assets/icons/monitor-01.svg",
  "moon-01": "/assets/icons/moon-01.svg",
  newspaper: "/assets/icons/newspaper.svg",
  palette: "/assets/icons/palette.svg",
  pin: "/assets/icons/pin.svg",
  plus: "/assets/icons/plus.svg",
  "refresh-cw-01": "/assets/icons/refresh-cw-01.svg",
  "rss-01": "/assets/icons/rss-01.svg",
  "save-01": "/assets/icons/save-01.svg",
  "search-lg": "/assets/icons/search-lg.svg",
  "send-up": "/assets/icons/send-up.svg",
  "stop-square": "/assets/icons/stop-square.svg",
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

function iconKey(name) {
  const normalized = String(name || "info-circle").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const key = ICON_ALIASES[normalized] || normalized || "info-circle";
  return ICON_URLS[key] ? key : "info-circle";
}

function setIconSource(icon, source) {
  const reveal = () => {
    icon.hidden = false;
    icon.classList.remove("is-icon-pending");
  };
  const hide = () => {
    icon.hidden = true;
    icon.classList.remove("is-icon-pending");
  };

  icon.hidden = false;
  icon.classList.add("is-icon-pending");
  icon.addEventListener("load", reveal, { once: true });
  icon.addEventListener("error", hide, { once: true });
  icon.src = source;

  if (icon.complete) {
    if (icon.naturalWidth > 0) reveal();
    else hide();
  }
}

export function createIcon(name, className) {
  const key = iconKey(name);
  const icon = document.createElement("img");
  icon.className = `${className || "inline-icon"} industrial-icon icon-${key}`;
  icon.alt = "";
  icon.decoding = "async";
  icon.loading = "eager";
  icon.referrerPolicy = "no-referrer";
  icon.setAttribute("aria-hidden", "true");
  setIconSource(icon, ICON_URLS[key]);
  return icon;
}

export function createThemedIcon(name, className) {
  const key = iconKey(name);
  const icon = document.createElement("span");
  icon.className = `${className || "inline-icon"} industrial-icon themed-icon icon-${key}`;
  icon.style.setProperty("--themed-icon-mask", `url("${ICON_URLS[key]}")`);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((icon) => {
    const key = iconKey(icon.dataset.icon);
    icon.alt = "";
    icon.decoding = "async";
    icon.loading = "eager";
    icon.referrerPolicy = "no-referrer";
    icon.classList.add("industrial-icon", `icon-${key}`);
    icon.setAttribute("aria-hidden", "true");
    setIconSource(icon, ICON_URLS[key]);
  });
}
