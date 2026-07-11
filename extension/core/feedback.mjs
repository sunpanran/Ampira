const FEEDBACK_ACTIONS = new Set(["opened", "queued", "read", "dismissed", "more_like_this"]);

export function normalizeFeedback(body = {}) {
  const action = clean(body.action, 32);
  const articleId = clean(body.articleId, 200);
  if (!FEEDBACK_ACTIONS.has(action) || !articleId) throw feedbackError();
  return {
    articleId,
    action,
    source: clean(body.source, 200),
    category: clean(body.category, 200),
    topics: [...new Set((Array.isArray(body.topics) ? body.topics : [])
      .map((topic) => clean(topic, 100))
      .filter(Boolean))].slice(0, 20),
  };
}

function clean(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function feedbackError() {
  const error = new Error("INVALID_FEEDBACK");
  error.code = "INVALID_FEEDBACK";
  error.messageKey = "background.error.feedbackInvalid";
  error.messageParams = {};
  error.retryable = false;
  return error;
}
