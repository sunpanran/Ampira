const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const OMITTED_TAGS = new Set(["script", "style", "noscript", "template", "svg", "canvas"]);

export function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null, ignored: false };
  const stack = [root];
  let index = 0;
  const source = String(html || "");
  while (index < source.length) {
    const open = source.indexOf("<", index);
    if (open < 0) {
      appendText(stack.at(-1), source.slice(index));
      break;
    }
    if (open > index) appendText(stack.at(-1), source.slice(index, open));
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    const end = findTagEnd(source, open + 1);
    if (end < 0) {
      appendText(stack.at(-1), source.slice(open));
      break;
    }
    const token = source.slice(open + 1, end).trim();
    index = end + 1;
    if (!token || token[0] === "!" || token[0] === "?") continue;
    if (token[0] === "/") {
      const tag = token.slice(1).trim().split(/\s+/, 1)[0].toLowerCase();
      for (let cursor = stack.length - 1; cursor > 0; cursor -= 1) {
        if (stack[cursor].tag !== tag) continue;
        stack.length = cursor;
        break;
      }
      continue;
    }
    const tagMatch = token.match(/^([^\s/>]+)/);
    if (!tagMatch) continue;
    const tag = tagMatch[1].toLowerCase();
    const parent = stack.at(-1);
    const ignored = parent.ignored || OMITTED_TAGS.has(tag);
    const node = {
      tag,
      attrs: parseAttributes(token.slice(tagMatch[0].length)),
      children: [],
      parent,
      ignored,
    };
    if (!ignored) parent.children.push(node);
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(token)) stack.push(node);
  }
  return root;
}

export function textOf(node) {
  if (!node) return "";
  if (node.tag === "#text") return node.text || "";
  return node.children.map(textOf).join(" ");
}

export function findFirst(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

export function findAll(node, predicate, output = []) {
  if (!node) return output;
  if (predicate(node)) output.push(node);
  for (const child of node.children || []) findAll(child, predicate, output);
  return output;
}

export function walkElements(node, callback) {
  if (!node || node.tag === "#text") return;
  callback(node);
  for (const child of node.children || []) walkElements(child, callback);
}

export function decodeEntities(value) {
  const entities = {
    amp: "&", apos: "'", gt: ">", hellip: "…", laquo: "“", ldquo: "“", lsquo: "‘", lt: "<", mdash: "—", nbsp: " ", ndash: "–", quot: '"', raquo: "”", rdquo: "”", rsquo: "’",
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : match; } catch { return match; }
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function findTagEnd(source, start) {
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

function parseAttributes(raw) {
  const attrs = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of String(raw || "").matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!name || name.startsWith("on")) continue;
    attrs[name] = decodeEntities(firstNonEmpty(match[2], match[3], match[4], ""));
  }
  return attrs;
}

function appendText(parent, value) {
  if (!parent || parent.ignored || !value) return;
  parent.children.push({ tag: "#text", text: value, attrs: {}, children: [], parent, ignored: false });
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}
