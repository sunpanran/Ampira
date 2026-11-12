import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { providerEndpoint } from "../../extension/core/ai.mjs";
import { normalizeProviderSettings } from "../../extension/core/settings.mjs";
import { aiProviderOriginPattern } from "../../assets/client/ai-settings-policy.mjs";
import {
  AI_PROVIDER_PRESETS,
  CUSTOM_PROVIDER,
  aiProviderConfiguration,
  aiProviderPreset,
  aiProviderPresetForUrl,
  aiProviderPresets,
  aiProviderRegionForUrl,
} from "../../assets/client/ai-provider-presets.mjs";

const expectedPrimary = ["openai", "deepseek", "gemini", "kimi", "qwen", "openrouter", "grok", "ollama"];
const expectedMore = ["siliconflow", "zhipu", "doubao", "mistral"];
assert.deepEqual(aiProviderPresets("primary").map((item) => item.id), expectedPrimary);
assert.deepEqual(aiProviderPresets("more").map((item) => item.id), expectedMore);
assert.equal(new Set(AI_PROVIDER_PRESETS.map((item) => item.id)).size, AI_PROVIDER_PRESETS.length);

const providersWithIcons = new Set([
  "openai", "deepseek", "gemini", "kimi", "qwen", "openrouter", "grok", "ollama", "siliconflow", "zhipu", "doubao", "mistral",
]);
for (const preset of AI_PROVIDER_PRESETS) {
  assert.equal(Boolean(preset.icon), providersWithIcons.has(preset.id));
  for (const source of Object.values(preset.icon || {})) {
    assert.match(source, /^\/assets\/icons\/provider-[a-z0-9-]+\.svg$/);
    assert(existsSync(fileURLToPath(new URL(`../..${source}`, import.meta.url))), `${source} must be packaged locally`);
  }
}

const expectedBases = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  kimi: "https://api.moonshot.cn/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  openrouter: "https://openrouter.ai/api/v1",
  grok: "https://api.x.ai/v1",
  ollama: "http://localhost:11434/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  mistral: "https://api.mistral.ai/v1",
};
for (const preset of AI_PROVIDER_PRESETS) {
  const configuration = aiProviderConfiguration(preset);
  assert.equal(configuration.baseUrl, expectedBases[preset.id], `${preset.id} must keep its reviewed base URL`);
  assert(["responses", "chat_completions"].includes(configuration.apiStyle));
  const endpoint = providerEndpoint(configuration.baseUrl, configuration.apiStyle);
  assert(endpoint.endsWith(configuration.apiStyle === "responses" ? "/responses" : "/chat/completions"));
  assert.equal(aiProviderPresetForUrl(configuration.baseUrl)?.id, preset.id, `${preset.id} must be recognized from its real URL`);
}

const grok = aiProviderConfiguration("grok");
assert.equal(grok.apiStyle, "responses");
assert.equal(grok.model, "grok-4.7");
assert.equal(providerEndpoint(grok.baseUrl, grok.apiStyle), "https://api.x.ai/v1/responses");
assert.equal(aiProviderOriginPattern(grok.baseUrl), "https://api.x.ai/*");
assert.equal(aiProviderPresetForUrl("https://api.x.ai/v1/responses")?.id, "grok");
assert.equal(aiProviderPresetForUrl("https://api.x.ai.example.com/v1"), null);
assert.equal(aiProviderPreset("groq"), null, "Groq must no longer be offered as a preset");
const savedGroq = normalizeProviderSettings({
  openaiBaseUrl: "https://api.groq.com/openai/v1",
  openaiApiStyle: "chat_completions",
  openaiSummaryModel: "openai/gpt-oss-20b",
});
assert.equal(savedGroq.openaiBaseUrl, "https://api.groq.com/openai/v1");
assert.equal(savedGroq.openaiApiStyle, "chat_completions");
assert.equal(savedGroq.openaiSummaryModel, "openai/gpt-oss-20b");
assert.equal(aiProviderPresetForUrl(savedGroq.openaiBaseUrl) || CUSTOM_PROVIDER, CUSTOM_PROVIDER,
  "saved Groq settings must stay editable as a custom provider without migration");

for (const [id, savedModel] of [
  ["deepseek", "deepseek-v4-flash"],
  ["gemini", "gemini-3.5-flash"],
  ["kimi", "kimi-k2.6"],
  ["siliconflow", "Pro/zai-org/GLM-4.7"],
]) {
  const configuration = aiProviderConfiguration(id);
  const saved = normalizeProviderSettings({
    openaiBaseUrl: configuration.baseUrl,
    openaiApiStyle: configuration.apiStyle,
    openaiSummaryModel: savedModel,
  });
  assert.equal(saved.openaiSummaryModel, savedModel,
    `${id}: refreshing a preset must not silently rewrite a previously saved model`);
  assert.equal(aiProviderPresetForUrl(saved.openaiBaseUrl)?.id, id);
  assert.notEqual(configuration.model, savedModel,
    `${id}: selecting the preset again must offer the reviewed replacement`);
}

assert.equal(aiProviderRegionForUrl("kimi", "https://api.moonshot.ai/v1"), "intl");
assert.equal(aiProviderConfiguration("kimi", "intl").baseUrl, "https://api.moonshot.ai/v1");
assert.equal(aiProviderRegionForUrl("qwen", "https://dashscope-us.aliyuncs.com/compatible-mode/v1"), "us");
assert.equal(aiProviderConfiguration("qwen", "intl").baseUrl, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
assert.equal(aiProviderPresetForUrl("https://workspace-id.modelstudio.console.aliyun.com.maas.aliyuncs.com/v1"), null, "workspace-specific Qwen URLs must remain editable through custom mode");
assert.equal(aiProviderPresetForUrl("https://private.example.com/v1"), null, "unknown OpenAI-compatible services must remain custom");

console.log("AI provider preset tests passed");
