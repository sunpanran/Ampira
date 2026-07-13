const SECTION_LABELS = new Set([
  "核心判断", "内容脉络", "关键信息", "为什么值得看", "下一步", "信息边界",
  "直接回答", "本地依据", "补充判断", "建议动作",
  "网站定位", "适合谁", "使用提醒",
  "Core take", "What it says", "Key details", "Why it matters", "Next step", "Limits",
  "Direct answer", "Local evidence", "Additional context", "Suggested action",
  "Site purpose", "Who it is for", "Usage notes",
  "核心判斷", "內容脈絡", "關鍵資訊", "為什麼值得看", "下一步", "資訊邊界",
  "直接回答", "本機依據", "補充判斷", "建議動作",
  "網站定位", "適合誰", "使用提醒",
]);

const DIRECT_ANSWER_LABELS = new Set(["直接回答", "直接回答", "Direct answer"]);

export function cleanAiAnswerMarkup(value) {
  return String(value || "")
    .replace(/```[\w-]*\s*/g, "")
    .replace(/```/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+[.)]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseAiAnswer(value) {
  const text = cleanAiAnswerMarkup(value);
  const sections = [];
  let current = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      if (current?.body && !current.body.endsWith("\n")) current.body += "\n";
      continue;
    }

    if (SECTION_LABELS.has(line)) {
      current = { title: line, body: "" };
      sections.push(current);
      continue;
    }

    const match = line.match(/^([^:：]{2,24})[:：]\s*(.*)$/);
    if (match && SECTION_LABELS.has(match[1].trim())) {
      current = { title: match[1].trim(), body: match[2].trim() };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = { title: "", body: line };
      sections.push(current);
    } else {
      current.body += `${current.body && !current.body.endsWith("\n") ? "\n" : ""}${line}`;
    }
  }

  return {
    text,
    sections: sections.filter((section) => section.body.trim()).map((section) => ({
      ...section,
      body: section.body.trim(),
    })),
  };
}

export function extractDirectAnswer(value) {
  const parsed = parseAiAnswer(value);
  const directAnswer = parsed.sections.find((section) => DIRECT_ANSWER_LABELS.has(section.title));
  return directAnswer?.body || parsed.text;
}
