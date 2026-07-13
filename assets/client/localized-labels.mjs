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
  const legacy = legacyStatusMessage(value?.message);
  return legacy ? t(legacy.key, legacy.params) : (String(value?.message || "").trim() || t(fallbackKey));
}

export function localizedCategory(item = {}) {
  const key = String(item.categoryKey || item.summary?.categoryKey || "").trim();
  if (key) return t(`category.${key}`);
  const aliases = { "全球热点": "global", "国际": "international", "科技": "technology", "消费科技": "consumerTechnology" };
  if (item.externalDiscovery && aliases[item.category]) return t(`category.${aliases[item.category]}`);
  return item.category || t("category.news");
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

function legacyStatusMessage(message) {
  const text = String(message || "");
  if (!text) return null;
  if (text === "等待首次刷新") return { key: "background.waitingFirstRefresh", params: {} };
  if (text === "本地缓存已准备") return { key: "background.cacheReady", params: {} };
  if (text === "没有已授权的资讯来源") return { key: "background.noAuthorizedSources", params: {} };
  const reading = text.match(/^正在读取 (\d+) 个已授权来源$/);
  if (reading) return { key: "background.readingSources", params: { count: reading[1] } };
  const processed = text.match(/^已处理 (\d+)\/(\d+) 个来源$/);
  if (processed) return { key: "background.processedSources", params: { completed: processed[1], total: processed[2] } };
  const cached = text.match(/^已缓存 (\d+) 条资讯$/);
  return cached ? { key: "background.cachedItems", params: { count: cached[1] } } : null;
}
