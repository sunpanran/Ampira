let fieldSerial = 0;

export function personalCardControls(createIcon) {
  const node = (tag, className = "") => { const element = document.createElement(tag); element.className = className; return element; };
  function button(className, onClick) {
    const element = node("button", className); element.type = "button";
    if (onClick) element.addEventListener("click", onClick);
    return element;
  }
  function iconButton(icon, onClick) {
    const element = button("action-toggle", onClick);
    element.append(createIcon(icon, "action-toggle-icon")); return element;
  }
  function labelButton(element, label) { element.title = label; element.setAttribute("aria-label", label); }
  function field(control) {
    if (!control.id) control.id = "personal-card-field-" + ++fieldSerial;
    const label = node("div", "personal-card-field"), caption = node("label");
    caption.htmlFor = control.id;
    label.append(caption, control); return { label, caption };
  }
  function select(id) {
    const element = node("select", "utility-entry-input"); element.id = id; return element;
  }
  function choices(select, items, value) {
    const signature = JSON.stringify(items);
    if (select.dataset.options !== signature) {
      select.dataset.options = signature;
      select.replaceChildren(...items.map(([key, label]) => {
        const option = document.createElement("option"); option.value = key; option.textContent = label; return option;
      }));
    }
    select.value = value;
  }
  return { node, button, iconButton, labelButton, field, select, choices };
}
