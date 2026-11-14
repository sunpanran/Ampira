import { FOCUS_DURATIONS, FOCUS_BREAK_DURATIONS, focusRemaining, focusToday, settleFocus } from "../../extension/core/focus.mjs";
import { spanText } from "./dom.mjs";
import { enhanceSelectComboboxes } from "./select-combobox.mjs";
import { syncSegmentedIndicator } from "./segmented-control.mjs";
import { personalCardControls } from "./personal-card-controls.mjs";

export function createFocusCardView({ id, state, t, tc, getLocale, createIcon, createEmptyState,
  focusState, requestRender, isActive, localizedErrorMessage }) {
  const { node, button, iconButton, labelButton, field, select, choices } = personalCardControls(createIcon);
  let editing = false, error = "", timer = 0, phase = "", taskSignature = "";
  const root = node("div", "personal-card-content focus-content");
  const notice = node("div", "utility-inline-status is-error personal-card-notice"); notice.setAttribute("role", "alert");
  const main = node("div", "focus-main");
  const modes = node("div", "segmented focus-modes"); modes.setAttribute("role", "group");
  const focusMode = button("", () => change({ type: "configure", mode: "focus" }));
  const breakMode = button("", () => change({ type: "configure", mode: "break" }));
  modes.append(focusMode, breakMode);
  const clockGroup = node("div", "focus-clock-group");
  const clock = spanText("", "focus-clock"); clock.setAttribute("role", "timer");
  const status = spanText("", "focus-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  clockGroup.append(clock, status);
  const taskRow = node("div", "focus-task");
  const taskSelect = select("focus-task-" + id);
  const taskCaption = node("label", "sr-only"); taskCaption.htmlFor = taskSelect.id;
  taskRow.append(createIcon("list-check", "inline-icon"), taskCaption, taskSelect);
  taskSelect.addEventListener("change", () => change({ type: "configure", taskId: taskSelect.value }));
  const progress = node("div", "focus-progress"), progressFill = node("div", "focus-progress-fill");
  progress.setAttribute("role", "progressbar"); progress.setAttribute("aria-valuemin", "0"); progress.setAttribute("aria-valuemax", "100");
  progress.append(progressFill);
  const actions = node("div", "focus-actions");
  const primary = button("btn primary focus-primary", () => {
    const current = focusState.read().value.session?.phase;
    change({ type: current === "running" ? "pause" : current === "paused" ? "resume" : "start" });
  });
  const end = button("btn ghost focus-end", () => change({ type: "end" }));
  const completeTask = button("btn focus-complete-task", () => change({ type: "completeTask" }));
  actions.append(primary, end, completeTask);
  const context = button("focus-context", () => openSettings());
  clockGroup.prepend(context);
  const today = node("div", "focus-today"), minutes = spanText(""), rounds = spanText("");
  const headerToday = spanText("", "efficiency-meta focus-header-today");
  today.append(minutes, rounds);
  main.append(modes, clockGroup, taskRow, progress, actions, today);
  const settings = node("form", "personal-card-editor focus-settings"); settings.id = "focus-settings-" + id;
  const settingsRow = node("div", "personal-card-form-row");
  const modeSetting = select("focus-setting-mode-" + id), taskSetting = select("focus-setting-task-" + id);
  const modeField = field(modeSetting), taskField = field(taskSetting);
  const focusDuration = select("focus-duration-" + id), breakDuration = select("focus-break-" + id);
  const focusField = field(focusDuration), breakField = field(breakDuration);
  settingsRow.append(focusField.label, breakField.label);
  const statsRow = node("label", "personal-card-check");
  const stats = node("input"); stats.type = "checkbox"; const statsLabel = spanText("");
  statsRow.append(stats, statsLabel);
  const settingsNote = spanText("", "personal-card-help");
  const settingsActions = node("div", "personal-card-form-actions");
  const save = button("btn primary"); save.type = "submit"; settingsActions.append(save);
  settings.append(modeField.label, taskField.label, settingsRow, statsRow, settingsNote, settingsActions);
  const settingsButton = iconButton("settings", () => editing ? closeSettings() : openSettings());
  settingsButton.setAttribute("aria-controls", settings.id);
  const retry = iconButton("refresh-cw-01", () => { error = ""; focusState.ensure({ force: true }); });
  root.append(notice, main, settings);
  settings.addEventListener("submit", event => {
    event.preventDefault();
    const active = ["running", "paused"].includes(focusState.read().value.session?.phase);
    change({ type: "configure", ...(!active ? { mode: modeSetting.value, taskId: taskSetting.value } : {}), settings: { showToday: stats.checked,
      ...(!active ? { focusMinutes: Number(focusDuration.value), breakMinutes: Number(breakDuration.value) } : {}) } }, true);
  });
  settings.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation(); closeSettings();
  });
  const resize = new ResizeObserver(() => { if (root.isConnected && !editing) syncSegmentedIndicator(modes); });
  resize.observe(root);
  return { render, deactivate() { editing = false; error = ""; clearTimeout(timer); timer = 0; } };

  async function change(action, close = false) {
    error = "";
    const outcome = await focusState.change({ ...action, revision: focusState.read().value.revision });
    if (!outcome.ok && outcome.reason !== "busy") error = outcome.reason;
    if (outcome.ok && close) { closeSettings(); return; }
    requestRender();
  }
  function openSettings() {
    const value = focusState.read().value;
    focusDuration.value = String(value.settings.focusMinutes); breakDuration.value = String(value.settings.breakMinutes);
    modeSetting.value = value.mode;
    taskSetting.value = ["running", "paused"].includes(value.session?.phase) ? value.session.taskId
      : (state.todos || []).some(todo => todo.id === value.taskId && !todo.completed) ? value.taskId : "";
    stats.checked = value.settings.showToday; editing = true; error = "";
    requestRender();
    (focusDuration.disabled ? stats : focusDuration).focus({ preventScroll: true });
  }
  function closeSettings() { editing = false; error = ""; requestRender(); settingsButton.focus({ preventScroll: true }); }
  function render() {
    let shared = focusState.read();
    if (!shared.loaded && !shared.busy && !shared.error) { focusState.ensure(); shared = focusState.read(); }
    if (!shared.loaded) return { busy: shared.busy, content: createEmptyState({
      title: t(shared.error ? "personalCards.loadError" : "personalCards.loading"),
      body: shared.error ? localizedErrorMessage(shared.error) : "", variant: "compact",
      actionLabel: shared.error ? t("personalCards.retry") : "", onAction: () => focusState.ensure({ force: true }),
    }) };
    const now = Date.now(), value = shared.value, session = value.session;
    const active = ["running", "paused"].includes(session?.phase);
    const nextPhase = session?.phase || "idle";
    const mode = value.mode;
    root.dataset.phase = nextPhase;
    root.classList.toggle("is-editing", editing);
    main.hidden = editing; settings.hidden = !editing;
    settingsButton.disabled = shared.busy;
    settingsButton.setAttribute("aria-expanded", String(editing));
    labelButton(settingsButton, t(editing ? "personalCards.back" : "focus.settings"));
    labelButton(retry, t("personalCards.retry"));
    const message = error && error !== "request" ? t("focus.error." + error) : shared.error ? localizedErrorMessage(shared.error) : "";
    notice.hidden = !message; notice.textContent = message;
    root.classList.toggle("has-notice", Boolean(message));
    modes.setAttribute("aria-label", t("focus.mode"));
    focusMode.textContent = t("focus.mode.focus"); breakMode.textContent = t("focus.mode.break");
    for (const [control, type] of [[focusMode, "focus"], [breakMode, "break"]]) {
      control.disabled = shared.busy || active; control.classList.toggle("active", mode === type); control.setAttribute("aria-pressed", String(mode === type));
    }
    const remaining = focusRemaining(value, now), seconds = Math.ceil(remaining / 1000);
    clock.textContent = String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
    clock.setAttribute("aria-label", t("focus.remaining"));
    const statusKey = nextPhase === "paused" ? "focus.paused" : nextPhase === "done" ? (session.naturalEnd ? "focus.completed" : "focus.ended") : "";
    const statusText = statusKey ? t(statusKey) : "";
    if (status.textContent !== statusText) status.textContent = statusText;
    status.title = statusText;
    const total = session?.durationMs || remaining;
    const percent = total ? Math.max(0, Math.min(100, (1 - remaining / total) * 100)) : 0;
    progressFill.style.width = percent + "%";
    progress.setAttribute("aria-valuenow", String(Math.round(percent))); progress.setAttribute("aria-label", t("focus.progress"));
    const todos = state.todos || [];
    const taskId = session?.taskId || value.taskId;
    const task = todos.find(item => item.id === taskId);
    const taskItems = [["", t("focus.noTask")], ...todos.filter(item => !item.completed || item.id === taskId).map(item => [item.id, item.text])];
    if (taskId && !task) taskItems.push([taskId, session?.taskTitle || t("focus.taskRemoved")]);
    const signature = JSON.stringify([taskItems, taskId]);
    if (signature !== taskSignature) { taskSignature = signature; choices(taskSelect, taskItems, taskId); }
    taskSelect.disabled = shared.busy || active || nextPhase === "done";
    taskSelect.setAttribute("aria-label", t("focus.task"));
    taskCaption.textContent = t("focus.task");
    taskRow.hidden = mode === "break";
    const mainKey = nextPhase === "running" ? "focus.pause" : nextPhase === "paused" ? "focus.resume"
      : nextPhase === "done" ? session.naturalEnd ? mode === "focus" ? "focus.startBreak" : "focus.startFocus" : "focus.restart"
      : mode === "focus" ? "focus.startFocus" : "focus.startBreak";
    primary.textContent = t(mainKey); primary.disabled = shared.busy;
    end.textContent = t("focus.end"); labelButton(end, t("focus.end")); end.hidden = !active; end.disabled = shared.busy;
    completeTask.hidden = !(nextPhase === "done" && mode === "focus" && session.taskId);
    completeTask.disabled = shared.busy || !task || task.completed;
    completeTask.textContent = t(!task ? "focus.taskRemoved" : task.completed ? "focus.taskCompleted" : "focus.completeTask");
    context.hidden = mode === "focus" && !taskId || !completeTask.hidden;
    context.textContent = mode === "break" ? t("focus.mode.break") : task?.text || session?.taskTitle || t("focus.taskRemoved");
    root.dataset.hasContext = String(!context.hidden);
    labelButton(context, t("focus.settings") + " · " + context.textContent);
    context.disabled = shared.busy;
    const daily = focusToday(value, now), formatter = new Intl.NumberFormat(getLocale());
    minutes.textContent = t("focus.todayMinutes", { count: formatter.format(Math.floor(daily.ms / 60_000)) });
    headerToday.textContent = minutes.textContent;
    headerToday.hidden = !value.settings.showToday || editing || Boolean(message);
    rounds.textContent = tc("focus.rounds", daily.rounds);
    today.hidden = !value.settings.showToday;
    focusField.caption.textContent = t("focus.focusDuration"); breakField.caption.textContent = t("focus.breakDuration");
    modeField.caption.textContent = t("focus.mode"); taskField.caption.textContent = t("focus.task");
    choices(modeSetting, ["focus", "break"].map(type => [type, t("focus.mode." + type)]), editing ? modeSetting.value : mode);
    choices(taskSetting, taskItems, editing ? taskSetting.value : taskId);
    modeSetting.disabled = taskSetting.disabled = active || shared.busy;
    modeSetting.setAttribute("aria-label", t("focus.mode")); taskSetting.setAttribute("aria-label", t("focus.task"));
    choices(focusDuration, FOCUS_DURATIONS.map(number => [String(number), t("focus.minutes", { count: number })]), editing ? focusDuration.value : String(value.settings.focusMinutes));
    choices(breakDuration, FOCUS_BREAK_DURATIONS.map(number => [String(number), t("focus.minutes", { count: number })]), editing ? breakDuration.value : String(value.settings.breakMinutes));
    focusDuration.disabled = breakDuration.disabled = active || shared.busy;
    focusDuration.setAttribute("aria-label", t("focus.focusDuration")); breakDuration.setAttribute("aria-label", t("focus.breakDuration"));
    statsLabel.textContent = t("focus.showToday"); if (!editing) stats.checked = value.settings.showToday;
    stats.disabled = shared.busy; settingsNote.hidden = !active; settingsNote.textContent = t("focus.durationLocked");
    save.textContent = t("personalCards.save"); save.disabled = shared.busy;
    if (phase !== nextPhase) { phase = nextPhase; syncSegmentedIndicator(modes); }
    queueMicrotask(() => { if (root.isConnected) { enhanceSelectComboboxes(root); syncSegmentedIndicator(modes); } });
    clearTimeout(timer);
    if (session?.phase === "running" && isActive()) timer = setTimeout(() => {
      if (!isActive()) return;
      if (settleFocus(focusState.read().value).session?.phase === "done" && !focusState.read().error) focusState.ensure({ force: true });
      else requestRender();
    }, 1000);
    return { content: root, meta: headerToday, actions: [...(shared.error ? [retry] : []), settingsButton] };
  }
}
