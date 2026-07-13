import { getLocale, normalizeLocale, setLocale, t, translateDocument } from "./i18n.mjs";
import { isHttpUrl } from "./urls.mjs";
import {
  ACCENT_THEMES,
  DEFAULT_CUSTOM_ACCENT_COLOR,
  normalizeAccentTheme,
  normalizeColorMode,
  normalizeHexColor,
  paletteFromAccent,
} from "./appearance-model.mjs";

const COLOR_MODE_STORAGE_KEY = "ampira.colorMode";
const HEADER_COVER_STORAGE_KEY = "ampira.headerCover";

export function createAppearanceController(options) {
  const { state, els } = options;

  function syncControls(settings = {}) {
    syncColorModeButtons(normalizeColorMode(settings.colorMode || settings.defaultColorMode));
    const accentTheme = normalizeAccentTheme(settings.accentTheme || settings.defaultAccentTheme);
    const custom = normalizeHexColor(settings.customAccentColor) || settings.defaultCustomAccentColor || DEFAULT_CUSTOM_ACCENT_COLOR;
    syncAccentThemeButtons(accentTheme);
    els.customAccentInput.value = custom;
    applyCustomAccentPreview(custom);
    els.pointerGlowEnabledInput.checked = settings.pointerGlowEnabled !== false;
    els.headerImageEnabledInput.checked = settings.headerImageEnabled === true;
    els.headerImageFixedInput.checked = settings.headerImageFixed === true;
    els.headerImageFullscreenInput.checked = settings.headerImageFixed === true && settings.headerImageFullscreen === true;
    syncFullscreenControl();
    els.headerImageUrlInput.value = settings.headerImageUrl || "";
  }

  function syncFullscreenControl(busy = els.saveSettings.disabled) {
    const available = els.headerImageFixedInput.checked && !busy;
    els.headerImageFullscreenInput.disabled = !available;
    els.headerImageFullscreenField.setAttribute("aria-disabled", String(!available));
  }

  function updatePreview(overrides = {}) {
    state.settings = { ...(state.settings || {}), ...payload(), ...overrides };
    if (overrides.colorMode) syncColorModeButtons(overrides.colorMode);
    if (overrides.accentTheme) syncAccentThemeButtons(overrides.accentTheme);
    applySettings(state.settings);
    options.renderSettingsStatus();
  }

  function payload() {
    return {
      uiLocale: selectedUiLocale(),
      colorMode: selectedColorMode(),
      accentTheme: selectedAccentTheme(),
      customAccentColor: normalizeHexColor(els.customAccentInput.value) || DEFAULT_CUSTOM_ACCENT_COLOR,
      pointerGlowEnabled: els.pointerGlowEnabledInput.checked,
      headerImageEnabled: els.headerImageEnabledInput.checked,
      headerImageFixed: els.headerImageFixedInput.checked,
      headerImageFullscreen: els.headerImageFixedInput.checked && els.headerImageFullscreenInput.checked,
      headerImageUrl: els.headerImageUrlInput.value.trim(),
    };
  }

  function selectedUiLocale() {
    return normalizeLocale(els.uiLocaleSelect.value || state.settings?.uiLocale || getLocale());
  }

  function syncLanguageControls(settings = {}, { render = true } = {}) {
    const locale = normalizeLocale(settings.uiLocale || getLocale());
    els.uiLocaleSelect.value = locale;
    applyLocale(locale, { persist: Boolean(settings.uiLocale), render });
  }

  function applyLocale(value, { persist = false, render = true } = {}) {
    const locale = setLocale(value, { persist });
    els.uiLocaleSelect.value = locale;
    translateDocument(document);
    if (els.currentUiLanguage) els.currentUiLanguage.textContent = t("language.name");
    options.renderTodayMeta();
    if (state.data && render) options.renderAll();
    options.syncNavExpandedWidth();
    options.syncAiSetupControls();
    return locale;
  }

  function selectedColorMode() {
    return normalizeColorMode(els.colorModeGroup.querySelector(".active[data-color-mode]")?.dataset.colorMode || state.settings?.colorMode);
  }

  function syncColorModeButtons(colorMode) {
    const mode = normalizeColorMode(colorMode);
    for (const button of els.colorModeGroup.querySelectorAll("[data-color-mode]")) {
      const active = button.dataset.colorMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    options.syncSegmentedIndicator(els.colorModeGroup);
  }

  function selectedAccentTheme() {
    const active = els.accentThemeGroup.querySelector(".active[data-accent-theme]");
    const theme = normalizeAccentTheme(active?.dataset.accentTheme || state.settings?.accentTheme);
    return normalizeHexColor(els.customAccentInput.value) && theme === "custom" ? "custom" : theme;
  }

  function syncAccentThemeButtons(accentTheme) {
    const theme = normalizeAccentTheme(accentTheme);
    for (const swatch of els.accentThemeGroup.querySelectorAll("[data-accent-theme]")) {
      const active = swatch.dataset.accentTheme === theme;
      swatch.classList.toggle("active", active);
      swatch.setAttribute("aria-pressed", String(active));
    }
  }

  function applySettings(settings = {}) {
    const colorMode = normalizeColorMode(settings.colorMode || settings.defaultColorMode);
    const accentTheme = normalizeAccentTheme(settings.accentTheme || settings.defaultAccentTheme);
    const custom = normalizeHexColor(settings.customAccentColor) || DEFAULT_CUSTOM_ACCENT_COLOR;
    const accent = accentTheme === "custom" ? custom : ACCENT_THEMES[accentTheme] || ACCENT_THEMES.violet;
    const palette = paletteFromAccent(accent);
    const root = document.documentElement;
    root.dataset.colorMode = colorMode;
    cache(COLOR_MODE_STORAGE_KEY, colorMode);
    root.dataset.accentTheme = accentTheme;
    root.dataset.pointerGlow = settings.pointerGlowEnabled === false ? "off" : "on";
    root.style.setProperty("--accent", palette.accent);
    root.style.setProperty("--accent-rgb", palette.accentRgb.join(", "));
    applyCustomAccentPreview(custom);
    renderHeaderImage(settings);
  }

  function renderHeaderImage(settings = {}) {
    const url = String(settings.headerImageUrl || "").trim();
    const enabled = settings.headerImageEnabled === true;
    const fixed = settings.headerImageFixed === true;
    const fullscreen = fixed && settings.headerImageFullscreen === true;
    const root = document.documentElement;
    cache(HEADER_COVER_STORAGE_KEY, JSON.stringify({ enabled: enabled && isHttpUrl(url), fixed, fullscreen, url: enabled ? url : "" }));
    if (!enabled || !isHttpUrl(url)) {
      els.headerImageHero.hidden = true;
      els.headerImageHero.classList.remove("is-loaded");
      els.headerImage.removeAttribute("src");
      root.classList.remove("has-header-cover", "has-fixed-header-cover", "has-fullscreen-header-cover");
      return;
    }
    els.headerImageHero.hidden = false;
    root.classList.add("has-header-cover");
    root.classList.toggle("has-fixed-header-cover", fixed);
    root.classList.toggle("has-fullscreen-header-cover", fullscreen);
    if (els.headerImage.getAttribute("src") !== url) {
      els.headerImageHero.classList.remove("is-loaded");
      els.headerImage.src = url;
    }
    syncHeaderImageLoadState();
  }

  function syncHeaderImageLoadState() {
    if (!els.headerImage.getAttribute("src") || !els.headerImage.complete) return;
    if (els.headerImage.naturalWidth > 0) handleHeaderImageLoad();
    else handleHeaderImageError();
  }

  function handleHeaderImageLoad() {
    if (els.headerImage.complete && els.headerImage.naturalWidth > 0) els.headerImageHero.classList.add("is-loaded");
  }

  function handleHeaderImageError() {
    els.headerImageHero.classList.remove("is-loaded");
    els.headerImageHero.hidden = true;
    document.documentElement.classList.remove("has-header-cover", "has-fixed-header-cover", "has-fullscreen-header-cover");
  }

  function applyCustomAccentPreview(color) {
    document.documentElement.style.setProperty("--custom-accent-preview", normalizeHexColor(color) || DEFAULT_CUSTOM_ACCENT_COLOR);
  }

  function cache(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  return { syncControls, syncFullscreenControl, updatePreview, payload, selectedUiLocale, selectedColorMode, selectedAccentTheme, syncLanguageControls, applyLocale, applySettings, handleHeaderImageLoad, handleHeaderImageError, syncHeaderImageLoadState };
}
