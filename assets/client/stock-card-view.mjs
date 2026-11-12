import { STOCK_LIMIT, STOCK_OPTED_IN_KEY, STOCK_ORIGIN, normalizeStockSymbol, stockIdentity } from "../../extension/core/stocks.mjs";
import { requestOrigins } from "./permission-client.mjs";
import { nodesEqualIgnoringIconLoadState, spanText } from "./dom.mjs";

export function createStockCardView({ id, t, getLocale, createIcon, writeValue, localizedErrorMessage,
  stockState, requestRender, isActive, attachLinkContextMenu }) {
  let editing = false, submitting = false, token = 0, formError = "";
  const root = document.createElement("div");
  root.className = "stock-content";
  const form = document.createElement("form");
  form.className = "stock-form utility-entry-form";
  form.id = `stock-form-${id}`;
  const input = document.createElement("input");
  input.className = "utility-entry-input";
  input.type = "text"; input.maxLength = 32; input.autocomplete = "off"; input.spellcheck = false;
  const submit = document.createElement("button");
  submit.type = "submit"; submit.className = "btn utility-entry-submit";
  form.append(input, submit);
  form.addEventListener("submit", addStock);
  const hint = spanText("", "utility-inline-status stock-hint");
  hint.id = `stock-hint-${id}`;
  input.setAttribute("aria-describedby", hint.id);
  const status = spanText("", "utility-inline-status stock-status");
  status.setAttribute("role", "status");
  const retry = button("refresh-cw-01", retryQuotes, "btn stock-retry");
  const list = document.createElement("div");
  list.className = "stock-list utility-scroll-list";
  const footer = document.createElement("div");
  footer.className = "stock-footer";
  const attribution = document.createElement("a");
  attribution.href = "https://gu.qq.com/"; attribution.target = "_blank"; attribution.rel = "noreferrer";
  const timing = spanText("", "stock-timing");
  footer.append(attribution, timing);
  root.append(form, hint, status, retry, list, footer);
  const add = button("plus", () => {
    editing = !editing; formError = ""; requestRender();
    if (editing) input.focus({ preventScroll: true });
  });
  add.setAttribute("aria-controls", form.id);
  const refresh = button("refresh-cw-01", retryQuotes);
  input.addEventListener("keydown", event => {
    if (event.key === "Escape" && stockState.read().symbols.length) {
      event.preventDefault(); event.stopPropagation(); editing = false; formError = ""; requestRender(); add.focus();
    }
  });

  return { render, deactivate() { token += 1; submitting = false; editing = false; formError = ""; } };

  function render() {
    const { symbols, result, error, busy } = stockState.read();
    const composing = editing || !symbols.length;
    root.dataset.colorConvention = getLocale().startsWith("zh") ? "cn" : "global";
    form.hidden = !composing; hint.hidden = !composing;
    input.placeholder = t("stocks.placeholder"); input.setAttribute("aria-label", t("stocks.symbolLabel"));
    input.disabled = submitting; submit.disabled = submitting;
    submit.textContent = t(submitting ? "stocks.adding" : "stocks.add");
    hint.textContent = t("stocks.hint");
    label(add, t(editing ? "stocks.closeEditor" : "stocks.addLabel"));
    add.setAttribute("aria-expanded", String(composing));
    add.disabled = submitting;
    label(refresh, t("stocks.refresh")); refresh.disabled = busy || !symbols.length;
    refresh.classList.toggle("is-loading", busy);
    const message = formError || error?.message || (busy && !result ? t("stocks.loading") : "");
    status.textContent = message; status.hidden = !message;
    status.classList.toggle("is-error", Boolean(formError || error));
    retry.hidden = !error;
    retry.textContent = t(error?.code === "STOCK_PERMISSION_REQUIRED" ? "stocks.authorize" : "stocks.retry");
    retry.disabled = busy;
    list.hidden = !symbols.length;
    syncRows(symbols, result);
    attribution.textContent = t("stocks.source");
    timing.textContent = t(result?.stale || error && result ? "stocks.stale" : "stocks.delayed");
    timing.title = result?.fetchedAt ? t("stocks.fetchedAt", { time: new Date(result.fetchedAt).toLocaleString(getLocale()) }) : "";
    if (symbols.length) queueMicrotask(() => { if (isActive()) stockState.ensure(); });
    return { content: root, actions: [refresh, add], busy };
  }

  function syncRows(symbols, result) {
    const quotes = new Map((result?.quotes || []).map(quote => [quote.symbol, quote]));
    const old = new Map(Array.from(list.children, row => [row.dataset.symbol, row]));
    const active = document.activeElement;
    const focusedSymbol = list.contains(active) ? active?.closest?.(".stock-row")?.dataset.symbol : null;
    const rows = symbols.map(symbol => {
      const next = createRow(symbol, quotes.get(symbol));
      const previous = old.get(symbol);
      return previous && nodesEqualIgnoringIconLoadState(previous, next) ? previous : next;
    });
    rows.forEach((row, index) => { if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null); });
    while (list.children.length > rows.length) list.lastElementChild.remove();
    if (focusedSymbol && active !== document.activeElement) {
      focusSymbol(focusedSymbol);
    }
  }

  function focusSymbol(symbol) {
    const row = Array.from(list.children).find(item => item.dataset.symbol === symbol) || list.firstElementChild;
    (row?.querySelector("a") || (form.hidden ? add : input)).focus({ preventScroll: true });
  }

  function removeStock(symbol) {
    const symbols = stockState.read().symbols, index = symbols.indexOf(symbol);
    if (index < 0) return;
    stockState.update(symbols.filter(item => item !== symbol));
    if (isActive()) focusSymbol(symbols[index + 1] || symbols[index - 1]);
  }

  function createRow(symbol, quote) {
    const identity = stockIdentity(symbol);
    const row = document.createElement("div"); row.className = "stock-row"; row.dataset.symbol = symbol;
    const link = document.createElement("a"); link.className = "efficiency-row stock-quote";
    link.href = identity.url; link.target = "_blank"; link.rel = "noreferrer";
    const main = spanText("", "stock-main");
    const name = spanText(quote?.name || identity.code, "stock-name"); name.title = name.textContent;
    main.append(name, spanText(`${identity.code} · ${t(`stocks.market.${identity.market}`)} · ${identity.currency}`, "stock-detail"));
    const values = spanText("", "stock-values");
    const priceLine = spanText("", "stock-price-line");
    priceLine.append(spanText(quote ? formatNumber(quote.price, identity.market === "hk" ? 3 : 2) : "—", "stock-price"));
    const change = spanText(quote?.changePercent == null ? t("stocks.noQuote") : `${quote.changePercent > 0 ? "+" : ""}${formatNumber(quote.changePercent, 2)}%`, "stock-change");
    // A written sign keeps direction unambiguous across market colour conventions.
    if (quote?.changePercent) change.dataset.direction = quote.changePercent > 0 ? "up" : "down";
    if (quote?.change != null) change.title = t("stocks.change", { value: `${quote.change > 0 ? "+" : ""}${formatNumber(quote.change, identity.market === "hk" ? 3 : 2)}` });
    priceLine.append(change);
    values.append(priceLine);
    const time = spanText(quote?.quotedAt ? quote.quotedAt.slice(5, 16) : "—", "stock-time");
    time.title = quote?.quotedAt ? t("stocks.quotedAt", { time: quote.quotedAt }) : t("stocks.noQuote");
    values.append(time);
    link.append(main, values);
    attachLinkContextMenu(link, { url: identity.url }, () => [{
      label: t("stocks.remove", { name: quote?.name || identity.code }), icon: "trash-01", action: () => removeStock(symbol),
    }]);
    row.append(link);
    return row;
  }

  async function addStock(event) {
    event.preventDefault();
    if (submitting) return;
    const symbol = normalizeStockSymbol(input.value), symbols = stockState.read().symbols;
    formError = !symbol ? t("stocks.invalid") : symbols.includes(symbol) ? t("stocks.duplicate")
      : symbols.length >= STOCK_LIMIT ? t("stocks.limit", { count: STOCK_LIMIT }) : "";
    if (formError) { requestRender(); input.focus(); return; }
    const current = ++token;
    submitting = true; requestRender();
    try {
      writeValue(STOCK_OPTED_IN_KEY, "true");
      const granted = await requestOrigins([`${STOCK_ORIGIN}/*`]);
      if (current !== token || !isActive()) return;
      if (!granted) { formError = t("stocks.permissionDeclined"); return; }
      const latest = stockState.read().symbols;
      if (latest.length >= STOCK_LIMIT) { formError = t("stocks.limit", { count: STOCK_LIMIT }); return; }
      input.value = ""; editing = false;
      stockState.update([...latest, symbol]);
    } catch (error) { if (current === token) formError = localizedErrorMessage(error); }
    finally {
      if (current === token) {
        submitting = false; requestRender();
        (form.hidden ? add : input).focus({ preventScroll: true });
      }
    }
  }

  async function retryQuotes() {
    if (stockState.read().busy) return;
    if (stockState.read().error?.code === "STOCK_PERMISSION_REQUIRED") {
      const current = token;
      try {
        writeValue(STOCK_OPTED_IN_KEY, "true");
        const granted = await requestOrigins([`${STOCK_ORIGIN}/*`]);
        if (current !== token || !isActive()) return;
        if (!granted) { stockState.setError({ code: "STOCK_PERMISSION_REQUIRED", message: t("stocks.permissionDeclined") }); return; }
      } catch (error) { stockState.setError({ code: "STOCK_PERMISSION_REQUIRED", message: localizedErrorMessage(error) }); return; }
    }
    stockState.ensure({ force: true });
  }

  function button(icon, action, className = "action-toggle") {
    const node = document.createElement("button"); node.type = "button"; node.className = className;
    node.append(createIcon(icon, "action-toggle-icon")); node.addEventListener("click", action); return node;
  }
  function label(node, text) { node.title = text; node.setAttribute("aria-label", text); }
  function formatNumber(value, digits) { return new Intl.NumberFormat(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value); }
}
