import { createDashboardApp } from "./dashboard-app.mjs";

const app = await createDashboardApp();

window.addEventListener("ampira:runtime-message", (event) => {
  app.handleRuntimeMessage(event.detail);
});

window.addEventListener("ampira:favicon-permission-changed", () => {
  app.handleFaviconPermissionChanged();
});

await app.start();
