import { createThemedIcon } from "./icons.mjs";
import { renderAiMarkdown } from "./ai-markdown.mjs";

export function renderResearchAnswer({ model, target, t, openExternal }) {
  const copy = document.createElement("div");
  copy.className = "ai-research-answer-copy";
  const evidenceById = new Map(model.evidence.map((item) => [item.id, item]));
  renderAiMarkdown(copy, model.text, {
    openExternal,
    labels: {
      copyCode: t("aiSearch.copyCode"),
      codeCopied: t("aiSearch.codeCopied"),
      citation: t("aiSearch.research.openSource", { id: "{id}", title: "" }),
    },
    onCitation: (id, probe) => {
      const evidence = evidenceById.get(id);
      if (!evidence) return false;
      if (!probe) revealResearchPassage(model, id);
      return true;
    },
  });
  target.append(copy);
  if (!model.evidence.length) return;
  const details = document.createElement("section");
  details.id = `aiResearchSources-${model.id}`;
  details.className = "ai-research-sources";
  details.hidden = !model.sourcesExpanded;
  details.setAttribute("aria-label", t("aiSearch.research.sourceDetails"));
  const overview = document.createElement("div");
  overview.className = "ai-research-run-details";
  const heading = document.createElement("strong");
  heading.textContent = t("aiSearch.research.sourceDetails");
  const scope = document.createElement("span");
  scope.textContent = researchScopeLabel(model.researchScope, t);
  const coverage = document.createElement("span");
  coverage.textContent = researchCoverageLabel(model.coverage, t);
  overview.append(heading, scope);
  if (coverage.textContent) overview.append(coverage);
  details.append(overview);
  const list = document.createElement("ol");
  model.evidence.forEach((item) => {
    const row = document.createElement("li");
    row.dataset.evidenceId = item.id;
    row.tabIndex = -1;
    const head = document.createElement("div");
    head.className = "ai-research-source-head";
    const sourceId = document.createElement("span");
    sourceId.className = "ai-research-source-id";
    sourceId.textContent = item.id;
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = item.title;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openExternal(item.url, item.title);
    });
    head.append(sourceId, link);
    const meta = document.createElement("div");
    meta.className = "ai-research-source-meta";
    meta.textContent = researchSourceMeta(item, t);
    row.append(head, meta);
    if (item.snippet) {
      const snippet = document.createElement("p");
      snippet.className = "ai-research-passage";
      if (item.contextBefore) {
        const before = document.createElement("span");
        before.className = "ai-research-passage-context";
        before.textContent = `${item.contextBefore} `;
        snippet.append(before);
      }
      const supporting = document.createElement("mark");
      supporting.textContent = item.snippet;
      snippet.append(supporting);
      if (item.contextAfter) {
        const after = document.createElement("span");
        after.className = "ai-research-passage-context";
        after.textContent = ` ${item.contextAfter}`;
        snippet.append(after);
      }
      row.append(snippet);
    }
    list.append(row);
  });
  details.append(list);
  target.append(details);
}

export function researchCopyText(model, t) {
  if (!model.evidence.length) return model.text;
  return [
    model.text,
    "",
    t("aiSearch.sources"),
    ...model.evidence.map((item) => `[${item.id}] ${item.title} — ${item.url}`),
  ].join("\n");
}

export function createResearchSourcesButton({ model, t }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ai-sources-toggle";
  button.textContent = t("aiSearch.research.sourcesCount", { count: model.evidence.length });
  button.setAttribute("aria-controls", `aiResearchSources-${model.id}`);
  button.setAttribute("aria-expanded", String(model.sourcesExpanded));
  button.addEventListener("click", () => {
    model.sourcesExpanded = !model.sourcesExpanded;
    button.setAttribute("aria-expanded", String(model.sourcesExpanded));
    const sources = model.element?.querySelector(".ai-research-sources");
    if (sources) sources.hidden = !model.sourcesExpanded;
  });
  return button;
}

export function renderResearchActions({ message, model, t, busy, onSources, onSettings, onContinue }) {
  const bubble = message.querySelector(".ai-conversation-bubble");
  bubble.querySelector(".ai-research-actions")?.remove();
  if (model.mode !== "research") return;
  const actions = document.createElement("div");
  actions.className = "ai-research-actions";
  if (model.sourcePermissionOrigins.length) {
    actions.append(createAction("key-01", "aiSearch.research.authorizeSources", t, busy, onSources));
  }
  if (model.settingsRequired) {
    actions.append(createAction("settings-01", "aiSearch.research.openSettings", t, busy, onSettings));
  }
  if (model.nextCursor) {
    actions.append(createAction("refresh-cw-01", "aiSearch.research.continue", t, busy, onContinue));
  }
  if (actions.childElementCount) bubble.insertBefore(actions, bubble.querySelector(".ai-message-footer"));
}

