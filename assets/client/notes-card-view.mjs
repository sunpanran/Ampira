import { NOTE_LIMIT, NOTE_TEXT_LIMIT, sortedNotes } from "../../extension/core/notes.mjs";
import { personalCardControls } from "./personal-card-controls.mjs";

export function createNotesCardView({ id, state, t, getLocale, createIcon, notesState, requestRender, isActive, localizedErrorMessage, confirmAction }) {
  const { node, button, iconButton, labelButton } = personalCardControls(createIcon);
  let draft = null, error = "", requestError = null, feedback = "", timer = 0, saving = null, acting = false;
  const root = node("div", "personal-card-content notes-content");
  const notice = node("div", "utility-inline-status personal-card-notice"); notice.id = "notes-notice-" + id; notice.setAttribute("role", "status");
  const list = node("div", "notes-list utility-scroll-list");
  const empty = button("notes-empty", () => open());
  const editor = node("div", "notes-editor");
  const input = node("textarea", "notes-input"); input.maxLength = NOTE_TEXT_LIMIT; input.spellcheck = true;
  input.setAttribute("aria-describedby", notice.id);
  const footer = node("div", "notes-editor-footer");
  const copy = button("efficiency-action", () => saveCopy());
  const discard = button("efficiency-action", () => close());
  const count = node("span", "notes-count"); footer.append(copy, discard, count); editor.append(input, footer);
  root.append(notice, empty, list, editor);
  const saveButton = button("btn primary", async () => { if (await save()) close(); });
  const add = iconButton("plus", () => open());
  const pin = iconButton("pin", () => act("pin"));
  const todo = iconButton("list-check", () => act("todo"));
  const remove = iconButton("trash-01", async () => {
    if (!draft || acting) return;
    clearTimeout(timer); timer = 0;
    if (saving) await saving;
    if (confirmAction && !await confirmAction({ title: t("notes.deleteTitle"), body: t("notes.deleteBody"),
      cancelLabel: t("action.cancel"), confirmLabel: t("notes.remove"), tone: "danger" })) return;
    if ((await act("remove"))?.ok) close();
  });
  const retry = iconButton("refresh-cw-01", async () => {
    error = ""; requestError = null;
    if (dirty()) await save();
    else if (notesState.read().error) await notesState.ensure({ force: true });
    else await notesState.retrySync();
  });
  input.addEventListener("input", event => {
    if (!draft) return;
    draft.text = input.value; feedback = "";
    if (!["changed", "removed"].includes(error)) error = "";
    clearTimeout(timer);
    if (!event.isComposing && !error) timer = setTimeout(save, 400);
    requestRender();
  });
  input.addEventListener("compositionend", () => { clearTimeout(timer); if (!error) timer = setTimeout(save, 400); });
  input.addEventListener("blur", event => {
    if (event.relatedTarget?.closest("[data-dashboard-card]")?.dataset.dashboardCard !== id) save();
  });
  input.addEventListener("keydown", async event => {
    if (event.isComposing || event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); if (await save()) close();
  });
  window.addEventListener("beforeunload", event => { if (dirty()) { event.preventDefault(); event.returnValue = ""; } });
  window.addEventListener("pagehide", () => save());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });
  notesState.ensure();
  return { render, deactivate: () => { save(); } };

  function dirty() { return Boolean(draft && draft.text !== draft.savedText && (draft.created || draft.text.trim())); }
  function open(item) {
    if (!notesState.read().loaded || notesState.read().busy) return;
    draft = { id: item?.id || globalThis.crypto.randomUUID(), revision: item?.revision || 0,
      created: Boolean(item), text: item?.text || "", savedText: item?.text || "" };
    error = ""; requestError = null; feedback = ""; input.value = draft.text; requestRender(); input.focus({ preventScroll: true });
  }
  function close() {
    draft = null; error = ""; requestError = null; feedback = ""; requestRender(); if (isActive()) add.focus({ preventScroll: true });
  }
  async function save() {
    clearTimeout(timer); timer = 0;
    if (saving) { await saving; return error ? false : save(); }
    if (!dirty()) return true;
    if (["changed", "removed"].includes(error)) return false;
    const current = draft, text = current.text;
    saving = Promise.resolve().then(async () => {
      if (notesState.read().busy) await notesState.ensure();
      const result = await notesState.change({ type: current.created ? "save" : "create", id: current.id, revision: current.revision, text });
      if (!result.ok) { error = result.reason; requestError = result.error || null; return false; }
      const saved = notesState.read().value.items.find(item => item.id === current.id);
      if (!saved || saved.text !== text) { error = saved ? "changed" : "removed"; return false; }
      current.created = true; current.revision = saved.revision; current.savedText = text; error = ""; requestError = null;
      return true;
    }).finally(() => { saving = null; requestRender(); });
    const success = await saving;
    return success && dirty() ? save() : success;
  }
  async function saveCopy() {
    if (saving || !draft?.text.trim()) return;
    draft = { id: globalThis.crypto.randomUUID(), revision: 0, created: false, text: draft.text, savedText: "" };
    error = ""; await save();
  }
  async function act(type) {
    if (acting || !draft || type !== "remove" && !await save()) return;
    const target = draft; acting = true; requestRender();
    try {
      if (notesState.read().busy) await notesState.ensure();
      const result = await notesState.change({ type, id: target.id, revision: target.revision });
      if (!result.ok) { error = result.reason; requestError = result.error || null; }
      else {
        const current = notesState.read().value.items.find(item => item.id === target.id);
        if (current) target.revision = current.revision;
        if (type === "todo") feedback = "notes.todoAdded";
      }
      return result;
    } finally { acting = false; requestRender(); }
  }
  function render() {
    if (state.settings?.syncNotesEnabled === false) notesState.clearSyncError();
    const shared = notesState.read(), conflict = ["changed", "removed"].includes(error);
    if (draft?.created && !dirty() && !saving && !shared.busy) {
      const current = shared.value.items.find(item => item.id === draft.id);
      if (current && current.revision !== draft.revision) {
        draft.revision = current.revision; draft.text = draft.savedText = current.text; input.value = current.text;
      }
    }
    const syncError = state.settings?.syncNotesEnabled === false ? null : shared.syncError;
    const message = error && error !== "request" ? t("notes.error." + error, { count: NOTE_LIMIT, limit: NOTE_TEXT_LIMIT })
      : requestError || shared.error ? t("notes.error.request", { message: localizedErrorMessage(requestError || shared.error) })
        : syncError ? t("notes.syncFailed", { message: syncError.messageKey ? t(syncError.messageKey, syncError.messageParams) : localizedErrorMessage(syncError) })
          : !shared.loaded ? t("personalCards.loading") : feedback ? t(feedback) : "";
    notice.textContent = message; notice.hidden = !message;
    notice.classList.toggle("is-error", Boolean(error || shared.error || syncError));
    notice.setAttribute("role", error || shared.error || syncError ? "alert" : "status");
    input.placeholder = t("notes.placeholder"); input.setAttribute("aria-label", t("notes.inputLabel"));
    input.title = t("notes.textLimit", { count: NOTE_TEXT_LIMIT }); input.setAttribute("aria-invalid", String(Boolean(error)));
    empty.textContent = t("notes.empty"); empty.disabled = !shared.loaded || shared.busy;
    empty.hidden = Boolean(draft || shared.value.items.length || !shared.loaded);
    editor.hidden = !draft; list.hidden = Boolean(draft || !shared.value.items.length);
    copy.textContent = t("notes.saveCopy"); copy.hidden = !conflict; copy.disabled = shared.busy;
    discard.textContent = t("notes.discard"); discard.hidden = !conflict;
    count.textContent = `${draft?.text.length || 0} / ${NOTE_TEXT_LIMIT}`; count.hidden = (draft?.text.length || 0) < NOTE_TEXT_LIMIT * .8;
    footer.hidden = copy.hidden && count.hidden;
    const item = shared.value.items.find(item => item.id === draft?.id);
    labelButton(add, t(shared.value.items.length >= NOTE_LIMIT ? "notes.error.limit" : "notes.add", { count: NOTE_LIMIT }));
    add.disabled = !shared.loaded || shared.busy || shared.value.items.length >= NOTE_LIMIT;
    saveButton.textContent = t("personalCards.save"); labelButton(saveButton, saveButton.textContent); saveButton.disabled = acting;
    labelButton(pin, t(item?.pinned ? "notes.unpin" : "notes.pin"));
    pin.setAttribute("aria-pressed", String(Boolean(item?.pinned)));
    labelButton(todo, t("notes.toTodo")); labelButton(remove, t("notes.remove")); labelButton(retry, t("personalCards.retry"));
    for (const control of [pin, todo, remove]) control.disabled = !draft?.created || shared.busy || Boolean(saving) || acting || conflict;
    retry.hidden = !requestError && !shared.error && !syncError;
    retry.disabled = shared.busy || Boolean(saving);
    if (!draft) renderList(shared.value);
    return { content: root, actions: [...(retry.hidden ? [] : [retry]), ...(draft ? [remove, todo, pin, saveButton] : [add])] };
  }
  function renderList(value) {
    const old = new Map(Array.from(list.children, row => [row.dataset.key, row]));
    const rows = sortedNotes(value).map(item => {
      let row = old.get(item.id);
      if (!row) {
        row = button("notes-row", () => open(notesState.read().value.items.find(value => value.id === item.id)));
        row.dataset.key = item.id;
        row.append(node("span", "notes-row-text"), node("span", "notes-row-meta"));
      }
      row.firstElementChild.textContent = item.text;
      row.lastElementChild.textContent = [item.pinned ? t("notes.pinned") : "",
        new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" }).format(new Date(item.updatedAt))].filter(Boolean).join(" · ");
      row.title = item.text; return row;
    });
    rows.forEach((row, index) => { if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null); });
    while (list.children.length > rows.length) list.lastElementChild.remove();
  }
}
