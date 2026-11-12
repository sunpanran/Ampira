import { normalizeBotModule } from "../../extension/core/bot-board.mjs";
import { fail, isId, assertPlainData } from "./patch.mjs";
import { digest } from "./tasks.mjs";

export function questionReferences(state, taskId) {
  const current = state.actions.filter(entry => entry.taskId === taskId && entry.action.type === "message");
  const conversations = new Set(current.map(entry => entry.action.conversationId).filter(Boolean));
  const history = state.actions.filter(entry => entry.answered && conversations.has(entry.action.conversationId)).slice(-2);
  return [...new Map([...current, ...history].flatMap(entry => entry.action.references || []).map(item => [item.id, item])).values()].slice(0, 6);
}
export function completeQuestions(state, input, now) {
  assertPlainData(input);
  if (!isId(input?.taskId) || !Array.isArray(input.replies) || !input.replies.length || input.replies.length > 4
    || Object.keys(input).some(key => !["taskId", "replies"].includes(key))) fail("invalid-task");
  if (new Set(input.replies.map(reply => reply?.id)).size !== input.replies.length) fail("duplicate-message");
  const previous = state.modules.replies?.data.items || [], additions = [], completed = [];
  const references = questionReferences(state, input.taskId);
  for (const reply of input.replies) {
    const entry = state.actions.find(item => item.action.id === reply?.id && item.taskId === input.taskId && item.action.type === "message");
    if (!entry || typeof reply.text !== "string" || !reply.text.trim() || reply.text.length > 16000
      || Object.keys(reply).some(key => !["id", "text", "sourceIds"].includes(key))) fail("invalid-reply");
    const sourceIds = reply.sourceIds || [];
    if (!Array.isArray(sourceIds) || sourceIds.length > 3 || sourceIds.some(id => !references.some(source => source.id === id))) fail("invalid-source-id");
    const links = [...new Set(sourceIds)].map(id => references.find(source => source.id === id)).filter(source => source.url)
      .map(source => `[${String(source.title || source.source || "Source").replace(/[\[\]\r\n]/g, " ")}](${source.url.replace(/[()]/g, value => encodeURIComponent(value))})`);
    const text = `${reply.text.trim()}${links.length ? `\n\n${links.join(" · ")}` : ""}`;
    if (text.length > 16000) fail("reply-too-large");
    const id = `reply-${digest(reply.id).slice(0, 32)}`, existing = previous.find(item => item.id === id);
    if (existing && existing.text !== text || entry.answered && !existing) fail("conflict");
    if (!existing) additions.push({ id, replyTo: reply.id, text, bot: "Bot", createdAt: now });
    completed.push(entry);
  }
  if (additions.length) {
    const module = normalizeBotModule("replies", { schemaVersion: 1, bot: "Bot", updatedAt: now, data: { items: [...additions, ...previous].slice(0, 300) } });
    if (Buffer.byteLength(JSON.stringify(module)) > 700 * 1024) fail("snapshot-too-large");
    state.modules.replies = module;
  }
  completed.forEach(entry => { entry.answered = true; });
  return { completed: completed.map(entry => entry.action.id) };
}
