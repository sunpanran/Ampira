import { createHash } from "node:crypto";
import { compactQuestionContext } from "../../extension/core/bot-task-context.mjs";

export const MAX_MESSAGES_PER_BATCH = 4;
export const MAX_MESSAGE_CHARS = 6000;
export const MAX_CONTEXT_CHARS = 1200;
export function digest(value) { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }

export function prepareTask(messages, modules, oldTask, now, history = []) {
  if (!messages.length) return null;
  const remaining = new Map(messages.map(item => [item.id, item]));
  const first = oldTask?.kind === "question" ? oldTask.messages.map(item => remaining.get(item.id)).find(Boolean) || messages[0] : messages[0];
  const conversationId = first.conversationId || first.id, locale = first.locale || "zh-CN";
  const queue = oldTask?.kind === "question" && oldTask.messages.some(item => remaining.has(item.id))
    ? oldTask.messages.map(item => remaining.get(item.id)).filter(Boolean) : messages;
  const selected = []; let size = 0;
  for (const message of queue) {
    if ((message.conversationId || message.id) !== conversationId || (message.locale || "zh-CN") !== locale) continue;
    const length = Array.from(message.text).length;
    if (selected.length >= MAX_MESSAGES_PER_BATCH || selected.length && size + length > MAX_MESSAGE_CHARS) break;
    selected.push(message); size += length;
  }
  if (!selected.length) return null;
  const recent = history.filter(entry => entry.answered && entry.action?.conversationId === conversationId).slice(-2).map(entry => ({
    question: entry.action.text,
    answer: (modules.replies?.data?.items || []).filter(reply => reply.replyTo === entry.action.id).map(reply => reply.text).join("\n"),
  }));
  const references = [...new Map(selected.flatMap(item => item.references || []).map(item => [item.id, item])).values()].slice(0, 3);
  const context = compactQuestionContext(references, recent, selected.map(item => item.contextNotice || "").filter(Boolean).join(" "));
  const id = oldTask?.kind === "question" && oldTask.messages.some(item => selected.some(message => message.id === item.id))
    ? oldTask.id : "batch-" + digest(selected.map(item => item.id)).slice(0, 32);
  return { id, kind: "question", locale, createdAt: oldTask?.id === id ? oldTask.createdAt : now,
    messages: selected.map(item => ({ id: item.id, text: item.text })), context };
}
