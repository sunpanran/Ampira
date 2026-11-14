import { normalizeTodoId } from "./todo.mjs";

export const FOCUS_STATE_KEY = "dash.focus.state.v1";
export const FOCUS_DURATIONS = Object.freeze([25, 45, 60]);
export const FOCUS_BREAK_DURATIONS = Object.freeze([5, 10, 15]);
const DAY_LIMIT = 30;
const idText = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : "";
const bounded = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;

export function focusDay(now) {
  const date = new Date(now);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function normalizeFocusState(value) {
  const settings = value?.settings || {};
  const result = {
    revision: Math.floor(bounded(value?.revision, Number.MAX_SAFE_INTEGER)),
    settings: {
      focusMinutes: FOCUS_DURATIONS.includes(settings.focusMinutes) ? settings.focusMinutes : 25,
      breakMinutes: FOCUS_BREAK_DURATIONS.includes(settings.breakMinutes) ? settings.breakMinutes : 5,
      showToday: settings.showToday !== false,
    },
    mode: value?.mode === "break" ? "break" : "focus",
    taskId: normalizeTodoId(value?.taskId),
    session: null,
    days: [],
  };
  const days = new Map();
  for (const day of Array.isArray(value?.days) ? value.days.slice(-100) : []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date || "")) continue;
    days.set(day.date, { date: day.date, ms: bounded(day.ms, 86_400_000), rounds: Math.floor(bounded(day.rounds, 1440)) });
  }
  result.days = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-DAY_LIMIT);
  const session = value?.session;
  if (!idText(session?.id) || !["running", "paused", "done"].includes(session?.phase)) return result;
  const mode = session.mode === "break" ? "break" : "focus";
  const minutes = mode === "focus" ? FOCUS_DURATIONS : FOCUS_BREAK_DURATIONS;
  if (!minutes.includes(session.durationMs / 60_000)) return result;
  const durationMs = session.durationMs;
  const remainingMs = bounded(session.remainingMs, durationMs);
  if (session.phase === "running" && (!Number.isFinite(session.activeSince) || session.activeSince <= 0
    || !Number.isFinite(session.endsAt) || session.endsAt !== session.activeSince + remainingMs)) return result;
  result.mode = mode;
  result.session = {
    id: session.id, mode, phase: session.phase, durationMs, remainingMs,
    elapsedMs: bounded(session.elapsedMs, durationMs),
    activeSince: session.phase === "running" ? session.activeSince : 0,
    endsAt: session.phase === "running" ? session.endsAt : 0,
    taskId: normalizeTodoId(session.taskId),
    taskTitle: typeof session.taskTitle === "string" ? session.taskTitle.slice(0, 200) : "",
    naturalEnd: session.phase === "done" && session.naturalEnd === true,
  };
  return result;
}

export function focusRemaining(state, now = Date.now()) {
  const session = state.session;
  if (!session) return (state.mode === "break" ? state.settings.breakMinutes : state.settings.focusMinutes) * 60_000;
  return session.phase === "running" ? bounded(session.endsAt - now, session.remainingMs) : session.remainingMs;
}

function addTime(state, from, to) {
  while (from < to) {
    const date = focusDay(from);
    const midnight = new Date(from);
    midnight.setHours(24, 0, 0, 0);
    const end = Math.min(to, midnight.getTime());
    let record = state.days.find(item => item.date === date);
    if (!record) { record = { date, ms: 0, rounds: 0 }; state.days.push(record); }
    record.ms = Math.min(86_400_000, record.ms + end - from);
    from = end;
  }
  state.days.sort((a, b) => a.date.localeCompare(b.date));
  state.days = state.days.slice(-DAY_LIMIT);
}

function bankRunningTime(state, now) {
  const session = state.session;
  if (session.phase !== "running") return;
  const end = Math.max(session.activeSince, Math.min(now, session.endsAt));
  const elapsed = end - session.activeSince;
  if (session.mode === "focus") addTime(state, session.activeSince, end);
  session.elapsedMs = Math.min(session.durationMs, session.elapsedMs + elapsed);
  session.remainingMs = Math.max(0, session.remainingMs - elapsed);
  session.activeSince = 0; session.endsAt = 0;
}

