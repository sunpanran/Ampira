import {
  TODO_ITEM_LIMIT,
  TODO_ITEMS_KEY,
  TODO_TEXT_LIMIT,
  createTodoItem,
  normalizeTodoItems,
  sortedTodoItems,
} from "./utility-card-model.mjs";
import {
  MOTION_DURATION,
  animateKeyedLayout,
  captureKeyedLayout,
  prefersReducedMotion,
  restartMotionClass,
} from "./motion.mjs";
import { setKeyboardShortcutHint } from "./keyboard-shortcuts.mjs";
import { nodesEqualIgnoringIconLoadState } from "./dom.mjs";

const TODO_COMPOSER_ID = "utilityTodoComposer";

export function createTodoCardView(options) {
  const {
    state, t, createIcon, writeJson, requestRender, getContentRoot, getFocusFallback,
    instanceId = "utility", onChange = () => {},
  } = options;
  let composerOpen = false;
  let limitNotice = false;
  let composer = null;
  let addIcon = "";
  const composerId = `${TODO_COMPOSER_ID}-${instanceId}`;
  const wrapper = document.createElement("div");
  const notice = document.createElement("p");
  notice.className = "utility-inline-status todo-limit-feedback";
  notice.setAttribute("role", "status");
  const empty = document.createElement("p");
  empty.className = "utility-inline-status todo-empty";
  const list = document.createElement("div");
  list.className = "todo-list utility-scroll-list";
  wrapper.append(notice, empty, list);

  const addButton = document.createElement("button");
  addButton.className = "action-toggle utility-todo-add-toggle";
  addButton.type = "button";
  addButton.hidden = true;
  addButton.setAttribute("aria-controls", composerId);
  addButton.addEventListener("click", toggleComposer);

  return {
    addButton,
    createContent,
    resetComposer,
    syncAddButton,
    openComposer,
  };

  function syncAddButton(active) {
    addButton.hidden = !active;
    if (!active) {
      composerOpen = false;
      addButton.disabled = false;
      addButton.setAttribute("aria-expanded", "false");
      return 0;
    }

    state.todos = normalizeTodoItems(state.todos);
    const atLimit = state.todos.length >= TODO_ITEM_LIMIT;
    if (atLimit) composerOpen = false;
    addButton.disabled = atLimit;
    const icon = composerOpen ? "x-close" : "plus";
    if (addIcon !== icon) { addIcon = icon; addButton.replaceChildren(createIcon(icon, "action-toggle-icon")); }
    const label = atLimit
      ? t("todo.limit", { count: TODO_ITEM_LIMIT })
      : t(composerOpen ? "todo.cancelAdd" : "todo.addLabel");
    setKeyboardShortcutHint(addButton, "todo", label, state.settings, !composerOpen);
    addButton.setAttribute("aria-label", label);
    addButton.setAttribute("aria-expanded", String(composerOpen));
    return state.todos.filter((item) => !item.completed).length;
  }

  function createContent() {
    wrapper.className = `todo-content${composerOpen ? " is-composing" : ""}`;
    notice.hidden = !(limitNotice && state.todos.length >= TODO_ITEM_LIMIT);
    notice.textContent = t("todo.limit", { count: TODO_ITEM_LIMIT });
    if (composerOpen && !composer) {
      composer = createComposer();
      wrapper.insertBefore(composer, empty);
    }
    if (composer) {
      composer.hidden = !composerOpen;
      composer.querySelector("input").placeholder = t("todo.placeholder");
      composer.querySelector("input").setAttribute("aria-label", t("todo.addLabel"));
      composer.querySelector("button").textContent = t("todo.add");
    }
    const items = sortedTodoItems(state.todos);
    empty.textContent = t("todo.empty");
    empty.hidden = Boolean(items.length);
    list.hidden = !items.length;
    const focused = document.activeElement;
    const focusedKey = list.contains(focused) ? focused.closest(".todo-row")?.dataset.key : null;
    const focusedAction = focused?.classList.contains("todo-remove") ? ".todo-remove" : ".todo-toggle";
    const rows = new Map(Array.from(list.children, (row) => [row.dataset.key, row]));
    const nextRows = items.map((item) => {
      const next = createTodoRow(item), current = rows.get(item.id);
      return current && nodesEqualIgnoringIconLoadState(current, next) ? current : next;
    });
    nextRows.forEach((row, index) => { if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null); });
    while (list.children.length > nextRows.length) list.lastElementChild.remove();
    if (focusedKey && document.activeElement !== focused) {
      const row = nextRows.find((node) => node.dataset.key === focusedKey);
      (row?.querySelector(focusedAction) || (addButton.disabled ? getFocusFallback() : addButton)).focus({ preventScroll: true });
    }
    return wrapper;
  }

  function createComposer() {
    const form = document.createElement("form");
    form.id = composerId;
    form.className = "utility-entry-form todo-entry-form";
    const input = document.createElement("input");
    input.className = "utility-entry-input";
    input.type = "text";
    input.maxLength = TODO_TEXT_LIMIT;
    input.autocomplete = "off";
    input.placeholder = t("todo.placeholder");
    input.setAttribute("aria-label", t("todo.addLabel"));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeComposer();
    });
    const submit = document.createElement("button");
    submit.className = "efficiency-action utility-entry-submit todo-add";
    submit.type = "submit";
    submit.textContent = t("todo.add");
    form.addEventListener("submit", (event) => addTodo(event, input));
    form.append(input, submit);
    return form;
  }

  function createTodoRow(item) {
    const row = document.createElement("div");
    row.className = `efficiency-row todo-row${item.completed ? " is-completed" : ""}`;
    row.dataset.key = item.id;
    const toggle = document.createElement("button");
    toggle.className = "todo-toggle";
    toggle.type = "button";
    toggle.setAttribute("role", "checkbox");
    toggle.setAttribute("aria-checked", String(item.completed));
    toggle.setAttribute("aria-label", t(item.completed ? "todo.restore" : "todo.complete", { title: item.text }));
    toggle.append(createIcon("check", "todo-action-icon"));
    toggle.addEventListener("click", () => toggleTodo(item.id));
    const text = document.createElement("span");
    text.className = "efficiency-row-title todo-title";
    text.textContent = item.text;
    text.title = item.text;
    const remove = document.createElement("button");
    remove.className = "todo-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", t("todo.delete", { title: item.text }));
    remove.append(createIcon("trash", "todo-action-icon"));
    remove.addEventListener("click", () => deleteTodo(item.id));
    row.prepend(toggle, text);
    row.append(remove);
    return row;
  }

  function toggleComposer() {
    if (composerOpen) closeComposer();
    else openComposer();
  }

  function openComposer() {
    if (state.todos.length >= TODO_ITEM_LIMIT) { limitNotice = true; requestRender(); return false; }
    limitNotice = false;
    if (!composerOpen) {
      composerOpen = true;
      requestRender();
    }
    queueMicrotask(() => getContentRoot().querySelector(".todo-entry-form input")?.focus({ preventScroll: true }));
    return true;
  }

  function closeComposer() {
    if (!composerOpen) return;
    composerOpen = false;
    requestRender();
    focusAddButton();
  }

  function resetComposer() {
    composerOpen = false;
    limitNotice = false;
  }

  function addTodo(event, input) {
    event.preventDefault();
    if (state.todos.length >= TODO_ITEM_LIMIT) return;
    const item = createTodoItem(input.value);
    if (!item) {
      input.focus({ preventScroll: true });
      return;
    }
    const layout = captureTodoLayout();
    state.todos = [item, ...state.todos];
    input.value = "";
    composerOpen = false;
    persistTodos();
    renderTodoMotion(layout, item.id);
    focusAddButton();
  }

  function toggleTodo(id) {
    const layout = captureTodoLayout();
    const now = new Date().toISOString();
    state.todos = state.todos.map((item) => item.id === id
      ? { ...item, completed: !item.completed, completedAt: item.completed ? "" : now }
      : item);
    persistTodos();
    renderTodoMotion(layout, id);
  }

  function deleteTodo(id) {
    const row = Array.from(getContentRoot().querySelectorAll(".todo-row[data-key]"))
      .find((item) => item.dataset.key === id);
    if (!row || prefersReducedMotion()) {
      finalizeTodoDelete(id, captureTodoLayout());
      return;
    }
    row.classList.add("is-list-leaving");
    row.inert = true;
    window.setTimeout(() => finalizeTodoDelete(id, captureTodoLayout()), MOTION_DURATION.press + 20);
  }

  function finalizeTodoDelete(id, layout) {
    state.todos = state.todos.filter((item) => item.id !== id);
    persistTodos();
    renderTodoMotion(layout);
  }

  function captureTodoLayout() {
    return captureKeyedLayout(getContentRoot(), ".todo-row[data-key]");
  }

  function renderTodoMotion(layout, confirmationId = "") {
    requestRender();
    queueMicrotask(() => {
      const root = getContentRoot();
      animateKeyedLayout(root, layout, ".todo-row[data-key]");
      const confirmation = Array.from(root.querySelectorAll(".todo-row[data-key]"))
        .find((row) => row.dataset.key === confirmationId);
      if (confirmation) restartMotionClass(confirmation, "is-confirming");
    });
  }

  function persistTodos() {
    state.todos = normalizeTodoItems(state.todos);
    writeJson(TODO_ITEMS_KEY, state.todos);
    onChange();
  }

  function focusAddButton() {
    queueMicrotask(() => (addButton.disabled ? getFocusFallback() : addButton).focus({ preventScroll: true }));
  }
}
