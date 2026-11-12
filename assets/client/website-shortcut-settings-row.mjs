export function createWebsiteShortcutSettingsRow(options) {
  const { shortcut, index, count, editingIndex, busy, t, setIconLabel, onEdit, onMove, onRemove } = options;
  const row = document.createElement("div");
  row.className = "website-shortcut-settings-row";
  row.classList.toggle("is-editing", index === editingIndex);
  row.draggable = count > 1 && !busy;
  row.dataset.shortcutIndex = String(index);
  row.dataset.shortcutUrl = shortcut.url;
  row.dataset.key = shortcut.url;

  const main = document.createElement("div");
  main.className = "website-shortcut-settings-main";
  const title = document.createElement("strong");
  title.textContent = shortcut.title;
  const url = document.createElement("span");
  url.textContent = shortcut.url;
  main.append(title, url);

  const actions = document.createElement("div");
  actions.className = "website-shortcut-settings-actions";
  const edit = iconButton("edit-05", t("settings.shortcuts.edit"), () => onEdit(index), setIconLabel);
  edit.classList.add("shortcut-edit-action");
  const up = iconButton("send-up", t("settings.shortcuts.moveUp", { title: shortcut.title }), () => onMove(index, -1), setIconLabel);
  const down = iconButton("arrow-down", t("settings.shortcuts.moveDown", { title: shortcut.title }), () => onMove(index, 1), setIconLabel);
  up.disabled = busy || index === 0;
  down.disabled = busy || index === count - 1;
  const remove = iconButton("trash-01", t("settings.shortcuts.remove"), () => onRemove(index), setIconLabel);
  remove.classList.add("website-shortcut-remove");
  edit.disabled = busy;
  remove.disabled = busy;
  actions.append(edit, up, down, remove);
  row.append(main, actions);
  return row;
}

function iconButton(icon, label, onClick, setIconLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  setIconLabel(button, icon, label, "btn-icon", "sr-only");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", onClick);
  return button;
}