export function researchCoverageLabel(coverage, t) {
  const value = normalizeCoverage(coverage);
  if (!value) return "";
  const parts = [];
  if (value.folderSourcesTotal) {
    parts.push(t("aiSearch.research.coverage.folder", {
      searched: value.folderSourcesSearched,
      total: value.folderSourcesTotal,
    }));
    parts.push(t("aiSearch.research.coverage.authorized", { count: value.folderSourcesAuthorized }));
  }
  if (value.folderSourcesFailed) parts.push(t("aiSearch.research.coverage.failed", { count: value.folderSourcesFailed }));
  if (value.webResults) parts.push(t("aiSearch.research.coverage.web", { count: value.webResults }));
  if (value.fullTextsRead) parts.push(t("aiSearch.research.coverage.fullText", { count: value.fullTextsRead }));
  parts.push(t("aiSearch.research.coverage.evidence", { count: value.evidenceCount }));
  const dateSpan = researchDateSpan(value, t);
  if (dateSpan) parts.push(dateSpan);
  if (value.timeUnknownCount) parts.push(t("aiSearch.research.coverage.timeUnknown", { count: value.timeUnknownCount }));
  if (value.expandedBeyondRecent) parts.push(t("aiSearch.research.coverage.expanded"));
  return parts.join(" · ");
}

export function normalizeResearchEvidence(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = String(item.id || "").trim().toUpperCase();
    const url = safeResearchUrl(item.url);
    if (!/^S(?:[1-9]|1[0-2])$/.test(id) || !url || seen.has(id)) return [];
    seen.add(id);
    const sourceKind = ["ampira", "bookmark", "web"].includes(item.sourceKind) ? item.sourceKind : "web";
    const sourceKinds = [...new Set([...(Array.isArray(item.sourceKinds) ? item.sourceKinds : []), sourceKind])]
      .filter((kind) => ["ampira", "bookmark", "web"].includes(kind));
    const readLevel = ["full", "feed", "snippet", "bookmark"].includes(item.readLevel) ? item.readLevel : "snippet";
    return [{
      id,
      title: String(item.title || url).replace(/\s+/g, " ").trim().slice(0, 500),
      url,
      host: String(item.host || safeResearchHost(url)).trim().slice(0, 255),
      snippet: String(item.snippet || "").replace(/\s+/g, " ").trim().slice(0, 1600),
      contextBefore: String(item.contextBefore || "").replace(/\s+/g, " ").trim().slice(0, 240),
      contextAfter: String(item.contextAfter || "").replace(/\s+/g, " ").trim().slice(0, 240),
      evidenceLayer: item.evidenceLayer === "passage" ? "passage" : "source",
      documentId: String(item.documentId || "").trim().slice(0, 80),
      passageId: String(item.passageId || "").trim().slice(0, 80),
      publishedAt: validIso(item.publishedAt),
      timeVerified: item.timeVerified === true && Boolean(validIso(item.publishedAt)),
      sourceKind,
      sourceKinds,
      readLevel,
    }];
  });
}

function revealResearchPassage(model, id) {
  model.sourcesExpanded = true;
  const sources = model.element?.querySelector(".ai-research-sources");
  if (sources) sources.hidden = false;
  const toggle = model.element?.querySelector(".ai-sources-toggle");
  toggle?.setAttribute("aria-expanded", "true");
  const row = [...(sources?.querySelectorAll("[data-evidence-id]") || [])]
    .find((item) => item.dataset.evidenceId === id);
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
  row.classList.remove("is-citation-target");
  requestAnimationFrame(() => row.classList.add("is-citation-target"));
}

export function normalizeCoverage(value) {
  if (!value || typeof value !== "object") return null;
  const number = (key) => Math.max(0, Math.floor(Number(value[key]) || 0));
  return {
    folderSourcesTotal: number("folderSourcesTotal"),
    folderSourcesSearched: number("folderSourcesSearched"),
    folderSourcesAuthorized: number("folderSourcesAuthorized"),
    folderSourcesFailed: number("folderSourcesFailed"),
    webResults: number("webResults"),
    fullTextsRead: number("fullTextsRead"),
    evidenceCount: number("evidenceCount"),
    timeUnknownCount: number("timeUnknownCount"),
    oldestPublishedAt: validIso(value.oldestPublishedAt),
    newestPublishedAt: validIso(value.newestPublishedAt),
    expandedBeyondRecent: value.expandedBeyondRecent === true,
  };
}

