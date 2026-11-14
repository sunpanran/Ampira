import { createOnboardingController } from "../../assets/client/onboarding-controller.mjs";
import { prepareLocale, setLocale, translateDocument } from "../../assets/client/i18n.mjs";
import { hydrateStorage, readValue, writeValue } from "../../assets/client/storage.mjs";
import { enhanceSelectComboboxes } from "../../assets/client/select-combobox.mjs";
import { DEFAULT_SETTINGS } from "../../extension/core/constants.mjs";

const params = new URLSearchParams(location.search);
const locale = params.get("locale") || "zh-CN";
document.documentElement.dataset.colorMode = params.get("theme") || "dark";
const markup = new DOMParser().parseFromString(await (await fetch(new URL("../../dashboard.html", import.meta.url))).text(), "text/html");
document.body.append(document.importNode(markup.querySelector("#onboardingOverlay"), true));
await hydrateStorage();
if (params.has("progress") && !sessionStorage.getItem("progress-seeded")) {
  writeValue("dash.onboarding.progress", params.get("progress"));
  sessionStorage.setItem("progress-seeded", "true");
}
const origins = ["https://news.example/*", "https://design.example/*"];
const state = window.onboardingQa = {
  requests: [], permissionRequests: [], completions: 0, allow: false,
  favicon: false, grantedOrigins: [], hold: false, holdRefresh: false, failSave: false,
  folders: params.has("empty") ? [] : [{ name: "Synthetic news", count: 2 }, { name: "Synthetic design", count: 2 }],
  settings: { ...DEFAULT_SETTINGS, uiLocale: locale, mcpEnabled: false,
    onboardingCompleted: params.has("completed"), bookmarkConsentGranted: false },
};
window.chrome = { permissions: {
  contains: async ({ permissions }) => permissions.every(value => value === "favicon" && state.favicon),
  request: async details => {
    state.permissionRequests.push({ details: structuredClone(details), gesture: navigator.userActivation.isActive });
    if (state.hold) await new Promise(resolve => { state.release = resolve; });
    if (!state.allow) return false;
    state.grantedOrigins = [...new Set([...state.grantedOrigins, ...(details.origins || [])])];
    if (details.permissions?.includes("favicon")) state.favicon = true;
    return true;
  },
} };
function settings() {
  return { ...state.settings,
    bookmarkFolderOptions: state.settings.bookmarkConsentGranted ? state.folders : [],
    onboardingPublicSources: [{ title: "Synthetic news" }, { title: "Synthetic design" }],
    onboardingSourcePermissions: origins.map(origin => ({ origin, granted: state.grantedOrigins.includes(origin) })),
  };
}
async function request(type, payload) {
  state.requests.push(type);
  if (type === "settings:get" && state.holdRefresh) await new Promise(resolve => { state.releaseRefresh = resolve; });
  if (type === "settings:save") {
    if (state.failSave) throw new Error("Synthetic save failure");
    Object.assign(state.settings, payload);
  }
  if (type === "onboarding:consent") state.settings.bookmarkConsentGranted = true;
  if (type === "onboarding:complete") {
    state.completions++;
    sessionStorage.setItem("onboarding-result", JSON.stringify({
      requests: state.requests, permissionRequests: state.permissionRequests, completions: state.completions,
    }));
  }
  return settings();
}
await prepareLocale(locale);
setLocale(locale, { persist: false });
translateDocument(document);
enhanceSelectComboboxes(document);
state.controller = createOnboardingController({ request, onSettingsChange() {} });
state.progress = () => readValue("dash.onboarding.progress");
state.changeLocale = async value => {
  await prepareLocale(value);
  setLocale(value, { persist: false });
  state.controller.translate();
};
await state.controller.initialize(settings());
state.ready = true;
