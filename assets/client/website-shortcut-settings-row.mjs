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
  const edit = textButton(t("settings.shortcuts.edit"), () => onEdit(index));
  edit.classList.add("shortcut-edit-action");
  const up = orderButton("↑", t("settings.shortcuts.moveUp", { title: shortcut.title }), () => onMove(index, -1));
  const down = orderButton("↓", t("settings.shortcuts.moveDown", { title: shortcut.title }), () => onMove(index, 1));
  up.disabled = busy || index === 0;
  down.disabled = busy || index === count - 1;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn website-shortcut-remove";
  setIconLabel(remove, "trash-01", t("settings.shortcuts.remove"));
  remove.addEventListener("click", () => onRemove(index));
  edit.disabled = busy;
  remove.disabled = busy;
  actions.append(edit, up, down, remove);
  row.append(main, actions);
  return row;
}

function textButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function orderButton(glyph, label, onClick) {
  const button = textButton(glyph, onClick);
  button.classList.add("website-shortcut-order");
  button.setAttribute("aria-label", label);
  button.title = label;
  return button;
}
