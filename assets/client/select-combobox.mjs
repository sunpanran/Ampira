const enhancedSelects = new WeakMap();
const documentContexts = new WeakMap();

const TYPEAHEAD_RESET_MS = 700;
const LISTBOX_GAP = 6;
const VIEWPORT_MARGIN = 8;
const LISTBOX_MAX_HEIGHT = 280;
const LISTBOX_MIN_HEIGHT = 96;

let generatedId = 0;

export function enhanceSelectComboboxes(root = document) {
  if (!root?.querySelectorAll || forcedColorsActive(root)) return [];
  const selects = root.matches?.("select")
    ? [root]
    : [...root.querySelectorAll("select")];
  return selects.map(enhanceSelectCombobox).filter(Boolean);
}

export function syncSelectCombobox(select) {
  enhancedSelects.get(select)?.scheduleSync();
}

export function nextEnabledOptionIndex(options, startIndex, direction) {
  if (!options?.length || !direction) return -1;
  if (startIndex < 0 || startIndex >= options.length) {
    return edgeEnabledOptionIndex(options, direction < 0);
  }
  for (let step = 1; step <= options.length; step += 1) {
    const index = (startIndex + (step * direction) + options.length) % options.length;
    if (!optionUnavailable(options[index])) return index;
  }
  return -1;
}

export function edgeEnabledOptionIndex(options, fromEnd = false) {
  if (!options?.length) return -1;
  const start = fromEnd ? options.length - 1 : 0;
  const end = fromEnd ? -1 : options.length;
  const step = fromEnd ? -1 : 1;
  for (let index = start; index !== end; index += step) {
    if (!optionUnavailable(options[index])) return index;
  }
  return -1;
}

export function typeaheadOptionIndex(options, query, startIndex = -1) {
  const normalizedQuery = normalizeSearchText(query);
  if (!options?.length || !normalizedQuery) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (startIndex + step + options.length) % options.length;
    const option = options[index];
    if (!optionUnavailable(option) && optionSearchText(option).startsWith(normalizedQuery)) return index;
  }
  return -1;
}

function enhanceSelectCombobox(select) {
  if (!select || enhancedSelects.has(select) || select.multiple || select.size > 1) {
    return enhancedSelects.get(select)?.wrapper || null;
  }

  const doc = select.ownerDocument;
  const context = documentContext(doc);
  const selectId = select.id || `ampira-select-${++generatedId}`;
  if (!select.id) select.id = selectId;

  const wrapper = doc.createElement("div");
  wrapper.className = "select-combobox";
  wrapper.dataset.selectId = selectId;

  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.id = `${selectId}-combobox`;
  trigger.className = "select-combobox-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const value = doc.createElement("span");
  value.id = `${selectId}-combobox-value`;
  value.className = "select-combobox-value";

  const chevron = doc.createElement("span");
  chevron.className = "select-combobox-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(value, chevron);

  const listbox = doc.createElement("div");
  listbox.id = `${selectId}-combobox-listbox`;
  listbox.className = "select-combobox-listbox";
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("popover", "manual");
  listbox.hidden = true;
  trigger.setAttribute("aria-controls", listbox.id);

  select.before(wrapper);
  wrapper.append(select, trigger);
  doc.body.append(listbox);
  select.classList.add("select-combobox-native");
  select.tabIndex = -1;
  select.inert = true;
  select.setAttribute("aria-hidden", "true");
  select.focus = (options) => trigger.focus(options);

  const state = {
    context,
    select,
    wrapper,
    trigger,
    value,
    listbox,
    optionNodes: [],
    activeIndex: -1,
    open: false,
    syncPending: false,
    typeahead: "",
    typeaheadAt: 0,
    sync: null,
    scheduleSync: null,
    close: null,
    position: null,
  };
  enhancedSelects.set(select, state);

  state.sync = () => syncCombobox(state);
  state.scheduleSync = () => scheduleComboboxSync(state);
  state.close = () => closeCombobox(state);
  state.position = () => positionListbox(state);
  configureAccessibleLabels(state);
  bindComboboxEvents(state);
  observeNativeSelect(state);
  instrumentSelectProperty(state, "value");
  instrumentSelectProperty(state, "selectedIndex");
  state.sync();
  return wrapper;
}

function documentContext(doc) {
  const existing = documentContexts.get(doc);
  if (existing) return existing;
  const context = { active: null };
  documentContexts.set(doc, context);

  doc.addEventListener("pointerdown", (event) => {
    const state = context.active;
    if (!state?.open) return;
    if (state.trigger.contains(event.target) || state.listbox.contains(event.target)) return;
    state.close();
  }, true);
  doc.addEventListener("scroll", (event) => {
    const state = context.active;
    if (!state?.open || event.target === state.listbox || state.listbox.contains(event.target)) return;
    state.position();
  }, true);
  doc.defaultView?.addEventListener("resize", () => context.active?.position());
  doc.defaultView?.visualViewport?.addEventListener("resize", () => context.active?.position());
  doc.defaultView?.visualViewport?.addEventListener("scroll", () => context.active?.position());
  return context;
}

