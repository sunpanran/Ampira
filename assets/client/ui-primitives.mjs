import { spanText } from "./dom.mjs";
import { createIcon } from "./icons.mjs";
import { allTranslations } from "./i18n.mjs";

export function setIconLabel(node, icon, label, iconClass = "btn-icon", labelClass = "btn-label") {
  node.replaceChildren(createIcon(icon, iconClass), spanText(label, labelClass));
}

export function createAiLoadingState({
  statusText = "",
  noteText = "",
  paragraphCount = 3,
  lineCount = 2,
  variant = "brief",
} = {}) {
  const loading = document.createElement("div");
  const normalizedVariant = ["brief", "answer", "compact"].includes(variant) ? variant : "brief";
  loading.className = `ai-loading-state is-${normalizedVariant}`;
  loading.setAttribute("role", "status");
  loading.setAttribute("aria-live", "polite");
  if (statusText) loading.setAttribute("aria-label", statusText);

  const lines = document.createElement("div");
  lines.className = "ai-loading-lines";
  lines.setAttribute("aria-hidden", "true");
  const paragraphs = Math.max(1, Math.min(4, Number(paragraphCount) || 1));
  const linesPerParagraph = Math.max(1, Math.min(4, Number(lineCount) || 1));
  for (let paragraphIndex = 0; paragraphIndex < paragraphs; paragraphIndex += 1) {
    const paragraph = document.createElement("span");
    paragraph.className = "ai-loading-paragraph";
    for (let lineIndex = 0; lineIndex < linesPerParagraph; lineIndex += 1) {
      const line = document.createElement("span");
      line.className = "loading-line ai-loading-line";
      paragraph.append(line);
    }
    lines.append(paragraph);
  }
  loading.append(lines);

  if (noteText) {
    const note = document.createElement("span");
    note.className = "ai-loading-note";
    note.setAttribute("aria-hidden", "true");
    note.textContent = noteText;
    loading.append(note);
  }
  return loading;
}

export function createEmptyState({ title = "", body = "", variant = "panel", actionLabel = "", onAction } = {}) {
  const node = document.createElement("div");
  const normalizedVariant = variant || "panel";
  node.className = `empty-state is-${normalizedVariant}${normalizedVariant === "error" ? " is-compact" : ""}`;
  if (normalizedVariant === "error") node.setAttribute("role", "alert");

  const copy = document.createElement("div");
  copy.className = "empty-state-copy";
  if (title) {
    const heading = document.createElement("div");
    heading.className = "empty-state-title";
    heading.textContent = title;
    copy.append(heading);
  }
  if (body) {
    const description = document.createElement("div");
    description.className = "empty-state-body";
    description.textContent = body;
    copy.append(description);
  }
  if (actionLabel && typeof onAction === "function") {
    const action = document.createElement("button");
    action.type = "button";
    action.className = `btn empty-state-action${normalizedVariant === "plain" ? " primary" : ""}`;
    if (normalizedVariant === "plain") {
      action.textContent = actionLabel;
    } else {
      setIconLabel(action, emptyActionIcon(actionLabel), actionLabel, "inline-icon", "btn-label");
    }
    action.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onAction(event);
    });
    copy.append(action);
  }
  node.append(copy);
  return node;
}

function emptyActionIcon(label) {
  if (allTranslations("action.openSettings").some((value) => label.includes(value))) return "settings";
  if (allTranslations("context.bookmarkSettings").some((value) => label.includes(value))) return "settings";
  if (allTranslations("action.configureAi").some((value) => label.includes(value))) return "settings";
  if (allTranslations("action.generateDigest").some((value) => label.includes(value))) return "refresh-cw-01";
  if (allTranslations("action.reorganize").some((value) => label.includes(value))) return "refresh-cw-01";
  return "arrow-up-right";
}
