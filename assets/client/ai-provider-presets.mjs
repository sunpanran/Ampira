const PRIMARY_CATEGORY = "primary";
const LOCAL_CATEGORY = "local";

export const AI_PROVIDER_PRESETS = Object.freeze([
  preset({
    id: "openai", name: "OpenAI", mark: "OA", category: PRIMARY_CATEGORY,
    icon: themedIcon("openai"),
    baseUrl: "https://api.openai.com/v1", apiStyle: "responses", model: "gpt-6-luna",
    modelDocs: "https://developers.openai.com/api/docs/models",
    hosts: ["api.openai.com"],
  }),
  preset({
    id: "gemini", name: "Google Gemini", mark: "G", category: PRIMARY_CATEGORY,
    icon: icon("gemini"),
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiStyle: "chat_completions", model: "gemini-4-hydrogen",
    modelDocs: "https://aistudio.google.com/docs/models",
    hosts: ["generativelanguage.googleapis.com"],
  }),
  preset({
    id: "deepseek", name: "DeepSeek", mark: "DS", category: PRIMARY_CATEGORY,
    icon: icon("deepseek"),
    baseUrl: "https://api.deepseek.com", apiStyle: "chat_completions", model: "deepseek-flash",
    modelDocs: "https://api-docs.deepseek.com/quick_start/pricing",
    hosts: ["api.deepseek.com"],
  }),
  preset({
    id: "grok", name: "Grok", mark: "GK", category: PRIMARY_CATEGORY,
    icon: themedIcon("grok"),
    baseUrl: "https://api.x.ai/v1", apiStyle: "responses", model: "grok-4.7",
    modelDocs: "https://docs.x.ai/developers/models",
    hosts: ["api.x.ai"],
  }),
  preset({
    id: "kimi", name: "Kimi", mark: "K", category: PRIMARY_CATEGORY,
    icon: icon("kimi"),
    apiStyle: "chat_completions", model: "kimi-k3.1-pro",
    modelDocs: "https://platform.kimi.com/docs/models",
    hosts: ["api.moonshot.cn", "api.moonshot.ai"],
    regions: [
      { id: "cn", labelKey: "settings.service.regionChina", baseUrl: "https://api.moonshot.cn/v1" },
      { id: "intl", labelKey: "settings.service.regionInternational", baseUrl: "https://api.moonshot.ai/v1" },
    ],
  }),
  preset({
    id: "qwen", name: "Qwen", mark: "Q", category: PRIMARY_CATEGORY,
    icon: themedIcon("qwen"),
    apiStyle: "chat_completions", model: "qwen3.7-plus",
    modelDocs: "https://help.aliyun.com/zh/model-studio/models",
    hosts: ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com"],
    regions: [
      { id: "cn", labelKey: "settings.service.regionChina", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
      { id: "intl", labelKey: "settings.service.regionInternational", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
      { id: "us", labelKey: "settings.service.regionUnitedStates", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1" },
    ],
  }),
  preset({
    id: "openrouter", name: "OpenRouter", mark: "OR", category: PRIMARY_CATEGORY,
    icon: themedIcon("openrouter"),
    baseUrl: "https://openrouter.ai/api/v1", apiStyle: "chat_completions", model: "openai/gpt-6-luna",
    modelDocs: "https://openrouter.ai/models",
    hosts: ["openrouter.ai"],
  }),
  preset({
    id: "ollama", name: "Ollama", mark: "OL", category: LOCAL_CATEGORY,
    icon: themedIcon("ollama"),
    baseUrl: "http://localhost:11434/v1", apiStyle: "chat_completions", model: "",
    modelPlaceholder: "qwen3:8b", hintKey: "settings.service.providerHintLocal",
    modelDocs: "https://ollama.com/library",
    hosts: ["localhost", "127.0.0.1"],
    match: (url) => ["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "11434",
  }),
]);

export const CUSTOM_PROVIDER = Object.freeze({
  id: "custom",
  nameKey: "settings.service.customProvider",
  mark: "API",
  category: "custom",
  iconName: "server-01",
  apiStyle: "chat_completions",
  model: "",
  modelPlaceholder: "model-name",
  hintKey: "settings.service.providerHintCustom",
  modelDocs: "",
  regions: [],
});

function icon(id) {
  return Object.freeze({
    light: `/assets/icons/provider-${id}.svg`,
    dark: `/assets/icons/provider-${id}.svg`,
  });
}

function themedIcon(id) {
  return Object.freeze({
    light: `/assets/icons/provider-${id}-light.svg`,
    dark: `/assets/icons/provider-${id}-dark.svg`,
  });
}

export function aiProviderPreset(id) {
  return AI_PROVIDER_PRESETS.find((item) => item.id === id) || null;
}

export function aiProviderPresetForUrl(value) {
  const url = parsedUrl(value);
  if (!url) return null;
  return AI_PROVIDER_PRESETS.find((item) => (
    typeof item.match === "function" && item.match(url)
    || item.hosts.includes(url.hostname.toLowerCase())
    || item.hostSuffixes.some((suffix) => url.hostname.toLowerCase().endsWith(suffix))
  )) || null;
}

export function aiProviderRegionForUrl(presetValue, value) {
  const provider = typeof presetValue === "string" ? aiProviderPreset(presetValue) : presetValue;
  if (!provider?.regions.length) return "";
  const normalized = normalizeUrl(value);
  const exact = provider.regions.find((region) => normalizeUrl(region.baseUrl) === normalized);
  if (exact) return exact.id;
  const host = parsedUrl(value)?.hostname.toLowerCase() || "";
  return provider.regions.find((region) => parsedUrl(region.baseUrl)?.hostname.toLowerCase() === host)?.id
    || provider.regions[0].id;
}

export function aiProviderConfiguration(presetValue, regionId = "") {
  const provider = typeof presetValue === "string" ? aiProviderPreset(presetValue) : presetValue;
  if (!provider) return null;
  const region = provider.regions.find((item) => item.id === regionId) || provider.regions[0] || null;
  return {
    baseUrl: region?.baseUrl || provider.baseUrl,
    apiStyle: provider.apiStyle,
    model: provider.model,
    modelPlaceholder: provider.modelPlaceholder,
    modelDocs: provider.modelDocs,
  };
}

export function aiProviderPresets(category) {
  return AI_PROVIDER_PRESETS.filter((item) => item.category === category);
}

function preset(value) {
  return Object.freeze({
    baseUrl: "",
    apiStyle: "chat_completions",
    model: "",
    modelPlaceholder: value.model || "model-name",
    modelDocs: "",
    hosts: [],
    hostSuffixes: [],
    regions: [],
    ...value,
    hosts: Object.freeze([...(value.hosts || [])]),
    hostSuffixes: Object.freeze([...(value.hostSuffixes || [])]),
    regions: Object.freeze((value.regions || []).map((region) => Object.freeze({ ...region }))),
  });
}

function normalizeUrl(value) {
  const url = parsedUrl(value);
  return url ? url.href.replace(/\/$/, "") : "";
}

function parsedUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}