function configureAccessibleLabels(state) {
  const { select, trigger, value, listbox } = state;
  const labels = [...(select.labels || [])];
  const labelIds = labels.map((label, index) => {
    if (!label.id) label.id = `${select.id}-combobox-label-${index + 1}`;
    label.addEventListener("click", (event) => {
      if (effectivelyDisabled(select)) return;
      event.preventDefault();
      trigger.focus({ preventScroll: true });
    });
    return label.id;
  });

  if (labelIds.length) {
    trigger.setAttribute("aria-labelledby", [...labelIds, value.id].join(" "));
    listbox.setAttribute("aria-labelledby", labelIds.join(" "));
    return;
  }
  const fallbackLabel = select.getAttribute("aria-label") || select.title || select.id;
  trigger.setAttribute("aria-label", fallbackLabel);
  listbox.setAttribute("aria-label", fallbackLabel);
}

function bindComboboxEvents(state) {
  const { select, trigger, listbox } = state;
  trigger.addEventListener("click", () => {
    if (state.open) closeCombobox(state);
    else openCombobox(state);
  });
  trigger.addEventListener("keydown", (event) => handleComboboxKeydown(state, event));
  listbox.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.("[role='option']")) event.preventDefault();
  });
  listbox.addEventListener("pointerover", (event) => {
    const option = event.target.closest?.("[role='option'][data-option-index]");
    if (!option || !listbox.contains(option)) return;
    setActiveOption(state, Number(option.dataset.optionIndex), { scroll: false });
  });
  listbox.addEventListener("click", (event) => {
    const option = event.target.closest?.("[role='option'][data-option-index]");
    if (!option || !listbox.contains(option)) return;
    commitOption(state, Number(option.dataset.optionIndex));
  });
  select.addEventListener("input", state.scheduleSync);
  select.addEventListener("change", state.scheduleSync);
  select.addEventListener("focus", () => {
    if (!effectivelyDisabled(select)) trigger.focus({ preventScroll: true });
  });
  select.form?.addEventListener("reset", () => select.ownerDocument.defaultView.setTimeout(state.scheduleSync));
}

function observeNativeSelect(state) {
  const Observer = state.select.ownerDocument.defaultView?.MutationObserver;
  if (!Observer) return;
  const observer = new Observer(state.scheduleSync);
  observer.observe(state.select, {
    attributes: true,
    attributeFilter: ["aria-invalid", "disabled", "hidden", "label", "required", "selected", "value"],
    characterData: true,
    childList: true,
    subtree: true,
  });
  const fieldset = state.select.closest("fieldset");
  if (fieldset) observer.observe(fieldset, { attributes: true, attributeFilter: ["disabled"] });
}

function instrumentSelectProperty(state, property) {
  const Select = state.select.ownerDocument.defaultView?.HTMLSelectElement;
  const descriptor = Select && Object.getOwnPropertyDescriptor(Select.prototype, property);
  if (!descriptor?.get || !descriptor?.set) return;
  try {
    Object.defineProperty(state.select, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(nextValue) {
        descriptor.set.call(this, nextValue);
        state.scheduleSync();
      },
    });
  } catch {
    // Mutation and native form events still cover browsers that reject instance descriptors.
  }
}

function scheduleComboboxSync(state) {
  if (state.syncPending) return;
  state.syncPending = true;
  queueMicrotask(() => {
    state.syncPending = false;
    if (state.wrapper.isConnected) state.sync();
  });
}

function syncCombobox(state) {
  const { select, wrapper, trigger, value } = state;
  const disabled = effectivelyDisabled(select);
  const selected = select.selectedOptions?.[0] || null;
  const selectedLabel = selected ? optionLabel(selected) : "—";

  wrapper.hidden = select.hidden;
  wrapper.classList.toggle("is-disabled", disabled);
  trigger.disabled = disabled;
  trigger.setAttribute("aria-disabled", String(disabled));
  trigger.setAttribute("aria-required", String(select.required));
  if (select.hasAttribute("aria-invalid")) trigger.setAttribute("aria-invalid", select.getAttribute("aria-invalid"));
  else trigger.removeAttribute("aria-invalid");
  value.textContent = selectedLabel;
  trigger.title = selected?.title || selectedLabel;

  renderListboxOptions(state);
  if (disabled && state.open) closeCombobox(state);
  if (state.open) {
    const selectedIndex = availableIndex(state, select.selectedIndex)
      ? select.selectedIndex
      : edgeEnabledOptionIndex([...select.options]);
    setActiveOption(state, selectedIndex, { scroll: false });
    positionListbox(state);
  }
}

