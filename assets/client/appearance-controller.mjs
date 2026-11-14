import { getLocale, normalizeLocale, prepareLocale, setLocale, t, translateDocument } from "./i18n.mjs";
import {
  ACCENT_THEMES,
  DEFAULT_ACCENT_THEME,
  DEFAULT_CUSTOM_ACCENT_COLOR,
  normalizeAccentTheme,
  normalizeColorMode,
  normalizeHexColor,
  normalizeNavPosition,
  normalizeSectionTitleOpacity,
  paletteFromAccent,
} from "./appearance-model.mjs";

import {
  HEADER_IMAGE_BLUR_MAX, HEADER_IMAGE_HEIGHT_MIN, HEADER_IMAGE_HEIGHT_MAX, HEADER_IMAGE_HEIGHT_STEP, HEADER_IMAGE_HEIGHT_DEFAULT,
  normalizeHeaderImageBlurAmount, normalizeHeaderImageHeightScale, normalizeHeaderImageFit,
} from "./header-cover-model.mjs";

const COLOR_MODE_STORAGE_KEY = "ampira.colorMode";
const NAV_POSITION_STORAGE_KEY = "ampira.navPosition";
const ACCENT_PALETTE_STORAGE_KEY = "ampira.accentPalette";
const DASHBOARD_GLASS_BLUR_STORAGE_KEY = "ampira.dashboardGlassBlur";

