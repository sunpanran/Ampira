import assert from "node:assert/strict";
import { parseAiMarkdown, safeMarkdownUrl } from "../../assets/client/ai-markdown.mjs";

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

console.log("AI Markdown tests passed");
