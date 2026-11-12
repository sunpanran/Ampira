import assert from "node:assert/strict";
import { parseAiMarkdown, renderAiMarkdown, safeMarkdownUrl } from "../../assets/client/ai-markdown.mjs";

const blocks = parseAiMarkdown([
  "# Title",
  "",
  "Paragraph with **bold**, `code`, and [safe](https://example.com/path).",
  "",
  "> quoted text",
  "",
  "- one",
  "- two",
  "",
  "| Name | Value |",
  "| :--- | ---: |",
  "| Ampira | local |",
  "",
  "```js",
  'const html = "<script>alert(1)</script>";',
  "```",
].join("\n"));

assert.deepEqual(blocks.map((block) => block.type), ["heading", "paragraph", "quote", "list", "table", "code"]);
assert.equal(blocks[4].alignments[0], "left");
assert.equal(blocks[4].alignments[1], "right");
assert(blocks[5].text.includes("<script>"), "raw HTML inside code must remain inert text");
assert.equal(parseAiMarkdown("<img src=x onerror=alert(1)>")[0].text, "<img src=x onerror=alert(1)>", "raw HTML must be represented as paragraph text rather than markup");
assert.equal(safeMarkdownUrl("https://example.com/a"), "https://example.com/a");
assert.equal(safeMarkdownUrl("http://localhost:4173/a"), "http://localhost:4173/a");
assert.equal(safeMarkdownUrl("javascript:alert(1)"), "");
assert.equal(safeMarkdownUrl("data:text/html,unsafe"), "");
assert.equal(safeMarkdownUrl("http://example.com/insecure"), "");

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
try {
  globalThis.document = {
    createElement: (tag) => node(tag),
    createTextNode: (text) => node("#text", text),
    createDocumentFragment: () => node("#fragment"),
  };
  const target = node("div");
  const opened = [];
  renderAiMarkdown(target, [
    "## 今日重点", "", "**重点**、*说明*与 `inline_code`。", "",
    "- 第一条", "- 第二条", "", "> 引用内容", "",
    "| 项目 | 状态 |", "| --- | --- |", "| 任务 | 完成 |", "",
    "```js", "const value = 1;", "", "  value;", "```", "",
    '<script>unsafe()</script><img src="https://example.com/tracker" onerror="unsafe()">',
    "[危险](javascript:unsafe) [数据](data:text/html,unsafe) [来源](https://example.com/source)",
  ].join("\n"), { labels: { copyCode: "复制代码" }, openExternal: (...args) => opened.push(args) });
  const nodes = descendants(target);
  for (const tag of ["h2", "strong", "em", "ul", "blockquote", "table", "pre"]) {
    assert(nodes.some((item) => item.tag === tag), `${tag} must render as a structured element`);
  }
  assert(!nodes.some((item) => ["script", "img", "iframe"].includes(item.tag)), "remote HTML and images must never create active elements");
  assert(nodes.some((item) => item.tag === "#text" && item.textContent.includes("<script>")), "HTML must remain visible inert text");
  const code = nodes.find((item) => item.tag === "pre").children[0];
  assert.equal(code.textContent, "const value = 1;\n\n  value;", "code block whitespace must be preserved");
  assert.equal(nodes.find((item) => item.tag === "button").attributes["aria-label"], "复制代码");
  const links = nodes.filter((item) => item.tag === "a");
  assert.deepEqual(links.map((item) => item.href), ["https://example.com/source"]);
  let prevented = false;
  links[0].events.click({ preventDefault() { prevented = true; } });
  assert(prevented);
  assert.deepEqual(opened, [["https://example.com/source", "来源"]]);
  renderAiMarkdown(target, "更新后的正文");
  assert.equal(descendants(target).filter((item) => item.tag === "p").length, 1);
  assert(!descendants(target).some((item) => item.tag === "table"), "rerender must replace stale Markdown content");
} finally {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
}

console.log("AI Markdown tests passed");

function node(tag, textContent = "") {
  return { tag, textContent, children: [], attributes: {}, events: {}, dataset: {}, style: { setProperty() {} },
    append(...items) { for (const item of items) this.children.push(...(item.tag === "#fragment" ? item.children : [item])); },
    replaceChildren(...items) { this.children = []; this.append(...items); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(key, handler) { this.events[key] = handler; },
  };
}
function descendants(target) { return target.children.flatMap((item) => [item, ...descendants(item)]); }
