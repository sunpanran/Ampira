import { createDashboardApp } from "./dashboard-app.mjs";

const app = await createDashboardApp();

window.addEventListener("ampira:runtime-message", (event) => {
  app.handleRuntimeMessage(event.detail);
});

window.addEventListener("ampira:favicon-permission-changed", () => {
  app.handleFaviconPermissionChanged();
});

await app.start();

const launchUrl = new URL(location.href);
if (launchUrl.searchParams.get("open") === "ai-settings") {
  launchUrl.searchParams.delete("open");
  history.replaceState(null, "", `${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`);
  if (document.querySelector("#onboardingOverlay")?.hidden !== false) await app.openAiSettings();
}
