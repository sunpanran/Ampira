import { sendExtensionRequest } from "./api.mjs";
import { createThemedIcon } from "./icons.mjs";
import { getLocale, setLocale, t } from "./i18n.mjs";

const root = document.querySelector(".action-popup");
const elements = {
  popupKicker: document.querySelector("#popupKicker"),
  statusIcon: document.querySelector("#statusIcon"),
  statusTitle: document.querySelector("#statusTitle"),
  statusBody: document.querySelector("#statusBody"),
  capturedPage: document.querySelector("#capturedPage"),
  capturedTitle: document.querySelector("#capturedTitle"),
  capturedHost: document.querySelector("#capturedHost"),
  localNote: document.querySelector("#localNote"),
  openDashboard: document.querySelector("#openDashboard"),
  openDashboardIcon: document.querySelector("#openDashboardIcon"),
  openDashboardLabel: document.querySelector("#openDashboardLabel"),
};

applyAppearanceHint();
elements.openDashboardIcon.replaceChildren(createThemedIcon("arrow-up-right", "popup-action-icon"));
elements.openDashboard.addEventListener("click", openDashboard);
initialize();

async function initialize() {
  const settings = await popupSettings();
  setLocale(settings.uiLocale || getLocale(), { persist: false, translate: false });
  applyColorMode(settings.colorMode || settings.defaultColorMode);
  translateShell();
  await captureCurrentPage();
}

async function captureCurrentPage() {
  renderStatus("loading");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await sendExtensionRequest({
      type: "reading-queue:capture-current",
      payload: {
        tab: {
          id: Number.isInteger(tab?.id) ? tab.id : undefined,
          title: String(tab?.title || ""),
          url: String(tab?.url || ""),
        },
      },
    });
    renderStatus(result?.status || "failed", result?.record || null, tab);
  } catch {
    renderStatus("failed");
  }
}

function renderStatus(status, record = null, tab = null) {
  const normalized = ["added", "already", "unsupported", "failed"].includes(status) ? status : "loading";
  const states = {
    loading: {
      icon: "",
      title: t("action.popup.loadingTitle"),
      body: "",
    },
    added: {
      icon: "check",
      title: t("action.captureAdded"),
      body: "",
    },
    already: {
      icon: "check",
      title: t("action.captureAlreadyQueued"),
      body: "",
    },
    unsupported: {
      icon: "info-circle",
      title: t("action.popup.unsupportedTitle"),
      body: t("action.popup.unsupportedBody"),
    },
    failed: {
      icon: "info-circle",
      title: t("action.popup.failedTitle"),
      body: t("action.popup.failedBody"),
    },
  };
  const view = states[normalized];
  root.dataset.state = normalized;
  elements.statusIcon.replaceChildren(...(view.icon ? [createThemedIcon(view.icon, "status-glyph")] : []));
  elements.statusTitle.textContent = view.title;
  elements.statusBody.textContent = view.body;
  elements.statusBody.hidden = !view.body;

  const title = String(record?.title || tab?.title || "").trim();
  const host = String(record?.host || hostFromUrl(record?.url || tab?.url) || "").trim();
  const showPage = (normalized === "added" || normalized === "already") && Boolean(title || host);
  elements.capturedPage.hidden = !showPage;
  elements.capturedTitle.textContent = title || host;
  elements.capturedHost.textContent = host;
}

function translateShell() {
  document.title = `Ampira · ${t("action.popup.readLater")}`;
  elements.popupKicker.textContent = t("action.popup.kicker");
  elements.localNote.textContent = t("action.popup.localOnly");
  elements.openDashboardLabel.textContent = t("action.popup.openAmpira");
}

function applyAppearanceHint() {
  try {
    const mode = localStorage.getItem("ampira.colorMode");
    applyColorMode(mode);
  } catch {
    applyColorMode("dark");
  }
}

function applyColorMode(value) {
  document.documentElement.dataset.colorMode = ["system", "dark", "light"].includes(value) ? value : "dark";
}

async function popupSettings() {
  try {
    return await sendExtensionRequest({ type: "settings:get" }) || {};
  } catch {
    return {};
  }
}

function hostFromUrl(value) {
  try {
    return new URL(String(value || "")).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function openDashboard() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  window.close();
}