function renderListboxOptions(state) {
  const { select, listbox } = state;
  const fragment = select.ownerDocument.createDocumentFragment();
  const optionNodes = [];
  let optionIndex = 0;
  let groupIndex = 0;

  const appendOption = (nativeOption, parent) => {
    const option = select.ownerDocument.createElement("div");
    option.id = `${listbox.id}-option-${optionIndex}`;
    option.className = "select-combobox-option";
    option.dataset.optionIndex = String(optionIndex);
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(nativeOption.selected));
    option.setAttribute("aria-disabled", String(optionUnavailable(nativeOption)));
    option.classList.toggle("is-selected", nativeOption.selected);
    option.classList.toggle("is-disabled", optionUnavailable(nativeOption));
    option.hidden = nativeOption.hidden;
    const optionText = optionLabel(nativeOption);
    const optionLabelNode = select.ownerDocument.createElement("span");
    optionLabelNode.className = "select-combobox-option-label";
    optionLabelNode.textContent = optionText;
    option.append(optionLabelNode);
    option.title = nativeOption.title || optionText;
    optionNodes[optionIndex] = option;
    parent.append(option);
    optionIndex += 1;
  };

  [...select.children].forEach((child) => {
    if (child.tagName === "OPTGROUP") {
      const group = select.ownerDocument.createElement("div");
      const label = select.ownerDocument.createElement("div");
      label.id = `${listbox.id}-group-${++groupIndex}`;
      label.className = "select-combobox-group-label";
      label.textContent = child.label;
      group.className = "select-combobox-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-labelledby", label.id);
      group.append(label);
      [...child.children].forEach((option) => appendOption(option, group));
      fragment.append(group);
      return;
    }
    if (child.tagName === "OPTION") appendOption(child, fragment);
  });

  state.optionNodes = optionNodes;
  listbox.replaceChildren(fragment);
}

function openCombobox(state) {
  if (effectivelyDisabled(state.select) || !state.select.options.length) return;
  if (state.context.active && state.context.active !== state) state.context.active.close();
  state.context.active = state;
  state.open = true;
  state.wrapper.classList.add("is-open");
  state.trigger.setAttribute("aria-expanded", "true");
  state.listbox.hidden = false;
  state.listbox.classList.add("is-open");
  showPopover(state.listbox);
  state.sync();
  const selectedIndex = availableIndex(state, state.select.selectedIndex)
    ? state.select.selectedIndex
    : edgeEnabledOptionIndex([...state.select.options]);
  setActiveOption(state, selectedIndex);
  positionListbox(state);
}

function closeCombobox(state) {
  if (!state.open) return;
  state.open = false;
  state.wrapper.classList.remove("is-open");
  state.trigger.setAttribute("aria-expanded", "false");
  state.trigger.removeAttribute("aria-activedescendant");
  hidePopover(state.listbox);
  state.listbox.classList.remove("is-open");
  state.listbox.hidden = true;
  state.optionNodes.forEach((option) => option?.classList.remove("is-active"));
  state.activeIndex = -1;
  state.typeahead = "";
  if (state.context.active === state) state.context.active = null;
}

function handleComboboxKeydown(state, event) {
  const { key } = event;
  if (key === "ArrowDown" || key === "ArrowUp") {
    event.preventDefault();
    const direction = key === "ArrowDown" ? 1 : -1;
    if (!state.open) openCombobox(state);
    setActiveOption(state, nextEnabledOptionIndex([...state.select.options], state.activeIndex, direction));
    return;
  }
  if (key === "Home" || key === "End") {
    event.preventDefault();
    if (!state.open) openCombobox(state);
    setActiveOption(state, edgeEnabledOptionIndex([...state.select.options], key === "End"));
    return;
  }
  if (key === "PageDown" || key === "PageUp") {
    event.preventDefault();
    if (!state.open) openCombobox(state);
    const direction = key === "PageDown" ? 1 : -1;
    let index = state.activeIndex;
    for (let step = 0; step < 5; step += 1) {
      index = nextEnabledOptionIndex([...state.select.options], index, direction);
    }
    setActiveOption(state, index);
    return;
  }
  if (key === "Enter" || key === " ") {
    event.preventDefault();
    if (state.open) commitOption(state, state.activeIndex);
    else openCombobox(state);
    return;
  }
  if (key === "Escape" && state.open) {
    event.preventDefault();
    event.stopPropagation();
    closeCombobox(state);
    return;
  }
  if (key === "Tab") {
    closeCombobox(state);
    return;
  }
  if (key.length !== 1 || key === " " || event.altKey || event.ctrlKey || event.metaKey) return;
  const index = typeaheadIndexForKey(state, key);
  if (index < 0) return;
  event.preventDefault();
  if (state.open) setActiveOption(state, index);
  else commitOption(state, index, { restoreFocus: false });
}

