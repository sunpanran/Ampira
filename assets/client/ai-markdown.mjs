import { copyText } from "./clipboard.mjs";
import { createThemedIcon } from "./icons.mjs";

const BLOCK_START = /^(?:```|#{1,6}\s|>\s?|[-+*]\s+|\d+[.)]\s+)/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function renderAiMarkdown(target, value, options = {}) {
  const fragment = document.createDocumentFragment();
  for (const block of parseAiMarkdown(value)) fragment.append(renderBlock(block, options));
  target.replaceChildren(fragment);
}

export function parseAiMarkdown(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fence[1].trim().slice(0, 40), text: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (line.includes("|") && TABLE_DIVIDER.test(lines[index + 1] || "")) {
      const header = tableCells(line);
      const alignments = tableCells(lines[index + 1]).map(tableAlignment);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(tableCells(lines[index++]));
      blocks.push({ type: "table", header, alignments, rows });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }
    const list = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[2]);
      const items = [];
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/;
      while (index < lines.length) {
        const match = lines[index].match(pattern);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim()
      && !BLOCK_START.test(lines[index])
      && !(lines[index].includes("|") && TABLE_DIVIDER.test(lines[index + 1] || ""))) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

export function safeMarkdownUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return url.href;
    return "";
  } catch {
    return "";
  }
}

function renderBlock(block, options) {
  if (block.type === "heading") {
    const heading = document.createElement(`h${Math.min(6, Math.max(1, block.level))}`);
    appendInline(heading, block.text, options);
    return heading;
  }
  if (block.type === "code") return renderCodeBlock(block, options);
  if (block.type === "quote") {
    const quote = document.createElement("blockquote");
    appendInlineWithBreaks(quote, block.text, options);
    return quote;
  }
  if (block.type === "list") {
    const list = document.createElement(block.ordered ? "ol" : "ul");
    for (const value of block.items) {
      const item = document.createElement("li");
      appendInline(item, value, options);
      list.append(item);
    }
    return list;
  }
  if (block.type === "table") return renderTable(block, options);
  const paragraph = document.createElement("p");
  appendInlineWithBreaks(paragraph, block.text, options);
  return paragraph;
}

function renderCodeBlock(block, options) {
  const wrapper = document.createElement("div");
  wrapper.className = "ai-markdown-code";
  const toolbar = document.createElement("div");
  toolbar.className = "ai-markdown-code-head";
  const language = document.createElement("span");
  language.textContent = block.language || options.labels?.code || "code";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ai-markdown-code-copy";
  setCodeCopyState(button, false, options);
  button.addEventListener("click", async () => {
    const copied = await copyText(block.text);
    setCodeCopyState(button, copied, options);
    window.setTimeout(() => button.isConnected && setCodeCopyState(button, false, options), 1600);
  });
  toolbar.append(language, button);
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  if (block.language) code.dataset.language = block.language;
  code.textContent = block.text;
  pre.append(code);
  wrapper.append(toolbar, pre);
  return wrapper;
}

function setCodeCopyState(button, copied, options) {
  const label = copied
    ? (options.labels?.codeCopied || "Copied")
    : (options.labels?.copyCode || "Copy code");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.replaceChildren(createThemedIcon(copied ? "check" : "copy", "ai-copy-icon"));
}

function renderTable(block, options) {
  const wrapper = document.createElement("div");
  wrapper.className = "ai-markdown-table-wrap";
  wrapper.tabIndex = 0;
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  block.header.forEach((value, index) => headRow.append(tableCell("th", value, block.alignments[index], options)));
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const values of block.rows) {
    const row = document.createElement("tr");
    block.header.forEach((_, index) => row.append(tableCell("td", values[index] || "", block.alignments[index], options)));
    body.append(row);
  }
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

function tableCell(tagName, value, alignment, options) {
  const cell = document.createElement(tagName);
  if (alignment) cell.style.textAlign = alignment;
  appendInline(cell, value, options);
  return cell;
}

function appendInlineWithBreaks(target, value, options) {
  String(value || "").split("\n").forEach((line, index) => {
    if (index) target.append(document.createElement("br"));
    appendInline(target, line, options);
  });
}

function appendInline(target, value, options) {
  const text = String(value || "");
  const pattern = /(`[^`\n]+`)|(\[S\d+\])|(\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\))|(\*\*([^*\n]+)\*\*)|(__([^_\n]+)__)|(\*([^*\n]+)\*)|(_([^_\n]+)_)/g;
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) target.append(document.createTextNode(text.slice(offset, match.index)));
    if (match[1]) {
      const code = document.createElement("code");
      code.textContent = match[1].slice(1, -1);
      target.append(code);
    } else if (match[2]) {
      appendCitation(target, match[2], options);
    } else if (match[3]) {
      appendLink(target, match[4], match[5], options);
    } else if (match[6] || match[8]) {
      const strong = document.createElement("strong");
      strong.textContent = match[7] || match[9];
      target.append(strong);
    } else {
      const emphasis = document.createElement("em");
      emphasis.textContent = match[11] || match[13];
      target.append(emphasis);
    }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) target.append(document.createTextNode(text.slice(offset)));
}

function appendCitation(target, label, options) {
  const id = label.slice(1, -1);
  if (typeof options.onCitation !== "function" || !options.onCitation(id, true)) {
    target.append(document.createTextNode(label));
    return;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ai-inline-citation";
  button.textContent = label;
  button.setAttribute("aria-label", options.labels?.citation?.replace("{id}", id) || label);
  button.addEventListener("click", () => options.onCitation(id, false));
  target.append(button);
}

function appendLink(target, label, rawUrl, options) {
  const url = safeMarkdownUrl(rawUrl);
  if (!url) {
    target.append(document.createTextNode(`${label} (${rawUrl})`));
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.textContent = label;
  if (typeof options.openExternal === "function") anchor.addEventListener("click", (event) => {
    event.preventDefault();
    options.openExternal(url, label);
  });
  target.append(anchor);
}

function tableCells(line) {
  return String(line || "").trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function tableAlignment(value) {
  const cell = String(value || "").trim();
  if (cell.startsWith(":") && cell.endsWith(":")) return "center";
  if (cell.endsWith(":")) return "right";
  if (cell.startsWith(":")) return "left";
  return "";
}
