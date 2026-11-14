import { customFeedSource, MAX_CUSTOM_FEEDS, MAX_CUSTOM_FEED_TITLE, normalizeCustomFeedUrl } from "../../extension/core/custom-feeds.mjs";
import { isNewsSourceExcluded } from "../../extension/core/bookmarks.mjs";
import { requestOrigins } from "./permission-client.mjs";
import { createIcon } from "./icons.mjs";

export function createCustomFeedSettings(options) {
  const { state, els, t, request, runSettingsAction, renderSettingsStatus, localizedErrorMessage } = options;
  let candidate = null, editingUrl = "", busy = false, generation = 0;
  els.customFeedCheck.addEventListener("click", check);
  els.customFeedConfirm.addEventListener("click", commit);
  els.customFeedCancel.addEventListener("click", () => { resetEditor(); els.customFeedUrl.focus(); });
  els.customFeedUrl.addEventListener("input", resetEditor);
  els.customFeedUrl.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); check(); }
  });
  els.customFeedTitle.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); commit(); }
  });
  return { render, reset, setBusy };

  function feeds() { return Array.isArray(state.settings?.customFeeds) ? state.settings.customFeeds : []; }

  function update(next) {
    state.settings = { ...state.settings, customFeeds: next };
    render();
    renderSettingsStatus();
  }

  function resetEditor() {
    generation += 1;
    candidate = null;
    editingUrl = "";
    els.customFeedPreview.hidden = true;
    els.customFeedPreviewItems.replaceChildren();
    els.customFeedTitle.value = "";
    els.customFeedConfirm.textContent = t("settings.feeds.add");
    els.customFeedConfirm.dataset.i18n = "settings.feeds.add";
  }

  function reset() {
    resetEditor();
    els.customFeedUrl.value = "";
    render();
  }

  function check() {
    if (busy) return;
    const url = normalizeCustomFeedUrl(els.customFeedUrl.value);
    if (!url) return renderSettingsStatus(t("settings.feeds.invalidUrl"), "error");
    if (feeds().some(feed => feed.url === url)) return renderSettingsStatus(t("settings.feeds.duplicate"), "error");
    if (feeds().length >= MAX_CUSTOM_FEEDS) return renderSettingsStatus(t("settings.feeds.limit", { count: MAX_CUSTOM_FEEDS }), "error");
    resetEditor();
    const expected = generation;
    // Request directly in the click handler so Chrome retains the user gesture.
    const permission = requestOrigins([`${new URL(url).origin}/*`]);
    return runSettingsAction(async isCurrent => {
      renderSettingsStatus(t("settings.feeds.checking"));
      try {
        if (!await permission) {
          if (isCurrent() && expected === generation) renderSettingsStatus(t("settings.feeds.permissionDenied"), "error");
          return;
        }
        if (!isCurrent() || expected !== generation) return;
        const result = await request({ type: "feeds:preview", payload: { url } });
        if (!isCurrent() || expected !== generation) return;
        candidate = { url, title: result.title, enabled: true };
        els.customFeedTitle.value = result.title;
        const items = result.items.map(item => {
          const li = document.createElement("li");
          li.textContent = item.title;
          return li;
        });
        if (!items.length) {
          const li = document.createElement("li");
          li.textContent = t("settings.feeds.noEntries");
          items.push(li);
        }
        els.customFeedPreviewItems.replaceChildren(...items);
        els.customFeedPreview.hidden = false;
        renderSettingsStatus("", "ready");
      } catch (error) {
        if (isCurrent() && expected === generation) renderSettingsStatus(localizedErrorMessage(error), "error");
      }
    }).then(() => {
      if (candidate && expected === generation) els.customFeedTitle.focus();
    });
  }

  function commit() {
    if (busy || !candidate) return;
    const title = els.customFeedTitle.value.trim().slice(0, MAX_CUSTOM_FEED_TITLE);
    if (!title) { els.customFeedTitle.focus(); return renderSettingsStatus(t("settings.feeds.nameRequired"), "error"); }
    if (!editingUrl && feeds().some(feed => feed.url === candidate.url)) return renderSettingsStatus(t("settings.feeds.duplicate"), "error");
    if (!editingUrl && feeds().length >= MAX_CUSTOM_FEEDS) return renderSettingsStatus(t("settings.feeds.limit", { count: MAX_CUSTOM_FEEDS }), "error");
    const next = editingUrl ? feeds().map(feed => feed.url === editingUrl ? { ...feed, title } : feed)
      : [...feeds(), { ...candidate, title }];
    resetEditor();
    els.customFeedUrl.value = "";
    update(next);
    els.customFeedUrl.focus();
  }

  function edit(feed) {
    resetEditor();
    editingUrl = feed.url;
    candidate = feed;
    els.customFeedTitle.value = feed.title;
    els.customFeedConfirm.textContent = t("settings.feeds.update");
    els.customFeedConfirm.dataset.i18n = "settings.feeds.update";
    els.customFeedPreview.hidden = false;
    els.customFeedTitle.focus();
  }

  function render() {
    els.customFeedCount.textContent = String(feeds().length);
    els.customFeedCount.hidden = !feeds().length;
    els.customFeedList.replaceChildren(...feeds().map(row));
    els.customFeedList.hidden = !feeds().length;
    setBusy(busy);
  }

  function row(feed) {
    const source = customFeedSource(feed);
    const record = state.data?.sourceQuality?.records?.[source.key] || state.settings?.sourceQuality?.records?.[source.key];
    const blocked = isNewsSourceExcluded(source, state.settings?.excludedNewsSources);
    const container = document.createElement("div");
    container.className = "custom-feed-row";
    const main = document.createElement("div");
    main.className = "custom-feed-main";
    const title = document.createElement("strong");
    title.textContent = feed.title;
    const url = document.createElement("span");
    url.className = "custom-feed-address";
    url.textContent = feed.url;
    main.append(title, url);
    if (feed.enabled && (blocked || record && record.status !== "healthy")) {
      const feedback = document.createElement("span");
      const reason = record?.reasonKey ? t(record.reasonKey) : "";
      feedback.textContent = blocked ? t("settings.feeds.blocked")
        : reason && !reason.includes("{") ? reason : t(`settings.sources.status.${record.status}`);
      main.append(feedback);
    }
    const actions = document.createElement("div");
    actions.className = "custom-feed-actions";
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = feed.enabled;
    input.setAttribute("aria-label", t("settings.feeds.enabled", { title: feed.title }));
    input.addEventListener("change", () => {
      const checked = input.checked;
      state.settings = { ...state.settings, customFeeds: feeds().map(item => item.url === feed.url ? { ...item, enabled: checked } : item) };
      renderSettingsStatus();
    });
    const track = document.createElement("span");
    track.setAttribute("aria-hidden", "true");
    toggle.append(input, track);
    actions.append(toggle, iconButton("edit-05", "settings.feeds.rename", () => edit(feed)),
      iconButton("trash-01", "settings.feeds.remove", () => {
        if (editingUrl === feed.url) resetEditor();
        update(feeds().filter(item => item.url !== feed.url));
        els.customFeedUrl.focus();
      }));
    if (feed.enabled && record?.status === "permissionRequired") {
      actions.prepend(iconButton("key-01", "settings.feeds.authorize", () => grant(feed)));
    }
    container.append(main, actions);
    return container;
  }

  function grant(feed) {
    const permission = requestOrigins([`${new URL(feed.url).origin}/*`]);
    return runSettingsAction(async isCurrent => {
      try {
        if (!await permission) {
          if (isCurrent()) renderSettingsStatus(t("settings.feeds.permissionDenied"), "error");
          return;
        }
        if (!isCurrent()) return;
        const result = await request({ type: "settings:get" });
        if (!isCurrent()) return;
        state.settings.sourceQuality = result.sourceQuality;
        if (state.data) state.data.sourceQuality = result.sourceQuality;
        render();
        renderSettingsStatus();
      } catch (error) {
        if (isCurrent()) renderSettingsStatus(localizedErrorMessage(error), "error");
      }
    });
  }

  function iconButton(icon, key, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn icon-btn";
    button.title = t(key);
    button.setAttribute("aria-label", button.title);
    button.append(createIcon(icon, "btn-icon"));
    button.addEventListener("click", action);
    return button;
  }

  function setBusy(value) {
    busy = value;
    for (const control of [els.customFeedUrl, els.customFeedCheck, els.customFeedTitle, els.customFeedConfirm, els.customFeedCancel,
      ...els.customFeedList.querySelectorAll("button, input")]) control.disabled = busy;
  }
}