function typeaheadIndexForKey(state, key) {
  const now = Date.now();
  state.typeahead = now - state.typeaheadAt > TYPEAHEAD_RESET_MS
    ? key
    : `${state.typeahead}${key}`;
  state.typeaheadAt = now;
  const repeatedCharacter = [...state.typeahead].every((character) => character === state.typeahead[0]);
  const query = repeatedCharacter ? key : state.typeahead;
  const startIndex = state.open ? state.activeIndex : state.select.selectedIndex;
  return typeaheadOptionIndex([...state.select.options], query, startIndex);
}

function setActiveOption(state, index, { scroll = true } = {}) {
  if (!availableIndex(state, index)) return;
  state.activeIndex = index;
  state.optionNodes.forEach((option, optionIndex) => option?.classList.toggle("is-active", optionIndex === index));
  const active = state.optionNodes[index];
  state.trigger.setAttribute("aria-activedescendant", active.id);
  if (scroll && state.open) {
    requestAnimationFrame(() => active.scrollIntoView({ block: "nearest" }));
  }
}

function commitOption(state, index, { restoreFocus = true } = {}) {
  if (!availableIndex(state, index)) return;
  const previousValue = state.select.value;
  state.select.selectedIndex = index;
  state.sync();
  closeCombobox(state);
  if (state.select.value !== previousValue) {
    const EventConstructor = state.select.ownerDocument.defaultView.Event;
    state.select.dispatchEvent(new EventConstructor("input", { bubbles: true }));
    state.select.dispatchEvent(new EventConstructor("change", { bubbles: true }));
  }
  if (restoreFocus) state.trigger.focus({ preventScroll: true });
}

function positionListbox(state) {
  if (!state.open) return;
  const rect = state.trigger.getBoundingClientRect();
  if (!rect.width || !rect.height || state.wrapper.hidden) {
    closeCombobox(state);
    return;
  }

  const view = state.select.ownerDocument.defaultView;
  const viewportWidth = view.innerWidth;
  const viewportHeight = view.innerHeight;
  const width = Math.min(Math.max(rect.width, 180), viewportWidth - (VIEWPORT_MARGIN * 2));
  const left = clamp(rect.left, VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
  const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN - LISTBOX_GAP;
  const spaceAbove = rect.top - VIEWPORT_MARGIN - LISTBOX_GAP;
  const placeAbove = spaceBelow < LISTBOX_MIN_HEIGHT && spaceAbove > spaceBelow;
  const availableHeight = placeAbove ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(LISTBOX_MIN_HEIGHT, Math.min(LISTBOX_MAX_HEIGHT, availableHeight));

  state.listbox.style.width = `${width}px`;
  state.listbox.style.maxHeight = `${maxHeight}px`;
  state.listbox.style.left = `${left}px`;
  const listboxHeight = Math.min(state.listbox.scrollHeight, maxHeight);
  state.listbox.style.top = placeAbove
    ? `${Math.max(VIEWPORT_MARGIN, rect.top - LISTBOX_GAP - listboxHeight)}px`
    : `${rect.bottom + LISTBOX_GAP}px`;
  state.listbox.dataset.placement = placeAbove ? "top" : "bottom";
}

function showPopover(listbox) {
  try {
    if (typeof listbox.showPopover === "function" && !popoverOpen(listbox)) listbox.showPopover();
  } catch {
    // The fixed-position fallback remains visible through the is-open class.
  }
}

function hidePopover(listbox) {
  try {
    if (typeof listbox.hidePopover === "function" && popoverOpen(listbox)) listbox.hidePopover();
  } catch {
    // The hidden attribute closes the fixed-position fallback.
  }
}

function popoverOpen(listbox) {
  try {
    return listbox.matches(":popover-open");
  } catch {
    return false;
  }
}

function effectivelyDisabled(select) {
  return select.disabled || select.matches(":disabled");
}

function availableIndex(state, index) {
  return Number.isInteger(index)
    && index >= 0
    && index < state.select.options.length
    && !optionUnavailable(state.select.options[index]);
}

function optionUnavailable(option) {
  return !option || option.disabled || option.hidden || option.parentElement?.disabled === true;
}

function optionLabel(option) {
  return String(option?.label || option?.textContent || "").trim();
}

function optionSearchText(option) {
  return normalizeSearchText(optionLabel(option));
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function forcedColorsActive(root) {
  return root.ownerDocument?.defaultView?.matchMedia?.("(forced-colors: active)").matches
    || root.defaultView?.matchMedia?.("(forced-colors: active)").matches
    || false;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
