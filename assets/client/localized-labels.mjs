import { t } from "./i18n.mjs";

export function localizedResponseMessage(value, fallbackKey = "error.requestFailed") {
  if (value?.messageKey) return t(value.messageKey, value.messageParams || value.params || {});
  return String(value?.message || "").trim() || t(fallbackKey);
}

export function localizedErrorMessage(error) {
  if (error?.messageKey) return t(error.messageKey, error.messageParams || error.params || {});
  return String(error?.message || error || t("error.requestFailed"));
}

export function localizedStatusMessage(value, fallbackKey) {
  if (value?.messageKey) return t(value.messageKey, value.messageParams || {});
  return String(value?.message || "").trim() || t(fallbackKey);
}

export function localizedCategory(item = {}) {
  const key = String(item.categoryKey || item.summary?.categoryKey || "").trim();
  if (key && (item.sourceKind === "preset" || item.sectionKey === "inspirationPreset")) {
    return translatedCategory(`category.inspiration.${key}`, item.category);
  }
  if (item.sourceKind === "bookmark" || /^bookmark[-:]/.test(key)) {
    return item.category || t("category.news");
  }
  if (key) return translatedCategory(`category.${key}`, item.category);
  const aliases = { "全球热点": "global", "国际": "international", "科技": "technology", "消费科技": "consumerTechnology" };
  if (item.externalDiscovery && aliases[item.category]) return t(`category.${aliases[item.category]}`);
  return item.category || t("category.news");
}

function translatedCategory(key, fallback = "") {
  const translated = t(key);
  return translated === key ? (fallback || t("category.news")) : translated;
}

export function localizedSourceLabel(label, labelKey = "") {
  if (labelKey) return t(labelKey);
  const aliases = { "建议检查": "sourceQuality.review", "保留": "sourceQuality.keep" };
  return aliases[label] ? t(aliases[label]) : (label || "");
}

export function localizedSourceReason(reason, reasonKey = "") {
  if (reasonKey) return t(reasonKey);
  const aliases = { "未读取到可用内容": "sourceQuality.empty", "最近抓取失败": "sourceQuality.failed" };
  return aliases[reason] ? t(aliases[reason]) : (reason || "");
}

export function localizedExclusionReason(item = {}) {
  if (item.reasonKey === "exclusion.reason.suggestion") return t("exclusion.reason.suggestionDetail", { detail: item.reasonDetail || "" });
  if (item.reasonKey) return t(item.reasonKey);
  const aliases = { "手动屏蔽": "exclusion.reason.manual", "手动屏蔽文件夹": "exclusion.reason.manualFolder" };
  return aliases[item.reason] ? t(aliases[item.reason]) : (item.reason || t("exclusion.noReason"));
}

export function apiStyleLabel(value) {
  return value === "chat_completions" ? t("settings.service.chatCompletions") : "Responses";
}

export function colorModeLabel(value) {
  return { system: t("settings.colorMode.system"), dark: t("settings.colorMode.dark"), light: t("settings.colorMode.light") }[value] || t("settings.colorMode.system");
}

export function themeLabel(value) {
  return {
    violet: t("settings.accent.violet"), cyan: t("settings.accent.cyan"), emerald: t("settings.accent.emerald"),
    amber: t("settings.accent.amber"), rose: t("settings.accent.rose"),
  }[value] || t("settings.accent.violet");
}
