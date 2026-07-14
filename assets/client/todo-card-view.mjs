import {
  TODO_ITEM_LIMIT,
  TODO_ITEMS_KEY,
  TODO_TEXT_LIMIT,
  createTodoItem,
  normalizeTodoItems,
  sortedTodoItems,
} from "./utility-card-model.mjs";

const TODO_COMPOSER_ID = "utilityTodoComposer";

export function createTodoCardView(options) {
  const {
    state, t, createIcon, writeJson, requestRender, getContentRoot, getFocusFallback,
  } = options;
  let composerOpen = false;

  const addButton = document.createElement("button");
  addButton.className = "efficiency-action utility-todo-add-toggle";
  addButton.type = "button";
  addButton.hidden = true;
  addButton.setAttribute("aria-controls", TODO_COMPOSER_ID);
  addButton.addEventListener("click", toggleComposer);

  return {
    addButton,
    createContent,
    resetComposer,
    syncAddButton,
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
    addButton.replaceChildren(createIcon(composerOpen ? "x-close" : "plus", "todo-composer-icon"));
    const label = atLimit
      ? t("todo.limit", { count: TODO_ITEM_LIMIT })
      : t(composerOpen ? "todo.cancelAdd" : "todo.addLabel");
    addButton.title = label;
    addButton.setAttribute("aria-label", label);
    addButton.setAttribute("aria-expanded", String(composerOpen));
    return state.todos.filter((item) => !item.completed).length;
  }

  function createContent() {
    const wrapper = document.createElement("div");
    wrapper.className = `todo-content${composerOpen ? " is-composing" : ""}`;
    if (composerOpen) wrapper.append(createComposer());

    const items = sortedTodoItems(state.todos);
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "utility-inline-status todo-empty";
      empty.textContent = t("todo.empty");
      wrapper.append(empty);
      return wrapper;
    }
    const list = document.createElement("div");
    list.className = "todo-list utility-scroll-list";
    list.append(...items.map(createTodoRow));
    wrapper.append(list);
    return wrapper;
  }

  function createComposer() {
    const form = document.createElement("form");
    form.id = TODO_COMPOSER_ID;
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
    const remove = document.createElement("button");
    remove.className = "todo-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", t("todo.delete", { title: item.text }));
    remove.append(createIcon("trash", "todo-action-icon"));
    remove.addEventListener("click", () => deleteTodo(item.id));
    row.append(toggle, text, remove);
    return row;
  }

  function toggleComposer() {
    if (state.todos.length >= TODO_ITEM_LIMIT) return;
    composerOpen = !composerOpen;
    requestRender();
    if (composerOpen) {
      queueMicrotask(() => getContentRoot().querySelector(".todo-entry-form input")?.focus({ preventScroll: true }));
      return;
    }
    focusAddButton();
  }

  function closeComposer() {
    if (!composerOpen) return;
    composerOpen = false;
    requestRender();
    focusAddButton();
  }

  function resetComposer() {
    composerOpen = false;
  }

  function addTodo(event, input) {
    event.preventDefault();
    if (state.todos.length >= TODO_ITEM_LIMIT) return;
    const item = createTodoItem(input.value);
    if (!item) {
      input.focus({ preventScroll: true });
      return;
    }
    state.todos = [item, ...state.todos];
    composerOpen = false;
    persistTodos();
    requestRender();
    focusAddButton();
  }

  function toggleTodo(id) {
    const now = new Date().toISOString();
    state.todos = state.todos.map((item) => item.id === id
      ? { ...item, completed: !item.completed, completedAt: item.completed ? "" : now }
      : item);
    persistTodos();
    requestRender();
  }

  function deleteTodo(id) {
    state.todos = state.todos.filter((item) => item.id !== id);
    persistTodos();
    requestRender();
  }

  function persistTodos() {
    state.todos = normalizeTodoItems(state.todos);
    writeJson(TODO_ITEMS_KEY, state.todos);
  }

  function focusAddButton() {
    queueMicrotask(() => (addButton.disabled ? getFocusFallback() : addButton).focus({ preventScroll: true }));
  }
}