export function safePermissionOrigins(values) {
  return [...new Set((Array.isArray(values) ? values : []).flatMap((value) => {
    const text = String(value || "").trim();
    const match = text.match(/^(https:\/\/[^/*]+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)\/\*$/i);
    return match ? [`${new URL(match[1]).origin}/*`] : [];
  }))].slice(0, 3);
}

export function normalizeResearchFolder(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim().slice(0, 256);
  const path = String(value.path || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  const title = String(value.title || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!id || !path || !title) return null;
  return {
    id,
    path,
    title,
    bookmarkCount: Math.max(0, Math.floor(Number(value.bookmarkCount) || 0)),
    siteCount: Math.max(0, Math.floor(Number(value.siteCount) || 0)),
  };
}

export async function loadResearchFolderOptions(apiGet) {
  try {
    const result = await apiGet("/api/research/folders");
    const consentRequired = result?.bookmarkConsentGranted === false;
    const folders = !consentRequired && Array.isArray(result?.folders)
      ? result.folders.map(normalizeResearchFolder).filter(Boolean)
      : [];
    return {
      folders,
      status: consentRequired ? "consent" : folders.length ? "ready" : "empty",
    };
  } catch {
    return {
      folders: [],
      status: "error",
    };
  }
}

export function renderResearchFolderOptions({ select, folders, selectedId, status = "ready", t }) {
  const fragment = document.createDocumentFragment();
  const allLabel = t("aiSearch.research.folderAll");
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = t("aiSearch.research.folderNone");
  empty.dataset.comboboxTriggerLabel = empty.textContent;
  fragment.append(empty);
  const statusKey = researchFolderStatusKey(status);
  if (statusKey) {
    const stateOption = document.createElement("option");
    stateOption.disabled = true;
    stateOption.textContent = t(statusKey);
    fragment.append(stateOption);
  }
  for (const folder of folders) {
    const option = document.createElement("option");
    const displayPath = researchFolderDisplayPath(folder, folders, allLabel);
    const meta = t("aiSearch.research.folderOptionMeta", {
      count: folder.bookmarkCount,
      sites: folder.siteCount,
    });
    option.value = folder.id;
    option.textContent = t("aiSearch.research.folderOption", {
      path: displayPath,
      count: folder.bookmarkCount,
      sites: folder.siteCount,
    });
    option.dataset.comboboxOptionLabel = displayPath;
    option.dataset.comboboxOptionMeta = meta;
    option.dataset.comboboxTriggerLabel = shortResearchFolderLabel(folder, folders, allLabel);
    option.title = option.textContent;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = folders.some((folder) => folder.id === selectedId) ? selectedId : "";
}

export function researchFolderDisplayPath(folder, folders = [], allLabel = "") {
  const parts = folderPathParts(folder?.path);
  if (!parts.length) return String(folder?.title || "").trim();
  const roots = folders.map((item) => folderPathParts(item?.path)[0] || "").filter(Boolean);
  const commonRoot = roots.length === folders.length && new Set(roots).size === 1 ? roots[0] : "";
  if (!commonRoot || parts[0] !== commonRoot) return parts.join(" / ");
  return parts.length === 1 ? (allLabel || parts[0]) : parts.slice(1).join(" / ");
}

export function shortResearchFolderLabel(folder, folders = [], allLabel = "") {
  const title = String(folder?.title || "").trim();
  const displayPath = researchFolderDisplayPath(folder, folders, allLabel);
  if (displayPath === allLabel && allLabel) return allLabel;
  const duplicates = folders.filter((item) => String(item?.title || "").trim() === title).length;
  if (duplicates < 2) return title;
  const path = folderPathParts(displayPath);
  return path.length > 1 ? `${path.at(-2)} / ${title}` : title;
}

function folderPathParts(value) {
  return String(value || "").split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
}

export function researchFolderStatusKey(status) {
  if (status === "loading") return "aiSearch.research.folderLoading";
  if (status === "consent") return "aiSearch.research.folderConsentRequired";
  if (status === "empty") return "aiSearch.research.folderEmpty";
  if (status === "error") return "aiSearch.research.folderLoadError";
  return "";
}

function researchSourceMeta(item, t) {
  const parts = [
    item.host,
    item.publishedAt ? formatDate(item.publishedAt) : t("aiSearch.research.timeUnknown"),
    (item.sourceKinds?.length ? item.sourceKinds : [item.sourceKind])
      .map((kind) => t(`aiSearch.research.sourceKind.${kind}`)).join(" + "),
  ];
  return parts.filter(Boolean).join(" · ");
}

function researchScopeLabel(scope, t) {
  const folder = scope?.bookmarkFolderTitle || t("aiSearch.research.folderNone");
  if (scope?.bookmarkFolderId && scope?.webSearch) return t("aiSearch.research.scope.bookmarkWeb", { folder });
  if (scope?.bookmarkFolderId) return t("aiSearch.research.scope.bookmark", { folder });
  if (scope?.webSearch) return t("aiSearch.research.scope.web");
  return t("aiSearch.research.scope.default");
}

function createAction(iconName, key, t, busy, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn ghost ai-research-action";
  const label = document.createElement("span");
  label.textContent = t(key);
  button.append(createThemedIcon(iconName, "btn-icon"), label);
  button.addEventListener("click", async () => {
    if (button.disabled || busy()) return;
    button.disabled = true;
    try {
      const keepDisabled = await action(button);
      if (keepDisabled === false) button.disabled = false;
    } catch {
      button.disabled = false;
    }
  });
  return button;
}

function researchDateSpan(coverage, t) {
  if (!coverage.oldestPublishedAt || !coverage.newestPublishedAt) return "";
  const oldest = formatDate(coverage.oldestPublishedAt);
  const newest = formatDate(coverage.newestPublishedAt);
  return oldest === newest
    ? t("aiSearch.research.coverage.date", { date: oldest })
    : t("aiSearch.research.coverage.dateSpan", { oldest, newest });
}

function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function safeResearchUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return "";
    return url.href;
  } catch {
    return "";
  }
}

function safeResearchHost(value) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function validIso(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}
