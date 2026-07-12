export const DEFAULT_ACCENT_THEME = "violet";
export const DEFAULT_CUSTOM_ACCENT_COLOR = "#9152FF";
export const DEFAULT_COLOR_MODE = "dark";
export const ACCENT_THEMES = Object.freeze({
  violet: "#9152FF",
  cyan: "#06B6D4",
  emerald: "#10B981",
  amber: "#D99A18",
  rose: "#E0526E",
});

export function normalizeAccentTheme(value) {
  const theme = String(value || "").trim().toLowerCase();
  return theme === "custom" || Object.hasOwn(ACCENT_THEMES, theme) ? theme : DEFAULT_ACCENT_THEME;
}

export function normalizeColorMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "system" || mode === "dark" || mode === "light" ? mode : DEFAULT_COLOR_MODE;
}

export function normalizeHexColor(value) {
  const match = String(value || "").trim().match(/^#?([a-f0-9]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : "";
}

export function paletteFromAccent(accent) {
  const accentRgb = hexToRgb(accent) || hexToRgb(DEFAULT_CUSTOM_ACCENT_COLOR);
  return { accent: rgbToHex(accentRgb), accentRgb };
}

function hexToRgb(value) {
  const hex = normalizeHexColor(value);
  if (!hex) return null;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(rgb) {
  return `#${rgb.map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