function finish(state, now, naturalEnd) {
  const session = state.session;
  bankRunningTime(state, now);
  session.phase = "done"; session.naturalEnd = naturalEnd;
  if (session.mode === "focus" && session.elapsedMs >= 60_000) {
    const date = focusDay(now);
    let day = state.days.find(record => record.date === date);
    if (!day) { day = { date, ms: 0, rounds: 0 }; state.days.push(day); }
    day.rounds = Math.min(1440, day.rounds + 1);
    state.days.sort((a, b) => a.date.localeCompare(b.date));
    state.days = state.days.slice(-DAY_LIMIT);
  }
}

export function settleFocus(value, now = Date.now()) {
  const state = normalizeFocusState(value);
  if (state.session?.phase === "running" && now >= state.session.endsAt) {
    finish(state, state.session.endsAt, true);
    state.revision += 1;
  }
  return state;
}

export function focusToday(value, now = Date.now()) {
  const state = settleFocus(value, now);
  if (state.session?.phase === "running" && state.session.mode === "focus") {
    addTime(state, state.session.activeSince, Math.max(state.session.activeSince, Math.min(now, state.session.endsAt)));
  }
  return state.days.find(day => day.date === focusDay(now)) || { date: focusDay(now), ms: 0, rounds: 0 };
}

export function applyFocusAction(value, action, { now = Date.now(), createId = () => globalThis.crypto.randomUUID(), todos = [] } = {}) {
  const state = settleFocus(value, now);
  const fail = reason => ({ ok: false, reason, state });
  if (action?.revision !== state.revision) return fail("changed");
  const active = ["running", "paused"].includes(state.session?.phase);
  if (action.type === "configure") {
    const patch = action.settings || {};
    if (active && (Object.hasOwn(action, "mode") || Object.hasOwn(action, "taskId")
      || Object.hasOwn(patch, "focusMinutes") || Object.hasOwn(patch, "breakMinutes"))) return fail("active");
    if (Object.hasOwn(patch, "focusMinutes") && !FOCUS_DURATIONS.includes(patch.focusMinutes)
      || Object.hasOwn(patch, "breakMinutes") && !FOCUS_BREAK_DURATIONS.includes(patch.breakMinutes)
      || Object.hasOwn(action, "mode") && !["focus", "break"].includes(action.mode)) return fail("invalid");
    if (Object.hasOwn(action, "taskId")) {
      if (action.taskId && !todos.some(todo => todo.id === action.taskId && !todo.completed)) return fail("taskMissing");
      state.taskId = action.taskId || "";
    }
    state.settings = normalizeFocusState({ settings: { ...state.settings, ...patch } }).settings;
    if (!active) {
      state.mode = action.mode || state.mode; state.session = null;
      if (!todos.some(todo => todo.id === state.taskId && !todo.completed)) state.taskId = "";
    }
  } else if (action.type === "start") {
    if (active) return fail("changed");
    if (state.session?.naturalEnd) state.mode = state.mode === "focus" ? "break" : "focus";
    const task = todos.find(todo => todo.id === state.taskId && !todo.completed);
    if (!task) state.taskId = "";
    const durationMs = (state.mode === "focus" ? state.settings.focusMinutes : state.settings.breakMinutes) * 60_000;
    state.session = { id: createId(), mode: state.mode, phase: "running", durationMs, remainingMs: durationMs, elapsedMs: 0,
      activeSince: now, endsAt: now + durationMs, taskId: state.mode === "focus" ? task?.id || "" : "",
      taskTitle: state.mode === "focus" ? task?.text || "" : "", naturalEnd: false };
  } else if (action.type === "pause" && state.session?.phase === "running") {
    bankRunningTime(state, now); state.session.phase = "paused";
  } else if (action.type === "resume" && state.session?.phase === "paused") {
    state.session.phase = "running"; state.session.activeSince = now; state.session.endsAt = now + state.session.remainingMs;
  } else if (action.type === "end" && active) {
    finish(state, now, false);
  } else if (action.type === "completeTask" && state.session?.phase === "done") {
    const task = todos.find(todo => todo.id === state.session.taskId);
    if (!task) return fail("taskMissing");
    const nextTodos = todos.map(todo => todo.id === task.id && !todo.completed ? { ...todo, completed: true, completedAt: new Date(now).toISOString() } : todo);
    state.revision += 1;
    return { ok: true, state, todos: nextTodos };
  } else return fail("invalid");
  state.revision += 1;
  return { ok: true, state };
}
