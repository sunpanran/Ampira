import { TOPIC_LIMIT, TOPIC_NAME_LIMIT, TOPIC_KEYWORDS_LIMIT, TOPIC_ITEM_LIMIT } from "../../extension/core/tracked-topics.mjs";
import { selectTrackedItems } from "./topic-matching.mjs";
import { summaryDetailLines } from "./item-presenter.mjs";
import { spanText } from "./dom.mjs";
import { enhanceSelectComboboxes } from "./select-combobox.mjs";
import { personalCardControls } from "./personal-card-controls.mjs";

export function createTopicsCardView({ id, state, t, createIcon, createEmptyState, topicsState, requestRender,
  readJson, writeJson, newsSummaryItems, formatDateTime, displaySummaryTitle, isQueued, toggleReadingQueue,
  openDailyItem, attachLinkContextMenu, localizedErrorMessage }) {
  const { node, button, iconButton, labelButton, field, select, choices } = personalCardControls(createIcon);
  const preferenceKey = "dash.topics.view." + id;
  const preferences = readJson(preferenceKey, {});
  let selected = typeof preferences?.selected === "string" ? preferences.selected : "";
  let editing = false, editingId = "", editingRevision = 0;
  let detailKey = "", error = "", visibleItems = [];
  const root = node("div", "personal-card-content topics-content");
  const notice = node("div", "utility-inline-status is-error personal-card-notice"); notice.setAttribute("role", "alert");
  const main = node("div", "topics-main");
  const tabs = node("div", "topics-tabs"); tabs.setAttribute("role", "group");
  const list = node("div", "topics-list utility-scroll-list");
  const empty = node("div", "topics-empty");
  main.append(tabs, list, empty);
  const form = node("form", "personal-card-editor topics-editor");
  form.id = "topics-form-" + id; form.noValidate = true;
  const name = node("input", "utility-entry-input"); name.type = "text"; name.maxLength = TOPIC_NAME_LIMIT; name.autocomplete = "off";
  const keywords = node("input", "utility-entry-input"); keywords.type = "text"; keywords.maxLength = TOPIC_KEYWORDS_LIMIT; keywords.autocomplete = "off";
  const source = select("topics-source-" + id);
  const nameField = field(name), keywordField = field(keywords), sourceField = field(source);
  const hint = spanText("", "personal-card-help"); keywordField.label.append(hint);
  const formActions = node("div", "personal-card-form-actions");
  const remove = button("topics-text-action is-danger", async () => {
    const outcome = await change({ type: "remove", id: editingId, revision: editingRevision });
    if (outcome?.ok) closeEditor();
  });
  const save = button("btn primary"); save.type = "submit";
  formActions.append(remove, save);
  form.append(nameField.label, keywordField.label, sourceField.label, formActions);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const outcome = await change({ type: "save", id: editingId, revision: editingRevision,
      name: name.value, words: keywords.value, source: source.value });
    if (outcome?.ok) { selected = outcome.id; persistPreferences(); closeEditor(); }
    else if (["keywordsRequired", "keywordsLimit"].includes(error)) keywords.focus({ preventScroll: true });
    else name.focus({ preventScroll: true });
  });
  const detail = node("div", "topics-detail");
  const detailBack = button("topics-text-action topics-detail-back", () => { detailKey = ""; requestRender(); focusSelected(); });
  detailBack.append(createIcon("keyboard-return", "inline-icon"), spanText(""));
  const detailHeading = node("h3", "topics-detail-title");
  const detailMeta = node("div", "topics-detail-meta");
  const detailBody = node("div", "topics-detail-copy");
  const detailMatch = node("div", "personal-card-help topics-match");
  const detailActions = node("div", "topics-detail-actions");
  const detailOpen = button("btn", () => { const entry = currentEntry(); if (entry) openDailyItem(entry.item); });
  const detailQueue = button("action-toggle", () => { const entry = currentEntry(); if (entry) toggleReadingQueue(entry.item); requestRender(); });
  detailActions.append(detailOpen, detailQueue);
  detail.append(detailBack, detailHeading, detailMeta, detailBody, detailMatch, detailActions);
  const add = iconButton("plus", () => editing || detailKey ? back() : openEditor());
  add.setAttribute("aria-controls", form.id);
  const edit = iconButton("settings", () => openEditor(currentTopic()));
  const retry = iconButton("refresh-cw-01", () => { error = ""; topicsState.ensure({ force: true }); });
  root.append(notice, main, form, detail);
  root.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !editing && !detailKey) return;
    event.preventDefault(); event.stopPropagation(); back();
  });
  return { render, deactivate() { editing = false; detailKey = ""; error = ""; } };

  function currentTopic() { return topicsState.read().value.topics.find(topic => topic.id === selected); }
  function currentEntry() { return visibleItems.find(entry => entry.key === detailKey); }
  function persistPreferences() { writeJson(preferenceKey, { selected }); }
  async function change(action) {
    error = "";
    const outcome = await topicsState.change(action);
    if (!outcome.ok && outcome.reason !== "busy") error = outcome.reason;
    requestRender(); return outcome;
  }
  function openEditor(topic = null) {
    editing = true; editingId = topic?.id || ""; editingRevision = topic?.revision || 0;
    detailKey = ""; error = ""; name.value = topic?.name || ""; keywords.value = topic?.words.join("，") || "";
    source.value = topic?.source || "all"; requestRender(); name.focus({ preventScroll: true });
  }
  function closeEditor() { editing = false; editingId = ""; error = ""; requestRender(); focusSelected(); }
  function back() { detailKey = ""; closeEditor(); }
  function focusSelected() {
    const target = Array.from(tabs.children).find(item => item.dataset.key === selected);
    (target || add).focus({ preventScroll: true });
  }
  function render() {
    let shared = topicsState.read();
    if (!shared.loaded && !shared.busy && !shared.error) { topicsState.ensure(); shared = topicsState.read(); }
    if (!shared.loaded) return { busy: shared.busy, content: createEmptyState({
      title: t(shared.error ? "personalCards.loadError" : "personalCards.loading"),
      body: shared.error ? localizedErrorMessage(shared.error) : "", variant: "compact",
      actionLabel: shared.error ? t("personalCards.retry") : "", onAction: () => topicsState.ensure({ force: true }),
    }) };
    const value = shared.value;
    if (!value.topics.some(topic => topic.id === selected)) selected = value.topics[0]?.id || "";
    const topic = currentTopic();
    visibleItems = selectTrackedItems(newsSummaryItems(), topic, { dismissed: state.dismissed }).slice(0, TOPIC_ITEM_LIMIT);
    if (detailKey && !currentEntry()) detailKey = "";
    root.classList.toggle("is-editing", editing);
    main.hidden = editing || Boolean(detailKey); form.hidden = !editing; detail.hidden = !detailKey;
    const message = error && error !== "request" ? t("topics.error." + error, { count: TOPIC_LIMIT })
      : shared.error ? localizedErrorMessage(shared.error) : "";
    notice.hidden = !message; notice.textContent = message;
    edit.hidden = editing || Boolean(detailKey) || !topic; edit.disabled = shared.busy;
    add.disabled = shared.busy || !editing && !detailKey && value.topics.length >= TOPIC_LIMIT;
    const addIcon = editing || detailKey ? "x-close" : "plus";
    if (add.dataset.icon !== addIcon) { add.dataset.icon = addIcon; add.replaceChildren(createIcon(addIcon, "action-toggle-icon")); }
    labelButton(add, t(editing || detailKey ? "personalCards.back" : value.topics.length >= TOPIC_LIMIT ? "topics.error.limit" : "topics.add", { count: TOPIC_LIMIT }));
    add.setAttribute("aria-expanded", String(editing)); labelButton(edit, t("topics.edit")); labelButton(retry, t("personalCards.retry"));
    renderTabs(value);
    tabs.setAttribute("aria-label", t("topics.followed"));
    renderRows();
    list.hidden = !visibleItems.length; empty.hidden = Boolean(visibleItems.length);
    if (!visibleItems.length) {
      const kind = topic ? "match" : "first";
      const title = t("topics.empty." + kind + ".title"), body = t("topics.empty." + kind + ".body");
      const actionLabel = t(topic ? "topics.editKeywords" : "topics.add");
      const signature = JSON.stringify([kind, title, body, actionLabel]);
      if (empty.dataset.state !== signature) {
        empty.dataset.state = signature;
        const content = createEmptyState({ title, body, variant: "compact" });
        const action = button("topics-text-action topics-empty-action", () => openEditor(currentTopic()));
        action.textContent = actionLabel;
        content.querySelector(".empty-state-copy").append(action);
        empty.replaceChildren(content);
      }
    }
    nameField.caption.textContent = t("topics.name"); keywordField.caption.textContent = t("topics.keywords");
    sourceField.caption.textContent = t("topics.source"); hint.textContent = t("topics.keywordsHelp");
    name.placeholder = t("topics.namePlaceholder"); keywords.placeholder = t("topics.keywordsPlaceholder");
    name.setAttribute("aria-label", t("topics.name")); keywords.setAttribute("aria-label", t("topics.keywords")); source.setAttribute("aria-label", t("topics.source"));
    name.setAttribute("aria-invalid", String(["nameRequired", "duplicate"].includes(error))); keywords.setAttribute("aria-invalid", String(["keywordsRequired", "keywordsLimit"].includes(error)));
    choices(source, ["all", "bookmarks", "public"].map(key => [key, t("topics.source." + key)]), source.value || "all");
    name.disabled = keywords.disabled = source.disabled = save.disabled = remove.disabled = shared.busy;
    save.textContent = t(editingId ? "personalCards.save" : "topics.follow"); remove.hidden = !editingId; remove.textContent = t("topics.remove");
    if (detailKey) renderDetail(shared.busy);
    queueMicrotask(() => { if (root.isConnected) enhanceSelectComboboxes(root); });
    return { content: root, actions: [...(shared.error ? [retry] : []), edit, add].filter(control => !control.hidden) };
  }
  function renderTabs(value) {
    const old = new Map(Array.from(tabs.children, control => [control.dataset.key, control]));
    const controls = value.topics.map(topic => {
      let control = old.get(topic.id);
      if (!control) {
        control = button("topics-tab", () => { selected = topic.id; detailKey = ""; error = ""; persistPreferences(); requestRender(); focusSelected(); });
        control.dataset.key = topic.id; control.append(spanText("", "topics-tab-label"));
      }
      control.firstElementChild.textContent = topic.name;
      control.title = topic.name; control.setAttribute("aria-pressed", String(selected === topic.id));
      control.setAttribute("aria-label", topic.name);
      return control;
    });
    reconcile(tabs, controls);
  }
  function renderRows() {
    const old = new Map(Array.from(list.children, row => [row.dataset.key, row]));
    const rows = visibleItems.map(entry => {
      let row = old.get(entry.key);
      if (!row) {
        row = button("efficiency-row topics-row", () => {
          detailKey = row.dataset.key; requestRender(); detailBack.focus({ preventScroll: true });
        });
        row.dataset.key = entry.key;
        const copy = node("span", "efficiency-row-main");
        copy.append(spanText("", "efficiency-row-title"), spanText("", "efficiency-row-meta"));
        row.append(copy);
        attachLinkContextMenu(row, () => ({ item: row.ampiraItem, title: displaySummaryTitle(row.ampiraItem), url: row.ampiraItem?.url || "" }));
      }
      row.ampiraItem = entry.item;
      const title = displaySummaryTitle(entry.item);
      row.querySelector(".efficiency-row-title").textContent = title;
      row.querySelector(".efficiency-row-meta").textContent = itemMeta(entry);
      row.title = title; row.setAttribute("aria-label", title);
      return row;
    });
    reconcile(list, rows);
  }
  function itemMeta(entry) {
    return [entry.item.publisher || entry.item.feedItem?.source || entry.item.host, entry.timestamp ? formatDateTime(entry.timestamp) : ""].filter(Boolean).join(" · ");
  }
  function renderDetail(busy) {
    const entry = currentEntry();
    if (!entry) return;
    detailBack.lastElementChild.textContent = currentTopic()?.name || t("personalCards.back");
    detailHeading.textContent = displaySummaryTitle(entry.item);
    detailMeta.textContent = itemMeta(entry);
    const lines = summaryDetailLines(entry.item);
    const copy = lines.length ? lines : [entry.item.feedItem?.excerpt || t("topics.noExcerpt")];
    const signature = JSON.stringify(copy);
    if (detailBody.dataset.copy !== signature) {
      detailBody.dataset.copy = signature;
      detailBody.replaceChildren(...copy.map(line => { const paragraph = node("p"); paragraph.textContent = line; return paragraph; }));
    }
    detailMatch.textContent = t("topics.matched", { words: entry.words.join(" · ") });
    detailOpen.textContent = t("topics.openArticle");
    const queued = isQueued(entry.item);
    const label = t(queued ? "action.removeReadingQueue" : "action.addReadingQueue");
    labelButton(detailQueue, label); detailQueue.setAttribute("aria-pressed", String(queued)); detailQueue.disabled = busy;
    detailQueue.classList.toggle("is-active", queued);
    const icon = queued ? "bookmark-filled" : "bookmark-ribbon";
    if (detailQueue.dataset.icon !== icon) { detailQueue.dataset.icon = icon; detailQueue.replaceChildren(createIcon(icon, "action-toggle-icon")); }
  }
  function reconcile(parent, nodes) {
    nodes.forEach((child, index) => { if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] || null); });
    while (parent.children.length > nodes.length) parent.lastElementChild.remove();
  }
}
