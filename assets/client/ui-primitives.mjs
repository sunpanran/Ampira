import { spanText } from "./dom.mjs";
import { createIcon } from "./icons.mjs";
import { allTranslations } from "./i18n.mjs";

export function setIconLabel(node, icon, label, iconClass = "btn-icon", labelClass = "btn-label") {
  node.replaceChildren(createIcon(icon, iconClass), spanText(label, labelClass));
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
