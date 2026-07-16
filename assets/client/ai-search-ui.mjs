import { cleanAiAnswerMarkup, extractDirectAnswer, parseAiAnswer } from "./ai-answer-format.mjs";
import { copyText } from "./clipboard.mjs";
import { createThemedIcon } from "./icons.mjs";

const AI_SEARCH_CLOSE_MOTION_MS = 180;
const AI_COPY_FEEDBACK_MS = 1600;
const ARTICLE_FOLLOWUP_MAX_CHARS = 500;
const ARTICLE_FOLLOWUP_MAX_TURNS = 6;

export function createAiSearchController(options) {
  const { state, els, t, apiPost, confirmManualAiUsage } = options;
  let generation = 0;
  let closeTimer = 0;
  let articleConversation = null;

  return { open, close, run };

  function open(query = "", shouldRun = false) {
    generation += 1;
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = 0;
    state.aiSearchBusy = false;
    els.aiSearchSubmit.disabled = false;
    els.aiSearchOverlay.classList.remove("closing");
    els.aiSearchOverlay.classList.add("open");
    resetArticleConversation();
    options.syncSearchCopy({ forceDialog: true });
    document.querySelectorAll(".nav-btn").forEach((item) => item.classList.toggle("active", item.id === "aiSearchNav"));
    resetAnswer();
    els.aiSearchInput.value = query || "";
    if (shouldRun) options.clearTopSearchFilter();
    els.aiSearchInput.focus();
    if (shouldRun && els.aiSearchInput.value.trim()) run(els.aiSearchInput.value);
  }

  function close() {
    if (!els.aiSearchOverlay.classList.contains("open") || els.aiSearchOverlay.classList.contains("closing")) return;
    generation += 1;
    state.aiSearchBusy = false;
    els.aiSearchSubmit.disabled = false;
    if (state.aiSearchTypeTimer) clearInterval(state.aiSearchTypeTimer);
    state.aiSearchTypeTimer = null;
    els.aiSearchOverlay.classList.add("closing");
    const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : AI_SEARCH_CLOSE_MOTION_MS;
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      els.aiSearchOverlay.classList.remove("open", "closing");
      resetArticleConversation();
      resetAnswer();
      options.syncNavToCurrentSection();
    }, closeDelay);
  }

  async function run(rawQuery) {
    const rawText = String(rawQuery || "").trim();
    if (!rawText || state.aiSearchBusy) return;
    const startsNewArticle = looksLikeUrl(rawText);
    if (startsNewArticle && articleConversation) {
      resetArticleConversation();
      resetAnswer();
      options.syncSearchCopy({ forceDialog: true });
    }
    const isFollowup = Boolean(articleConversation && !startsNewArticle);
    const query = isFollowup ? limitText(rawText, ARTICLE_FOLLOWUP_MAX_CHARS) : rawText;
    if (!await confirmManualAiUsage({ aiEnabled: state.data?.ai?.enabled === true })) return;
    const requestGeneration = ++generation;
    const articleContext = isFollowup ? conversationPayload() : null;
    let pendingAnswer = null;
    state.aiSearchBusy = true;
    els.aiSearchSubmit.disabled = true;
    els.aiSearchMeta.textContent = t(isFollowup
      ? "aiSearch.answeringFollowup"
      : (startsNewArticle ? "aiSearch.readingPage" : "aiSearch.organizingAnswer"));
    if (isFollowup) {
      pendingAnswer = appendConversationRequest(query);
    } else {
      setGeneratedDisclaimerVisible(false);
      els.aiAnswer.hidden = false;
      els.aiAnswer.dataset.mode = "loading";
      els.aiAnswer.textContent = t("aiSearch.analyzing");
    }
    try {
      const permissionUrl = isFollowup ? articleConversation.url : (startsNewArticle ? query : "");
      if (permissionUrl && typeof options.requestWebsitePermission === "function") {
        els.aiSearchMeta.textContent = t("aiSearch.requestingWebsitePermission");
        const granted = await options.requestWebsitePermission(permissionUrl);
        if (!isCurrent(requestGeneration)) return;
        if (!granted) {
          els.aiSearchMeta.textContent = t("aiSearch.permissionRequired");
          if (isFollowup) finishConversationResponse(pendingAnswer, t("aiSearch.permissionDeclined"), "notice");
          else streamAnswer(t("aiSearch.permissionDeclined"), [], "notice");
          return;
        }
        els.aiSearchMeta.textContent = t(isFollowup ? "aiSearch.answeringFollowup" : "aiSearch.readingPage");
      }
      const result = await apiPost("/api/ai/search", {
        query,
        ...(articleContext ? { articleContext } : {}),
      });
      if (!isCurrent(requestGeneration)) return;
      if (!result.ok) throw new Error(options.localizedResponseMessage(result, "error.requestFailed"));
      const label = result.mode === "article-followup"
        ? t("aiSearch.followupAnswer")
        : (result.type === "url"
          ? t(result.mode === "article" ? "aiSearch.articleSummary" : "aiSearch.websiteIntro")
          : t("aiSearch.answer"));
      els.aiSearchMeta.textContent = result.cached ? t("aiSearch.cached", { label }) : label;
      const answer = result.error ? t("aiSearch.localFallback", { answer: result.answer, error: result.error }) : result.answer;
      if (isFollowup) {
        finishConversationResponse(pendingAnswer, answer, result.usedAi ? "assistant" : "notice");
        if (result.usedAi) {
          setGeneratedDisclaimerVisible(true);
          articleConversation.turns.push({ question: query, answer: String(result.answer || "").trim() });
          els.aiSearchInput.value = "";
        }
      } else {
        streamAnswer(answer, result.links || [], result.usedAi ? result.mode : "fallback");
        setGeneratedDisclaimerVisible(result.usedAi);
        if (result.usedAi && result.mode === "article") startArticleConversation(result, answer);
      }
    } catch (error) {
      if (!isCurrent(requestGeneration)) return;
      els.aiSearchMeta.textContent = t("error.requestFailed");
      if (isFollowup) finishConversationResponse(pendingAnswer, options.localizedErrorMessage(error), "error");
      else streamAnswer(options.localizedErrorMessage(error), [], "error");
    } finally {
      if (requestGeneration !== generation) return;
      state.aiSearchBusy = false;
      els.aiSearchSubmit.disabled = false;
      if (articleConversation) els.aiSearchInput.focus();
    }
  }

  function isCurrent(requestGeneration) {
    return requestGeneration === generation && els.aiSearchOverlay.classList.contains("open");
  }

  function startArticleConversation(result, answer) {
    const source = (result.links || []).find((link) => link?.url);
    if (!source) return;
    articleConversation = {
      type: "article",
      url: source.url,
      title: source.title || source.url,
      summary: String(result.answer || answer || "").trim(),
      turns: [],
    };
    els.aiSearchInput.value = "";
    els.aiSearchInput.maxLength = ARTICLE_FOLLOWUP_MAX_CHARS;
    els.aiSearchInput.placeholder = t("aiSearch.followupInput");
    els.aiSearchInput.setAttribute("aria-label", t("aiSearch.followupInput"));
    els.aiSearchSubmit.textContent = t("aiSearch.followupSubmit");
    els.aiSearchMeta.textContent = t("aiSearch.articleReady", { title: articleConversation.title });
    els.aiSearchInput.focus();
  }

  function resetArticleConversation() {
    articleConversation = null;
    els.aiSearchInput.removeAttribute("maxlength");
  }

  function conversationPayload() {
    return {
      type: "article",
      url: articleConversation.url,
      summary: articleConversation.summary,
      turns: articleConversation.turns.slice(-ARTICLE_FOLLOWUP_MAX_TURNS),
    };
  }

  function resetAnswer() {
    if (state.aiSearchTypeTimer) clearInterval(state.aiSearchTypeTimer);
    state.aiSearchTypeTimer = null;
    els.aiAnswer.hidden = true;
    els.aiAnswer.removeAttribute("data-mode");
    els.aiAnswer.classList.remove("has-copy-action");
    els.aiAnswer.replaceChildren();
    setGeneratedDisclaimerVisible(false);
  }

  function setGeneratedDisclaimerVisible(visible) {
    els.aiSearchGeneratedDisclaimer.hidden = visible !== true;
  }

  function streamAnswer(text, links, mode = "answer") {
    if (state.aiSearchTypeTimer) clearInterval(state.aiSearchTypeTimer);
    state.aiSearchTypeTimer = null;
    els.aiAnswer.replaceChildren();
    els.aiAnswer.classList.remove("has-copy-action");
    els.aiAnswer.dataset.mode = mode;
    const rawContent = String(text || "").trim() || t("aiSearch.noAnswer");
    const content = mode === "dashboard"
      ? extractDirectAnswer(rawContent)
      : cleanAiAnswerMarkup(rawContent);
    if (mode === "dashboard") els.aiAnswer.append(document.createTextNode(content));
    else renderStructuredAnswer(content, els.aiAnswer);
    appendLinks(links, els.aiAnswer);
    if (mode !== "notice" && mode !== "error") appendAnswerCopyButton(content);
    els.aiAnswer.scrollTop = 0;
    revealAnswer();
  }

  function appendConversationRequest(question) {
    els.aiAnswer.dataset.mode = "conversation";
    const questionNumber = els.aiAnswer.querySelectorAll(".ai-conversation-message.is-user").length + 1;
    appendConversationMessage("user", question, { questionNumber });
    const pending = appendConversationMessage("assistant", t("aiSearch.analyzing"), { pending: true });
    els.aiAnswer.scrollTop = els.aiAnswer.scrollHeight;
    return pending;
  }

  function appendConversationMessage(role, text, { pending = false, questionNumber = 0 } = {}) {
    const message = document.createElement("section");
    message.className = `ai-conversation-message is-${role}${pending ? " is-pending" : ""}`;
    if (pending) message.setAttribute("aria-busy", "true");
    const label = document.createElement("div");
    label.className = "ai-conversation-label";
    label.textContent = role === "user" ? `${questionNumber}.` : t("aiSearch.assistant");
    const body = document.createElement("div");
    body.className = "ai-conversation-body";
    body.textContent = role === "assistant" ? cleanAiAnswerMarkup(text) : String(text || "");
    message.append(label, body);
    els.aiAnswer.append(message);
    els.aiAnswer.hidden = false;
    return message;
  }

  function finishConversationResponse(message, text, mode) {
    if (!message?.isConnected) return;
    message.className = `ai-conversation-message is-assistant${mode === "error" ? " is-error" : ""}${mode === "notice" ? " is-notice" : ""}`;
    message.removeAttribute("aria-busy");
    const body = message.querySelector(".ai-conversation-body");
    body.textContent = cleanAiAnswerMarkup(String(text || "").trim() || t("aiSearch.noAnswer"));
    if (mode === "assistant") message.append(createAiCopyButton(() => body.textContent));
    els.aiAnswer.scrollTop = els.aiAnswer.scrollHeight;
  }

  function appendAnswerCopyButton(content) {
    const report = els.aiAnswer.querySelector(".ai-answer-report");
    const host = report || els.aiAnswer;
    if (!report) els.aiAnswer.classList.add("has-copy-action");
    host.append(createAiCopyButton(() => content));
  }

  function createAiCopyButton(getText) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-copy-button";
    button.setAttribute("aria-live", "polite");
    setCopyButtonState(button, "idle");
    button.addEventListener("click", async () => {
      if (button.dataset.busy === "true") return;
      button.dataset.busy = "true";
      const copied = await copyText(getText());
      delete button.dataset.busy;
      setCopyButtonState(button, copied ? "copied" : "error");
      if (button.copyResetTimer) window.clearTimeout(button.copyResetTimer);
      button.copyResetTimer = window.setTimeout(() => {
        button.copyResetTimer = 0;
        if (button.isConnected) setCopyButtonState(button, "idle");
      }, AI_COPY_FEEDBACK_MS);
    });
    return button;
  }

  function setCopyButtonState(button, stateName) {
    const key = stateName === "copied"
      ? "aiSearch.copySuccess"
      : stateName === "error" ? "aiSearch.copyFailed" : "aiSearch.copyAnswer";
    const label = t(key);
    button.dataset.state = stateName;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.replaceChildren(createThemedIcon(stateName === "copied" ? "check" : "copy", "ai-copy-icon"));
  }

  function revealAnswer() {
    els.aiAnswer.hidden = false;
    els.aiAnswer.classList.remove("is-resolving");
    void els.aiAnswer.offsetWidth;
    els.aiAnswer.classList.add("is-resolving");
    els.aiAnswer.addEventListener("animationend", () => {
      els.aiAnswer.classList.remove("is-resolving");
    }, { once: true });
  }

  function renderStructuredAnswer(text, target) {
    const parsed = parseAiAnswer(text);
    const report = document.createElement("div");
    report.className = "ai-answer-report";
    parsed.sections.forEach((section, index) => {
      const block = document.createElement("section");
      block.className = "ai-answer-section";
      block.dataset.index = String(index + 1).padStart(2, "0");
      if (section.title) {
        const heading = document.createElement("h3");
        heading.textContent = section.title;
        block.append(heading);
      }
      section.body.split("\n").filter(Boolean).forEach((paragraph) => {
        const item = document.createElement(paragraph.startsWith("• ") ? "div" : "p");
        item.className = paragraph.startsWith("• ") ? "ai-answer-point" : "";
        item.textContent = paragraph.startsWith("• ") ? paragraph.slice(2) : paragraph;
        block.append(item);
      });
      report.append(block);
    });
    target.append(report);
  }

  function appendLinks(links, target) {
    const validLinks = (links || []).filter((link) => link?.url).slice(0, 6);
    if (!validLinks.length) return;
    const block = document.createElement("div");
    block.className = "ai-link-list";
    validLinks.forEach((link) => {
      const anchor = document.createElement("a");
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = link.title || link.url;
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        options.openExternal(link.url, link.title || link.url);
      });
      block.append(anchor);
    });
    target.append(block);
  }
}

function limitText(value, maxChars) {
  return [...String(value || "")].slice(0, maxChars).join("");
}

function looksLikeUrl(value) {
  const text = String(value || "").trim();
  return /^https?:\/\//i.test(text) || /^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(text);
}