export function createAppearanceController(options) {
  const { state, els } = options;

  function syncControls(settings = {}) {
    syncColorModeButtons(normalizeColorMode(settings.colorMode || settings.defaultColorMode));
    syncNavPositionButtons(settings.navPosition);
    els.navAutoHideEnabledInput.checked = settings.navAutoHideEnabled === true;
    const accentTheme = normalizeAccentTheme(settings.accentTheme || settings.defaultAccentTheme);
    const custom = normalizeHexColor(settings.customAccentColor) || settings.defaultCustomAccentColor || DEFAULT_CUSTOM_ACCENT_COLOR;
    syncAccentThemeButtons(accentTheme);
    els.customAccentInput.value = custom;
    options.syncCustomAccentColor?.(custom);
    applyCustomAccentPreview(custom);
    syncTitleOpacityButtons(settings.sectionTitleOpacity);
    els.pointerGlowEnabledInput.checked = settings.pointerGlowEnabled !== false;
    els.dashboardGlassBlurEnabledInput.checked = settings.dashboardGlassBlurEnabled !== false;
    els.headerImageEnabledInput.checked = settings.headerImageEnabled === true;
    els.headerImageBlurAmountInput.value = String(settings.headerImageBlurEnabled === true
      ? normalizeHeaderImageBlurAmount(settings.headerImageBlurAmount)
      : 0);
    els.headerImageHeightInput.value = String(normalizeHeaderImageHeightScale(settings.headerImageHeightScale));
    els.headerImageFixedInput.checked = settings.headerImageFixed === true;
    els.headerImageFullscreenInput.checked = settings.headerImageFixed === true && settings.headerImageFullscreen === true;
    syncHeaderImageLayoutButtons();
    syncHeightControl();
    syncBlurControl();
    els.headerImageUrlInput.value = settings.headerImageUrl || "";
    els.headerImageMediaTypeInput.value = settings.headerImageMediaType || "auto";
    els.headerImageFitInput.value = normalizeHeaderImageFit(settings.headerImageFit);
  }

  function syncFullscreenControl(busy = els.saveSettings.disabled) {
    for (const button of els.headerImageLayoutGroup.querySelectorAll("[data-header-image-layout]")) button.disabled = busy;
    els.headerImageFitInput.disabled = busy || !els.headerImageEnabledInput.checked;
  }

  function syncBlurControl(busy = els.saveSettings.disabled) {
    const headerEnabled = els.headerImageEnabledInput.checked;
    const disabled = !headerEnabled || busy;
    els.headerImageBlurAmountInput.disabled = disabled;
    els.headerImageBlurField.setAttribute("aria-disabled", String(disabled));
    syncBlurAmountLabel();
  }

  function syncHeightControl(busy = els.saveSettings.disabled) {
    const enabled = els.headerImageEnabledInput.checked;
    els.headerImageHeightInput.min = String(HEADER_IMAGE_HEIGHT_MIN);
    els.headerImageHeightInput.max = String(HEADER_IMAGE_HEIGHT_MAX);
    els.headerImageHeightInput.step = String(HEADER_IMAGE_HEIGHT_STEP);
    els.headerImageHeightInput.disabled = !enabled || busy;
    els.headerImageHeightField.setAttribute("aria-disabled", String(!enabled || busy));
    syncHeightLabel();
  }

  function syncHeightLabel() {
    const value = normalizeHeaderImageHeightScale(els.headerImageHeightInput.value);
    const progress = ((value - HEADER_IMAGE_HEIGHT_MIN) / (HEADER_IMAGE_HEIGHT_MAX - HEADER_IMAGE_HEIGHT_MIN)) * 100;
    let text = `${Math.round(progress)}%`;
    if (value === HEADER_IMAGE_HEIGHT_DEFAULT) text = t("settings.defaultValue", { value: text });
    els.headerImageHeightInput.value = String(value);
    els.headerImageHeightInput.setAttribute("aria-valuetext", text);
    els.headerImageHeightInput.style.setProperty("--range-progress", `${progress}%`);
    els.headerImageHeightOutput.value = text;
    return value;
  }

  function syncTitleOpacityButtons(value) {
    const opacity = normalizeSectionTitleOpacity(value);
    for (const button of els.sectionTitleOpacityGroup.querySelectorAll("[data-title-opacity]")) {
      const active = Number(button.dataset.titleOpacity) === opacity;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    options.syncSegmentedIndicator(els.sectionTitleOpacityGroup);
  }

  function syncBlurAmountLabel() {
    const amount = normalizeHeaderImageBlurAmount(els.headerImageBlurAmountInput.value);
    const min = Number(els.headerImageBlurAmountInput.min) || 0;
    const max = Number(els.headerImageBlurAmountInput.max) || HEADER_IMAGE_BLUR_MAX;
    const progress = max > min ? ((amount - min) / (max - min)) * 100 : 0;
    els.headerImageBlurAmountInput.value = String(amount);
    els.headerImageBlurAmountInput.setAttribute("aria-valuetext", `${amount} px`);
    els.headerImageBlurAmountInput.style.setProperty("--range-progress", `${progress}%`);
    els.headerImageBlurAmountOutput.value = `${amount} px`;
    return amount;
  }

  function updatePreview(overrides = {}) {
    state.settings = { ...(state.settings || {}), ...payload(), ...overrides };
    if (overrides.colorMode) syncColorModeButtons(overrides.colorMode);
    if (overrides.navPosition) syncNavPositionButtons(overrides.navPosition);
    if (overrides.accentTheme) syncAccentThemeButtons(overrides.accentTheme);
    if (Object.hasOwn(overrides, "sectionTitleOpacity")) syncTitleOpacityButtons(overrides.sectionTitleOpacity);
    applySettings(state.settings);
    options.renderSettingsStatus();
  }

  function selectHeaderImageLayout(layout) {
    els.headerImageEnabledInput.checked = layout !== "off";
    els.headerImageFixedInput.checked = layout === "fixed" || layout === "fullscreen";
    els.headerImageFullscreenInput.checked = layout === "fullscreen";
    syncHeaderImageLayoutButtons();
    syncHeightControl();
    syncBlurControl();
  }

  function syncHeaderImageLayoutButtons() {
    els.headerImageFitInput.disabled = els.saveSettings.disabled || !els.headerImageEnabledInput.checked;
    const layout = !els.headerImageEnabledInput.checked ? "off" : els.headerImageFullscreenInput.checked ? "fullscreen" : els.headerImageFixedInput.checked ? "fixed" : "standard";
    for (const button of els.headerImageLayoutGroup.querySelectorAll("[data-header-image-layout]")) {
      const active = button.dataset.headerImageLayout === layout;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    options.syncSegmentedIndicator(els.headerImageLayoutGroup);
  }

  function payload() {
    return {
      uiLocale: selectedUiLocale(),
      colorMode: selectedColorMode(),
      navPosition: normalizeNavPosition(els.navPositionGroup.querySelector(".active[data-nav-position]")?.dataset.navPosition || state.settings?.navPosition),
      navAutoHideEnabled: els.navAutoHideEnabledInput.checked,
      accentTheme: selectedAccentTheme(),
      customAccentColor: normalizeHexColor(els.customAccentInput.value) || DEFAULT_CUSTOM_ACCENT_COLOR,
      sectionTitleOpacity: normalizeSectionTitleOpacity(els.sectionTitleOpacityGroup.querySelector(".active[data-title-opacity]")?.dataset.titleOpacity ?? state.settings?.sectionTitleOpacity),
      pointerGlowEnabled: els.pointerGlowEnabledInput.checked,
      dashboardGlassBlurEnabled: els.dashboardGlassBlurEnabledInput.checked,
      headerImageEnabled: els.headerImageEnabledInput.checked,
      headerImageBlurEnabled: syncBlurAmountLabel() > 0,
      headerImageBlurAmount: syncBlurAmountLabel(),
      headerImageHeightScale: syncHeightLabel(),
      headerImageFixed: els.headerImageFixedInput.checked,
      headerImageFullscreen: els.headerImageFixedInput.checked && els.headerImageFullscreenInput.checked,
      headerImageUrl: els.headerImageUrlInput.value.trim(),
      headerImageMediaType: els.headerImageMediaTypeInput.value,
      headerImageFit: normalizeHeaderImageFit(els.headerImageFitInput.value),
    };
  }

  function selectedUiLocale() {
    return normalizeLocale(els.uiLocaleSelect.value || state.settings?.uiLocale || getLocale());
  }

  async function syncLanguageControls(settings = {}, { render = true } = {}) {
    const locale = normalizeLocale(settings.uiLocale || getLocale());
    await prepareLocale(locale);
    els.uiLocaleSelect.value = locale;
    return applyLocale(locale, { persist: Boolean(settings.uiLocale), render });
  }

  function applyLocale(value, { persist = false, render = true } = {}) {
    const locale = setLocale(value, { persist, translate: false });
    els.uiLocaleSelect.value = locale;
    translateDocument(document);
    syncHeightLabel();
    options.syncAiSearchLocale?.();
    options.syncHeaderCoverControls?.();
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

  function syncNavPositionButtons(value) {
    const position = normalizeNavPosition(value);
    for (const button of els.navPositionGroup.querySelectorAll("[data-nav-position]")) {
      const active = button.dataset.navPosition === position;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    options.syncSegmentedIndicator(els.navPositionGroup);
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
    const accent = accentTheme === "custom" ? custom : ACCENT_THEMES[accentTheme] || ACCENT_THEMES[DEFAULT_ACCENT_THEME];
    const palette = paletteFromAccent(accent);
    const root = document.documentElement;
    root.dataset.colorMode = colorMode;
    cache(COLOR_MODE_STORAGE_KEY, colorMode);
    root.dataset.navPosition = normalizeNavPosition(settings.navPosition);
    cache(NAV_POSITION_STORAGE_KEY, root.dataset.navPosition);
    options.syncNavigationAutoHide?.(settings);
    options.syncNavExpandedWidth();
    root.dataset.accentTheme = accentTheme;
    cache(ACCENT_PALETTE_STORAGE_KEY, JSON.stringify({ theme: accentTheme, color: palette.accent }));
    root.dataset.pointerGlow = settings.pointerGlowEnabled === false ? "off" : "on";
    root.dataset.dashboardGlassBlur = settings.dashboardGlassBlurEnabled === false ? "off" : "on";
    cache(DASHBOARD_GLASS_BLUR_STORAGE_KEY, root.dataset.dashboardGlassBlur);
    const titleOpacity = normalizeSectionTitleOpacity(settings.sectionTitleOpacity);
    root.style.setProperty("--section-title-opacity", String(titleOpacity / 100));
    cache("ampira.sectionTitleOpacity", String(titleOpacity));
    root.style.setProperty("--accent", palette.accent);
    root.style.setProperty("--accent-rgb", palette.accentRgb.join(", "));
    applyCustomAccentPreview(custom);
    renderHeaderImage(settings);
  }

  let headerRenderer, headerRendererReady, headerSettings;
  function renderHeaderImage(settings = {}) {
    headerSettings = settings;
    if (headerRenderer) { headerRenderer.renderHeaderImage(settings); return; }
    headerRendererReady ||= import("./header-cover-renderer.mjs").then(({ createHeaderCoverRenderer }) => {
      headerRenderer = createHeaderCoverRenderer({ state, els });
      headerRenderer.renderHeaderImage(headerSettings);
    });
  }
  function handleHeaderImageLoad() { headerRenderer?.handleHeaderImageLoad(); }
  function handleHeaderImageError() { headerRenderer?.handleHeaderImageError(); }
  function syncHeaderImageLoadState() { headerRenderer?.syncHeaderImageLoadState(); }

  function applyCustomAccentPreview(color) {
    document.documentElement.style.setProperty("--custom-accent-preview", normalizeHexColor(color) || DEFAULT_CUSTOM_ACCENT_COLOR);
  }

  function cache(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  return { syncControls, syncFullscreenControl, syncBlurControl, syncHeightControl, updatePreview, selectHeaderImageLayout, payload, selectedUiLocale, selectedColorMode, selectedAccentTheme, syncLanguageControls, applyLocale, applySettings, handleHeaderImageLoad, handleHeaderImageError, syncHeaderImageLoadState };
}
