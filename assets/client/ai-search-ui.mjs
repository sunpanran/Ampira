import { cleanAiAnswerMarkup, parseAiAnswer } from "./ai-answer-format.mjs";
import { copyText } from "./clipboard.mjs";
import { createThemedIcon } from "./icons.mjs";
import { animateElement, createLoadingSurfaceController, MOTION_DURATION } from "./motion.mjs";
import { createAiLoadingState } from "./ui-primitives.mjs";
const AI_COPY_FEEDBACK_MS = 1600;
const INITIAL_QUERY_MAX_CHARS = 8000;
const FOLLOWUP_MAX_CHARS = 8000;
const FOLLOWUP_MAX_TURNS = 12;
const COMPOSER_MAX_HEIGHT = 144;
const FOCUSABLE_SELECTOR = "a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])";

export async function requestAiSearchWithStreamFallback(payload, options = {}) {
  const fallbackRequest = options.fallbackRequest;
  if (typeof fallbackRequest !== "function") throw new TypeError("fallbackRequest is required");
  if (!options.streamClient) return fallbackRequest(payload);
  let hasStreamedText = false;
  try {
    const stream = options.streamClient.start(payload, {
      onStatus: options.onStatus,
      onDelta: (value) => {
        const text = String(value || "");
        if (!text) return;
        hasStreamedText = true;
        options.onDelta?.(text);
      },
    });
    options.onRequestId?.(stream.requestId);
    return await stream.result;
  } catch (error) {
    const mayFallback = typeof options.canFallback !== "function" || options.canFallback();
    if (error?.code !== "AI_STREAM_DISCONNECTED" || hasStreamedText || !mayFallback) throw error;
    options.onRequestId?.("");
    options.onFallback?.();
    return fallbackRequest(payload);
  }
}

export function createAiSearchController(options) {
  const { state, els, t, apiGet, apiPost, confirmManualAiUsage } = options;
  let generation = 0;
  let closeTimer = 0;
  let session = createAiSearchSession();
  let draftResearchScope = emptyResearchScope();
  let activeRequestScope = null;
  let aiLoadingMotion = null;
  let panelAnimation = null;
  let lastFocusedElement = null;
  let researchFolders = [];
  let researchFoldersPromise = null;
  let researchFolderStatus = "idle";
  let researchView = null;
  let researchViewPromise = null;
  let markdownView = null;
  let markdownViewPromise = null;
  let activeStreamRequestId = "";
  let activePendingAnswer = null;
  let editingMessageId = 0;
  let editRestoreState = null;
  let streamRenderFrame = 0;

  return {
    open,
    close,
    run,
    submitOrStop,
    cancelEdit,
    newConversation,
    handleComposerInput,
    handleComposerKeydown,
    handleResearchFolderChange,
    handleWebSearchToggle,
    loadResearchFolders,
    trapFocus,
    syncLocale,
    syncProviderCapability: syncResearchControls,
  };

  function open(query = "", shouldRun = false) {
    const inputQuery = String(query || "");
    const startsFresh = shouldRun && Boolean(inputQuery.trim());
    const wasOpen = els.aiSearchOverlay.classList.contains("open");
    if (!wasOpen) {
      const activeElement = document.activeElement;
      if (activeElement && !els.aiSearchOverlay.contains(activeElement)) lastFocusedElement = activeElement;
    }
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = 0;
    els.aiSearchOverlay.classList.remove("closing");
    if (startsFresh) resetConversation({ animate: false, syncCopy: false });
    els.aiSearchOverlay.classList.add("open");
    options.syncSearchCopy({ forceDialog: true });
    if (session.meta) els.aiSearchMeta.textContent = session.meta;
    else session.meta = els.aiSearchMeta.textContent;
    applyConversationCopy();
    syncResearchControls();
    options.setActiveNavButton(options.navButton);
    if (startsFresh) {
      els.aiSearchInput.value = inputQuery;
      options.clearTopSearchFilter();
    } else if (inputQuery && !session.messages.length) {
      els.aiSearchInput.value = inputQuery;
    }
    syncComposerState();
    autoResizeComposer();
    focusComposer();
    if (startsFresh) void run(inputQuery);
  }

  function close() {
    if (!els.aiSearchOverlay.classList.contains("open") || els.aiSearchOverlay.classList.contains("closing")) return;
    els.aiSearchOverlay.classList.add("closing");
    const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : MOTION_DURATION.state;
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      els.aiSearchOverlay.classList.remove("open", "closing");
      options.syncNavToCurrentSection();
      restoreFocus();
    }, closeDelay);
  }

  function newConversation() {
    stopCurrentRequest({ preservePartial: false });
    resetConversation({ animate: true, syncCopy: true });
    focusComposer();
  }

  function submitOrStop() {
    if (state.aiSearchBusy) {
      stopCurrentRequest({ preservePartial: true });
      return;
    }
    void run(els.aiSearchInput.value);
  }

  async function run(rawQuery, runOptions = {}) {
    const rawText = String(rawQuery || "").trim();
    if (!rawText || state.aiSearchBusy) return;
    const startsNewArticle = looksLikeUrl(rawText);
    const aiEnabled = state.data?.ai?.enabled === true;
    if (!await confirmManualAiUsage({ aiEnabled: state.data?.ai?.enabled === true })) return;
    if (startsNewArticle && session.messages.length) {
      resetConversation({ animate: false, syncCopy: true });
      els.aiSearchInput.value = rawText;
    }
    if (editingMessageId) truncateConversationForEdit(editingMessageId);
    const replacementAnswer = runOptions.replaceAnswer?.role === "assistant"
      ? runOptions.replaceAnswer : null;
    const isResearchFollowup = session.context?.type === "question" && session.context?.research === true;
    const isFollowup = Boolean(!replacementAnswer
      && (aiEnabled || isResearchFollowup) && session.context && !startsNewArticle);
    const query = limitText(rawText, isFollowup ? FOLLOWUP_MAX_CHARS : INITIAL_QUERY_MAX_CHARS);
    const followupContext = isFollowup ? conversationPayload(session.context) : null;
    const researchScope = startsNewArticle
      ? emptyResearchScope()
      : availableResearchScope(runOptions.research || currentResearchScope(), runOptions.cursor);
    const requestGeneration = ++generation;
    activeRequestScope = Object.freeze({ ...researchScope });
    state.aiSearchBusy = true;
    syncResearchControls();
    setAiSearchMeta(t(isFollowup
      ? "aiSearch.answeringFollowup"
      : (startsNewArticle ? "aiSearch.readingPage" : "aiSearch.organizingAnswer")));
    const pendingAnswer = appendConversationRequest(query, researchScope, runOptions);
    activePendingAnswer = pendingAnswer;
    syncComposerState();
    try {
      const permissionUrl = isFollowup ? session.context?.url : (startsNewArticle ? query : "");
      if (permissionUrl && typeof options.requestWebsitePermission === "function") {
        setAiSearchMeta(t("aiSearch.requestingWebsitePermission"));
        const granted = await options.requestWebsitePermission(permissionUrl);
        if (!isCurrent(requestGeneration)) return;
        if (!granted) {
          setAiSearchMeta(t("aiSearch.permissionRequired"));
          await finishConversationResponse(pendingAnswer, {
            text: t("aiSearch.permissionDeclined"),
            status: "notice",
          });
          return;
        }
        setAiSearchMeta(t(isFollowup ? "aiSearch.answeringFollowup" : "aiSearch.readingPage"));
      }
      const payload = {
        query,
        ...(followupContext?.type === "article" ? { articleContext: followupContext } : {}),
        ...(followupContext?.type === "question" ? { questionContext: followupContext } : {}),
        research: {
          bookmarkFolderId: researchScope.bookmarkFolderId,
          webSearch: researchScope.webSearch,
          cursor: researchScope.cursor,
        },
        ...(runOptions.cachePolicy ? { cachePolicy: runOptions.cachePolicy } : {}),
      };
      const result = await requestAiSearchWithStreamFallback(payload, {
        fallbackRequest: (requestPayload) => apiPost("/api/ai/search", requestPayload),
        streamClient: options.streamClient,
        canFallback: () => isCurrent(requestGeneration),
        onRequestId: (requestId) => { activeStreamRequestId = requestId; },
        onStatus: (stage) => handleStreamStatus(requestGeneration, stage),
        onDelta: (text) => appendStreamDelta(requestGeneration, pendingAnswer, text),
        onFallback: () => setAiSearchMeta(t("aiSearch.organizingAnswer")),
      });
      if (!isCurrent(requestGeneration)) return;
      if (!result.ok) throw new Error(options.localizedResponseMessage(result, "error.requestFailed"));
      const label = result.mode === "research"
        ? t("aiSearch.research.answer")
        : result.mode === "article-followup"
        ? t("aiSearch.followupAnswer")
        : (result.mode === "question-followup"
          ? t("aiSearch.questionFollowupAnswer")
          : (result.type === "url"
            ? t(result.mode === "article" ? "aiSearch.articleSummary" : "aiSearch.websiteIntro")
            : t("aiSearch.answer")));
      setAiSearchMeta(result.cached ? t("aiSearch.cached", { label }) : label);
      const answer = result.error && !result.interrupted
        ? t("aiSearch.localFallback", { answer: result.answer, error: result.error })
        : result.answer;
      const retrievalFailed = result.mode === "research" && result.retrievalFailed === true;
      await finishConversationResponse(pendingAnswer, {
        text: answer,
        links: result.links || [],
        responseMode: result.mode,
        status: result.interrupted || retrievalFailed ? "error" : (result.usedAi ? "complete" : "local"),
        usedAi: result.usedAi === true,
        cached: result.cached === true,
        evidence: result.evidence || [],
        coverage: result.coverage || null,
        researchScope: result.researchScope || researchScope,
        sourcePermissionOrigins: result.sourcePermissionOrigins || [],
        settingsRequired: result.settingsRequired === true,
        retrievalFailed,
        nextCursor: result.nextCursor || "",
        incomplete: result.incomplete === true,
        finishReason: result.finishReason || "",
        interrupted: result.interrupted === true,
        retryable: result.retryable === true,
        query,
      });
      if (!isCurrent(requestGeneration) || !pendingAnswer.element?.isConnected) return;
      if (replacementAnswer && (result.usedAi || result.mode === "research") && !result.interrupted) {
        updateReplacementContext(pendingAnswer, query, result.answer);
      } else if (isFollowup && (result.usedAi || result.mode === "research") && !result.interrupted) {
        session.context.turns.push({ question: query, answer: String(result.answer || "").trim() });
        applyConversationCopy();
      } else if (!isFollowup && (result.mode === "research"
        || (result.usedAi && (result.mode === "article" || result.mode === "dashboard")))) {
        startSearchConversation(result, query);
      } else if (!result.usedAi) {
        session.kind = "local";
        applyConversationCopy();
      }
    } catch (error) {
      if (!isCurrent(requestGeneration)) return;
      if (error?.code === "AI_CANCELLED") {
        const partialText = pendingAnswer.hasStreamedText ? pendingAnswer.text : "";
        await finishConversationResponse(pendingAnswer, {
          text: partialText || t("aiSearch.stopped"),
          status: "stopped",
          usedAi: Boolean(partialText),
          researchScope,
          query,
        });
        return;
      }
      setAiSearchMeta(t("error.requestFailed"));
      const partialText = pendingAnswer.hasStreamedText ? pendingAnswer.text : "";
      await finishConversationResponse(pendingAnswer, {
        text: partialText || options.localizedErrorMessage(error),
        status: "error",
        interrupted: Boolean(partialText),
        retryable: error?.retryable === true,
        researchScope,
        query,
      });
    } finally {
      if (!isCurrent(requestGeneration)) return;
      state.aiSearchBusy = false;
      activeStreamRequestId = "";
      activePendingAnswer = null;
      activeRequestScope = null;
      syncResearchControls();
      syncComposerState();
      if (els.aiSearchOverlay.classList.contains("open") && !els.aiSearchOverlay.classList.contains("closing")) focusComposer();
    }
  }

  function isCurrent(requestGeneration) {
    return requestGeneration === generation;
  }

  function handleStreamStatus(requestGeneration, stage) {
    if (!isCurrent(requestGeneration)) return;
    const key = stage === "retrieving" ? "aiSearch.research.retrieving" : "aiSearch.organizingAnswer";
    setAiSearchMeta(t(key));
  }

  function appendStreamDelta(requestGeneration, model, value) {
    if (!isCurrent(requestGeneration) || !model?.element?.isConnected || !value) return;
    const stickToEnd = transcriptIsNearEnd();
    finishAiLoadingMotion(model.element);
    model.status = "streaming";
    if (!model.hasStreamedText) model.text = "";
    model.hasStreamedText = true;
    model.text += String(value);
    model.element.classList.remove("is-pending");
    model.element.classList.add("is-streaming");
    model.element.removeAttribute("aria-busy");
    if (streamRenderFrame) cancelAnimationFrame(streamRenderFrame);
    streamRenderFrame = requestAnimationFrame(() => {
      streamRenderFrame = 0;
      const body = model.element?.querySelector(".ai-conversation-body");
      if (!body || !model.element.isConnected) return;
      void renderAssistantBody(model, body).then(() => {
        if (stickToEnd) scrollTranscriptToEnd();
      });
    });
  }

  function stopCurrentRequest({ preservePartial = true } = {}) {
    if (!state.aiSearchBusy) return;
    if (activeStreamRequestId && options.streamClient?.cancel(activeStreamRequestId)) {
      setAiSearchMeta(t("aiSearch.stopping"));
      return;
    }
    generation += 1;
    state.aiSearchBusy = false;
    activeRequestScope = null;
    const pending = activePendingAnswer;
    activePendingAnswer = null;
    if (preservePartial && pending?.element?.isConnected) {
      const partialText = pending.hasStreamedText ? pending.text : "";
      void finishConversationResponse(pending, {
        text: partialText || t("aiSearch.stopped"),
        status: "stopped",
        usedAi: Boolean(partialText),
        researchScope: pending.researchScope,
        query: pending.query,
      });
    }
    syncResearchControls();
    syncComposerState();
  }

  function startSearchConversation(result, initialQuery) {
    const source = (result.links || []).find((link) => link?.url);
    const isArticle = result.mode === "article";
    if (isArticle && !source) return;
    session.kind = isArticle ? "article" : "question";
    session.context = isArticle
      ? {
        type: "article",
        url: source.url,
        title: source.title || source.url,
        summary: String(result.answer || "").trim(),
        turns: [],
      }
      : {
        type: "question",
        initialQuery,
        initialAnswer: String(result.answer || "").trim(),
        turns: [],
        research: result.mode === "research",
      };
    applyConversationCopy();
    setAiSearchMeta(isArticle
      ? t("aiSearch.articleReady", { title: session.context.title })
      : t("aiSearch.questionReady"));
  }

  function resetConversation({ animate = false, syncCopy = true } = {}) {
    const previousPanelRect = animate ? els.aiSearchPanel.getBoundingClientRect() : null;
    generation += 1;
    if (activeStreamRequestId) options.streamClient?.cancel(activeStreamRequestId);
    activeStreamRequestId = "";
    activePendingAnswer = null;
    editingMessageId = 0;
    editRestoreState = null;
    if (streamRenderFrame) cancelAnimationFrame(streamRenderFrame);
    streamRenderFrame = 0;
    state.aiSearchBusy = false;
    finishAiLoadingMotion();
    session = createAiSearchSession();
    draftResearchScope = emptyResearchScope();
    activeRequestScope = null;
    els.aiAnswer.hidden = true;
    els.aiAnswer.dataset.mode = "conversation";
    els.aiAnswer.classList.remove("is-resolving", "ai-loading-surface");
    els.aiAnswer.removeAttribute("aria-busy");
    els.aiAnswer.replaceChildren();
    els.aiSearchPanel.classList.remove("has-conversation");
    els.aiSearchInput.value = "";
    syncEditState();
    syncResearchControls();
    if (syncCopy) {
      options.syncSearchCopy({ forceDialog: true });
      session.meta = els.aiSearchMeta.textContent;
    }
    applyConversationCopy();
    syncComposerState();
    autoResizeComposer();
    animatePanelFrom(previousPanelRect);
  }

  function applyConversationCopy() {
    const context = session.context;
    const inputKey = context?.type === "article"
      ? "aiSearch.followupInput"
      : context?.type === "question" ? "aiSearch.questionFollowupInput" : null;
    if (inputKey) {
      els.aiSearchInput.maxLength = FOLLOWUP_MAX_CHARS;
      els.aiSearchInput.placeholder = t(inputKey);
      els.aiSearchInput.setAttribute("aria-label", t(inputKey));
    } else {
      els.aiSearchInput.maxLength = INITIAL_QUERY_MAX_CHARS;
    }
  }

  function appendConversationRequest(question, researchScope = emptyResearchScope(), requestOptions = {}) {
    const firstMessage = session.messages.length === 0;
    const previousPanelRect = firstMessage ? els.aiSearchPanel.getBoundingClientRect() : null;
    els.aiSearchPanel.classList.add("has-conversation");
    els.aiAnswer.querySelectorAll(".ai-message-action").forEach((button) => button.remove());
    els.aiAnswer.hidden = false;
    els.aiAnswer.dataset.mode = "conversation";
    if (requestOptions.replaceAnswer?.role === "assistant"
      && requestOptions.replaceAnswer.element?.isConnected) {
      const pending = requestOptions.replaceAnswer;
      finishAiLoadingMotion(pending.element);
      Object.assign(pending, {
        status: "pending",
        text: "",
        links: [],
        usedAi: false,
        cached: false,
        mode: "",
        researchScope: normalizeUiResearchScope(researchScope),
        evidence: [],
        coverage: null,
        sourcePermissionOrigins: [],
        settingsRequired: false,
        retrievalFailed: false,
        nextCursor: "",
        query: question,
        incomplete: false,
        finishReason: "",
        interrupted: false,
        retryable: false,
        hasStreamedText: false,
        sourcesExpanded: false,
      });
      pending.element.className = "ai-conversation-message is-assistant is-pending";
      pending.element.setAttribute("aria-busy", "true");
      pending.element.querySelector(".ai-research-actions")?.remove();
      pending.element.querySelector(".ai-message-footer")?.remove();
      const body = pending.element.querySelector(".ai-conversation-body");
      body.replaceChildren(createAiLoadingState({
        statusText: researchLoadingText(researchScope),
        noteText: researchLoadingText(researchScope),
        paragraphCount: 1,
        variant: "compact",
      }));
      startAiLoadingMotion(pending.element);
      scrollTranscriptToEnd();
      return pending;
    }
    const questionNumber = session.messages.filter((message) => message.role === "user").length + 1;
    const userMessage = requestOptions.hiddenUser ? null : appendConversationMessage({
      role: "user",
      status: "complete",
      text: question,
      questionNumber,
      researchScope,
    });
    const pending = appendConversationMessage({
      role: "assistant",
      status: "pending",
      text: "",
      researchScope,
      replyTo: userMessage?.id || 0,
      query: question,
    });
    if (userMessage) userMessage.replyId = pending.id;
    els.aiSearchInput.value = "";
    autoResizeComposer();
    animatePanelFrom(previousPanelRect);
    scrollTranscriptToEnd();
    return pending;
  }

  function appendConversationMessage(input) {
    const model = {
      id: session.nextMessageId++,
      role: input.role,
      status: input.status,
      text: String(input.text || ""),
      links: [],
      usedAi: false,
      cached: false,
      mode: "",
      questionNumber: input.questionNumber || 0,
      researchScope: normalizeUiResearchScope(input.researchScope),
      evidence: [],
      coverage: null,
      sourcePermissionOrigins: [],
      settingsRequired: false,
      retrievalFailed: false,
      nextCursor: "",
      query: String(input.query || ""),
      replyTo: input.replyTo || 0,
      replyId: 0,
      incomplete: false,
      finishReason: "",
      interrupted: false,
      retryable: false,
      hasStreamedText: false,
      sourcesExpanded: false,
      element: null,
    };
    session.messages.push(model);
    const message = document.createElement("section");
    const roleClass = model.role === "user" ? "is-user" : "is-assistant";
    message.className = `ai-conversation-message ${roleClass}${model.status === "pending" ? " is-pending" : ""} is-entering`;
    message.dataset.messageId = String(model.id);
    message.setAttribute("role", "group");
    message.setAttribute("aria-label", messageAriaLabel(model));
    if (model.status === "pending") message.setAttribute("aria-busy", "true");
    const bubble = document.createElement("div");
    bubble.className = "ai-conversation-bubble";
    const body = document.createElement("div");
    body.className = "ai-conversation-body";
    if (model.status === "pending") {
      body.append(createAiLoadingState({
        statusText: researchLoadingText(model.researchScope),
        noteText: researchLoadingText(model.researchScope),
        paragraphCount: 1,
        variant: "compact",
      }));
    } else {
      body.textContent = model.text;
    }
    bubble.append(body);
    if (model.role === "user") bubble.append(createEditMessageButton(model));
    message.append(bubble);
    message.addEventListener("animationend", () => message.classList.remove("is-entering"), { once: true });
    model.element = message;
    els.aiAnswer.append(message);
    if (model.status === "pending") startAiLoadingMotion(message);
    return model;
  }

  async function finishConversationResponse(model, response) {
    const message = model?.element;
    if (!message?.isConnected) return;
    finishAiLoadingMotion(message);
    const status = response.status || "complete";
    const rawContent = String(response.text || "").trim() || t("aiSearch.noAnswer");
    const responseMode = response.responseMode || "";
    const researchUi = responseMode === "research" ? await loadResearchView() : null;
    if (!message.isConnected) return;
    const stickToEnd = transcriptIsNearEnd();
    const content = responseMode === "article" || responseMode === "website"
      ? cleanAiAnswerMarkup(rawContent)
      : rawContent;
    Object.assign(model, {
      status,
      text: content,
      links: Array.isArray(response.links) ? response.links : [],
      usedAi: response.usedAi === true,
      cached: response.cached === true,
      mode: responseMode,
      evidence: researchUi?.normalizeResearchEvidence(response.evidence) || [],
      coverage: researchUi?.normalizeCoverage(response.coverage) || null,
      researchScope: normalizeUiResearchScope(response.researchScope || model.researchScope),
      sourcePermissionOrigins: researchUi?.safePermissionOrigins(response.sourcePermissionOrigins) || [],
      settingsRequired: response.settingsRequired === true,
      retrievalFailed: response.retrievalFailed === true,
      nextCursor: String(response.nextCursor || ""),
      query: String(response.query || ""),
      incomplete: response.incomplete === true,
      finishReason: String(response.finishReason || ""),
      interrupted: response.interrupted === true,
      retryable: response.retryable === true,
    });
    message.className = [
      "ai-conversation-message",
      "is-assistant",
      status === "pending" ? "is-pending" : "",
      status === "notice" ? "is-notice" : "",
      status === "error" ? "is-error" : "",
      status === "local" ? "is-local" : "",
      status === "stopped" ? "is-stopped" : "",
      model.interrupted ? "is-interrupted" : "",
      "is-resolving",
    ].filter(Boolean).join(" ");
    message.removeAttribute("aria-busy");
    const body = message.querySelector(".ai-conversation-body");
    body.replaceChildren();
    await renderAssistantBody(model, body, researchUi);
    if (!message.isConnected) return;
    if (responseMode !== "research") appendLinks(model.links, body);
    appendResponseActions(message, model);
    appendMessageMeta(message, model);
    message.addEventListener("animationend", () => message.classList.remove("is-resolving"), { once: true });
    if (stickToEnd) scrollTranscriptToEnd();
  }

  function appendMessageMeta(message, model) {
    const footer = ensureMessageFooter(message);
    const meta = document.createElement("div");
    meta.className = "ai-message-meta";
    const statusKey = model.status === "error"
      ? "aiSearch.message.error"
      : model.status === "stopped"
        ? "aiSearch.message.stopped"
        : model.interrupted
          ? "aiSearch.message.interrupted"
      : model.status === "notice"
        ? "aiSearch.message.notice"
        : model.mode === "research" && !model.evidence.length
          ? "aiSearch.message.noResults"
          : model.usedAi ? "aiSearch.message.ai" : "aiSearch.message.local";
    const origin = document.createElement("span");
    origin.className = "ai-message-origin";
    origin.textContent = t(statusKey);
    meta.append(origin);
    if (model.cached) {
      const cached = document.createElement("span");
      cached.textContent = t("aiSearch.message.cached");
      meta.append(cached);
    }
    if (model.incomplete) {
      const incomplete = document.createElement("span");
      incomplete.textContent = t("aiSearch.message.incomplete");
      meta.append(incomplete);
    }
    const tools = document.createElement("div");
    tools.className = "ai-message-tools";
    if (model.text && model.status !== "notice") {
      const copyTextValue = () => model.mode === "research"
        ? researchView.researchCopyText(model, t)
        : model.text;
      tools.append(createAiCopyButton(copyTextValue));
    }
    if (model.mode === "research" && model.evidence.length) {
      tools.append(researchView.createResearchSourcesButton({ model, t }));
    }
    appendGenerationAction(tools, model);
    footer.replaceChildren(meta, tools);
    const sources = message.querySelector(".ai-research-sources");
    if (sources) footer.after(sources);
  }

  function ensureMessageFooter(message) {
    const bubble = message.querySelector(".ai-conversation-bubble");
    let footer = bubble.querySelector(".ai-message-footer");
    if (!footer) {
      footer = document.createElement("div");
      footer.className = "ai-message-footer";
      bubble.append(footer);
    }
    return footer;
  }

  function messageAriaLabel(model) {
    return model.role === "user"
      ? t("aiSearch.userMessage", { number: model.questionNumber })
      : t("aiSearch.assistantMessage");
  }

  function createEditMessageButton(model) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-message-edit";
    button.setAttribute("aria-label", t("aiSearch.editMessage"));
    button.title = t("aiSearch.editMessage");
    button.append(createThemedIcon("edit-05", "ai-copy-icon"));
    button.addEventListener("click", () => void beginEdit(model));
    return button;
  }

  async function beginEdit(model) {
    if (state.aiSearchBusy || model?.role !== "user") return;
    const laterQuestions = session.messages.filter((item) => item.role === "user" && item.questionNumber > model.questionNumber).length;
    if (laterQuestions && typeof options.confirmAction === "function") {
      const confirmed = await options.confirmAction({
        kicker: t("aiSearch.editConfirmKicker"),
        title: t("aiSearch.editConfirmTitle"),
        body: t("aiSearch.editConfirmBody", { count: laterQuestions }),
        cancelLabel: t("aiSearch.editConfirmCancel"),
        confirmLabel: t("aiSearch.editConfirmAction"),
      });
      if (!confirmed) return;
    }
    editingMessageId = model.id;
    editRestoreState = {
      input: els.aiSearchInput.value,
      scope: currentResearchScope(),
    };
    els.aiSearchInput.value = model.text;
    draftResearchScope = normalizeUiResearchScope(model.researchScope);
    syncResearchControls();
    syncEditState();
    autoResizeComposer();
    syncComposerState();
    focusComposer();
  }

  function cancelEdit() {
    editingMessageId = 0;
    els.aiSearchInput.value = editRestoreState?.input || "";
    draftResearchScope = normalizeUiResearchScope(editRestoreState?.scope || draftResearchScope);
    editRestoreState = null;
    syncResearchControls();
    syncEditState();
    autoResizeComposer();
    syncComposerState();
    focusComposer();
  }

  function syncEditState() {
    if (!els.aiSearchEditState) return;
    els.aiSearchEditState.hidden = !editingMessageId;
    if (els.aiSearchEditText) els.aiSearchEditText.textContent = editingMessageId ? t("aiSearch.editing") : "";
    syncComposerToolsLayout();
  }

  function truncateConversationForEdit(messageId) {
    const index = session.messages.findIndex((message) => message.id === messageId && message.role === "user");
    if (index < 0) return;
    const questionNumber = session.messages[index].questionNumber;
    for (const message of session.messages.slice(index)) message.element?.remove();
    session.messages.splice(index);
    if (questionNumber <= 1) {
      session.kind = "empty";
      session.context = null;
    } else if (session.context) {
      session.context.turns = (session.context.turns || []).slice(0, Math.max(0, questionNumber - 2));
    }
    editingMessageId = 0;
    editRestoreState = null;
    syncEditState();
  }

  function updateReplacementContext(model, query, answer) {
    if (session.context?.type !== "question") return;
    const user = session.messages.find((message) => message.id === model.replyTo && message.role === "user");
    if (!user) return;
    const nextAnswer = String(answer || "").trim();
    if (user.questionNumber <= 1) {
      session.context.initialQuery = query;
      session.context.initialAnswer = nextAnswer;
    } else {
      const turn = session.context.turns?.[user.questionNumber - 2];
      if (turn) Object.assign(turn, { question: query, answer: nextAnswer });
    }
    applyConversationCopy();
  }

  function appendGenerationAction(target, model) {
    if (model.role !== "assistant") return;
    const isLatest = [...session.messages].reverse().find((item) => item.role === "assistant") === model;
    if (!isLatest) return;
    if (model.incomplete) {
      target.append(createMessageAction("send-up", "aiSearch.continueGeneration", () => {
        void run(t("aiSearch.continuePrompt"), {
          research: model.researchScope,
          cachePolicy: "bypass",
          hiddenUser: true,
        });
      }));
      return;
    }
    if (model.status === "error" || model.status === "stopped" || model.interrupted) {
      target.append(createMessageAction("refresh-cw-01", "aiSearch.retry", () => rerunAnswer(model)));
      return;
    }
    if (model.status === "complete" || model.status === "local") {
      target.append(createMessageAction("refresh-cw-01", "aiSearch.regenerate", () => rerunAnswer(model)));
    }
  }

  function createMessageAction(icon, key, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ai-message-action";
    button.setAttribute("aria-label", t(key));
    button.title = t(key);
    button.append(createThemedIcon(icon, "ai-copy-icon"));
    button.addEventListener("click", action);
    return button;
  }

  function rerunAnswer(model) {
    if ([...session.messages].reverse().find((item) => item.role === "assistant") !== model) return;
    if (state.aiSearchBusy) return;
    const user = session.messages.find((message) => message.id === model.replyTo);
    if (!user) {
      void run(model.query || t("aiSearch.continuePrompt"), {
        research: model.researchScope,
        cachePolicy: "bypass",
        hiddenUser: true,
      });
      return;
    }
    editingMessageId = user.id;
    els.aiSearchInput.value = user.text;
    draftResearchScope = normalizeUiResearchScope(model.researchScope || user.researchScope);
    syncResearchControls();
    void run(user.text, { research: draftResearchScope, cachePolicy: "bypass" });
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

  function startAiLoadingMotion(target) {
    finishAiLoadingMotion();
    aiLoadingMotion = {
      target,
      controller: createLoadingSurfaceController(target),
    };
  }

  function finishAiLoadingMotion(target = null) {
    if (!aiLoadingMotion || (target && aiLoadingMotion.target !== target)) return;
    const active = aiLoadingMotion;
    aiLoadingMotion = null;
    active.controller.finish();
  }

  function setAiSearchMeta(text) {
    session.meta = String(text || "");
    els.aiSearchMeta.textContent = session.meta;
  }

  async function renderAssistantBody(model, target, loadedResearchView = researchView) {
    if (model.mode === "article" || model.mode === "website") {
      renderStructuredAnswer(model.text, target);
      return;
    }
    if (model.mode === "research" && loadedResearchView) {
      loadedResearchView.renderResearchAnswer({ model, target, t, openExternal: options.openExternal });
      return;
    }
    const markdown = await loadMarkdownView();
    if (!target.isConnected) return;
    markdown.renderAiMarkdown(target, model.text, {
      openExternal: options.openExternal,
      labels: {
        copyCode: t("aiSearch.copyCode"),
        codeCopied: t("aiSearch.codeCopied"),
      },
    });
  }

  async function loadMarkdownView() {
    if (markdownView) return markdownView;
    if (!markdownViewPromise) {
      markdownViewPromise = import("./ai-markdown.mjs").then((module) => {
        markdownView = module;
        return module;
      });
    }
    return markdownViewPromise;
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
    const validLinks = (links || []).map((link) => ({ ...link, url: safeUiLink(link?.url) })).filter((link) => link.url).slice(0, 6);
    if (!validLinks.length) return;
    const block = document.createElement("div");
    block.className = "ai-link-list";
    const heading = document.createElement("strong");
    heading.className = "ai-link-list-title";
    heading.textContent = t("aiSearch.sources");
    block.append(heading);
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

  function appendResponseActions(message, model) {
    message.querySelector(".ai-generic-actions")?.remove();
    if (model.mode !== "research" && model.settingsRequired) {
      const actions = document.createElement("div");
      actions.className = "ai-research-actions ai-generic-actions";
      const setup = document.createElement("button");
      setup.type = "button";
      setup.className = "ai-research-action";
      setup.append(createThemedIcon("settings-01", "btn-icon"), document.createTextNode(t("aiSearch.setupAi")));
      setup.addEventListener("click", async () => {
        close();
        await options.openAiSettings?.();
      });
      actions.append(setup);
      const bubble = message.querySelector(".ai-conversation-bubble");
      bubble.insertBefore(actions, bubble.querySelector(".ai-message-footer"));
    }
    appendResearchActions(message, model);
  }

  function appendResearchActions(message, model) {
    if (!researchView) return;
    researchView.renderResearchActions({
      message,
      model,
      t,
      busy: () => state.aiSearchBusy,
      onSources: async () => {
        if (typeof options.requestSourcePermissions !== "function") return false;
        const granted = await options.requestSourcePermissions(model.sourcePermissionOrigins);
        if (granted) await run(model.query, {
          research: model.researchScope,
          replaceAnswer: model,
        });
        return granted;
      },
      onSettings: async () => {
        close();
        await options.openAiSettings?.();
        return true;
      },
      onContinue: async () => {
        await run(model.query, {
          research: model.researchScope,
          cursor: model.nextCursor,
          replaceAnswer: model,
        });
        return true;
      },
    });
  }

  function researchLoadingText(scope) {
    return t(`aiSearch.research.loading.${scope.webSearch
      ? (scope.bookmarkFolderId ? "bookmarkWeb" : "web")
      : (scope.bookmarkFolderId ? "bookmark" : "default")}`);
  }

  function handleComposerInput() {
    autoResizeComposer();
    syncComposerState();
  }

  function handleComposerKeydown(event) {
    if (!shouldSubmitAiComposer(event)) return;
    if (state.aiSearchBusy) return;
    event.preventDefault();
    void run(els.aiSearchInput.value);
  }

  function handleResearchFolderChange() {
    if (!aiResearchScopesAvailable(state.data?.ai)) return;
    const selected = researchFolders.find((folder) => folder.id === els.aiResearchFolder.value);
    draftResearchScope.bookmarkFolderId = selected?.id || "";
    draftResearchScope.bookmarkFolderTitle = selected?.title || "";
    draftResearchScope.cursor = "";
    syncResearchControls();
  }

  function handleWebSearchToggle() {
    if (!aiWebSearchSupported(state.data?.ai)) return;
    draftResearchScope.webSearch = !draftResearchScope.webSearch;
    draftResearchScope.cursor = "";
    syncResearchControls();
  }

  async function loadResearchFolders() {
    if (researchFoldersPromise || typeof apiGet !== "function") return researchFoldersPromise;
    researchFoldersPromise = Promise.resolve().then(async () => {
      const researchUi = await loadResearchView();
      if (!researchFolders.length) {
        researchFolderStatus = "loading";
        renderResearchFolderOptions();
      }
      const result = await researchUi.loadResearchFolderOptions(apiGet);
      researchFolders = result.folders;
      researchFolderStatus = result.status;
      if (draftResearchScope.bookmarkFolderId
        && !researchFolders.some((folder) => folder.id === draftResearchScope.bookmarkFolderId)) {
        draftResearchScope.bookmarkFolderId = "";
        draftResearchScope.bookmarkFolderTitle = "";
        draftResearchScope.cursor = "";
      }
      renderResearchFolderOptions();
      return researchFolders;
    }).finally(() => {
      researchFoldersPromise = null;
      syncComposerState();
    });
    return researchFoldersPromise;
  }

  async function loadResearchView() {
    if (researchView) return researchView;
    if (!researchViewPromise) {
      researchViewPromise = import("./ai-research-view.mjs").then((module) => {
        researchView = module;
        return module;
      });
    }
    return researchViewPromise;
  }

  function renderResearchFolderOptions() {
    researchView?.renderResearchFolderOptions({
      select: els.aiResearchFolder,
      folders: researchFolders,
      selectedId: draftResearchScope.bookmarkFolderId,
      status: researchFolderStatus,
      t,
    });
    syncResearchControls();
  }

  function currentResearchScope() {
    return availableResearchScope(draftResearchScope);
  }

  function availableResearchScope(value = {}, cursorOverride) {
    const scope = normalizeUiResearchScope(value, cursorOverride);
    if (!aiResearchScopesAvailable(state.data?.ai)) return emptyResearchScope();
    if (!aiWebSearchSupported(state.data?.ai)) scope.webSearch = false;
    return scope;
  }

  function syncResearchControls() {
    const researchScopesAvailable = aiResearchScopesAvailable(state.data?.ai);
    const webSearchSupported = aiWebSearchSupported(state.data?.ai);
    if (!researchScopesAvailable) {
      draftResearchScope = emptyResearchScope();
    } else if (!webSearchSupported && draftResearchScope.webSearch) {
      draftResearchScope.webSearch = false;
      draftResearchScope.cursor = "";
    }
    const scope = currentResearchScope();
    const scopeControls = els.aiResearchFolder.closest(".ai-search-scope-controls");
    const folderLabel = els.aiResearchFolder.labels?.[0] || null;
    if (scopeControls) {
      if (researchScopesAvailable) scopeControls.setAttribute("aria-label", t("aiSearch.research.scopeControls"));
      else scopeControls.removeAttribute("aria-label");
    }
    if (folderLabel) folderLabel.hidden = !researchScopesAvailable;
    els.aiResearchFolder.value = scope.bookmarkFolderId;
    els.aiResearchFolder.hidden = !researchScopesAvailable;
    els.aiWebSearchToggle.hidden = !webSearchSupported;
    els.aiWebSearchToggle.setAttribute("aria-pressed", String(scope.webSearch));
    els.aiWebSearchToggle.classList.toggle("is-active", scope.webSearch);
    els.aiSearchNextTurn.hidden = !(state.aiSearchBusy
      && activeRequestScope
      && (scope.bookmarkFolderId !== activeRequestScope.bookmarkFolderId
        || scope.webSearch !== activeRequestScope.webSearch));
    syncComposerToolsLayout();
  }

  function syncComposerToolsLayout() {
    const scopeControls = els.aiResearchFolder.closest(".ai-search-scope-controls");
    if (!scopeControls) return;
    const showScopeTools = aiResearchScopesAvailable(state.data?.ai);
    const showTransientTools = els.aiSearchNextTurn.hidden === false || els.aiSearchEditState?.hidden === false;
    const showTools = showScopeTools || showTransientTools;
    scopeControls.hidden = !showTools;
    els.aiSearchForm.classList.toggle("is-plain-composer", !showTools);
  }

  function trapFocus(event) {
    if (event.key !== "Tab" || !els.aiSearchOverlay.classList.contains("open")) return;
    const focusable = Array.from(els.aiSearchPanel.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(isVisiblyFocusable);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !els.aiSearchPanel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !els.aiSearchPanel.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function syncLocale() {
    options.syncSearchCopy({ forceDialog: true });
    renderResearchFolderOptions();
    syncResearchControls();
    applyConversationCopy();
    syncEditState();
    for (const model of session.messages) {
      if (!model.element?.isConnected) continue;
      model.element.setAttribute("aria-label", messageAriaLabel(model));
      if (model.role === "user") {
        const editButton = model.element.querySelector(".ai-message-edit");
        if (editButton) {
          editButton.setAttribute("aria-label", t("aiSearch.editMessage"));
          editButton.title = t("aiSearch.editMessage");
        }
        continue;
      }
      if (model.status === "pending") {
        const body = model.element.querySelector(".ai-conversation-body");
        body?.replaceChildren(createAiLoadingState({
          statusText: researchLoadingText(model.researchScope),
          noteText: researchLoadingText(model.researchScope),
          paragraphCount: 1,
          variant: "compact",
        }));
        continue;
      }
      if (model.mode === "research") {
        model.element.querySelector(".ai-research-sources")?.remove();
        const body = model.element.querySelector(".ai-conversation-body");
        body?.replaceChildren();
        if (body && researchView) researchView.renderResearchAnswer({ model, target: body, t, openExternal: options.openExternal });
        appendResponseActions(model.element, model);
      } else {
        const body = model.element.querySelector(".ai-conversation-body");
        if (body) void renderAssistantBody(model, body);
      }
      const sourceTitle = model.element.querySelector(".ai-link-list-title");
      if (sourceTitle) sourceTitle.textContent = t("aiSearch.sources");
      appendMessageMeta(model.element, model);
      const copyButton = model.element.querySelector(".ai-copy-button");
      if (copyButton) setCopyButtonState(copyButton, copyButton.dataset.state || "idle");
    }
    if (state.aiSearchBusy) {
      setAiSearchMeta(t(session.context ? "aiSearch.answeringFollowup" : "aiSearch.organizingAnswer"));
      return;
    }
    if (session.context?.type === "article") {
      setAiSearchMeta(t("aiSearch.articleReady", { title: session.context.title }));
      return;
    }
    if (session.context?.type === "question") {
      setAiSearchMeta(t("aiSearch.questionReady"));
      return;
    }
    const lastAnswer = [...session.messages].reverse().find((message) => message.role === "assistant");
    if (!lastAnswer) {
      session.meta = els.aiSearchMeta.textContent;
      return;
    }
    const labelKey = lastAnswer.status === "error"
      ? "error.requestFailed"
      : lastAnswer.status === "notice"
        ? "aiSearch.message.notice"
        : lastAnswer.status === "local"
          ? "aiSearch.message.local"
        : lastAnswer.mode === "article-followup"
          ? "aiSearch.followupAnswer"
          : lastAnswer.mode === "question-followup"
            ? "aiSearch.questionFollowupAnswer"
            : lastAnswer.mode === "article"
              ? "aiSearch.articleSummary"
              : lastAnswer.mode === "website" ? "aiSearch.websiteIntro" : "aiSearch.answer";
    const label = t(labelKey);
    setAiSearchMeta(lastAnswer.cached ? t("aiSearch.cached", { label }) : label);
  }

  function syncComposerState() {
    const stopping = state.aiSearchBusy;
    els.aiSearchSubmit.disabled = !stopping && !els.aiSearchInput.value.trim();
    const label = t(stopping ? "aiSearch.stop" : "aiSearch.send");
    els.aiSearchSubmit.setAttribute("aria-label", label);
    els.aiSearchSubmit.title = label;
    els.aiSearchSubmit.replaceChildren(createThemedIcon(stopping ? "stop-square" : "send-up", "btn-icon"));
    els.aiSearchSubmit.classList.toggle("is-stop", stopping);
  }

  function autoResizeComposer() {
    els.aiSearchInput.style.height = "auto";
    const nextHeight = Math.min(els.aiSearchInput.scrollHeight, COMPOSER_MAX_HEIGHT);
    els.aiSearchInput.style.height = `${Math.max(44, nextHeight)}px`;
    els.aiSearchInput.style.overflowY = els.aiSearchInput.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }

  function animatePanelFrom(previousRect) {
    if (!previousRect) return;
    const nextRect = els.aiSearchPanel.getBoundingClientRect();
    if (!nextRect.width || !nextRect.height) return;
    const translateX = previousRect.left + (previousRect.width / 2) - nextRect.left - (nextRect.width / 2);
    const translateY = previousRect.top + (previousRect.height / 2) - nextRect.top - (nextRect.height / 2);
    const scaleX = previousRect.width / nextRect.width;
    const scaleY = previousRect.height / nextRect.height;
    if (Math.abs(translateX) < 1 && Math.abs(translateY) < 1 && Math.abs(scaleX - 1) < .01 && Math.abs(scaleY - 1) < .01) return;
    panelAnimation?.cancel?.();
    panelAnimation = animateElement(els.aiSearchPanel, [
      { transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`, opacity: .94 },
      { transform: "translate3d(0, 0, 0)", opacity: 1 },
    ], { duration: "move", easing: "move" });
  }

  function isVisiblyFocusable(element) {
    return !element.hidden
      && element.getAttribute("aria-hidden") !== "true"
      && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== "hidden";
  }

  function scrollTranscriptToEnd() {
    els.aiAnswer.scrollTop = els.aiAnswer.scrollHeight;
  }

  function transcriptIsNearEnd() {
    return els.aiAnswer.scrollHeight - els.aiAnswer.scrollTop - els.aiAnswer.clientHeight < 96;
  }

  function focusComposer() {
    els.aiSearchInput.focus({ preventScroll: true });
  }

  function restoreFocus() {
    const target = lastFocusedElement?.isConnected ? lastFocusedElement : options.navButton;
    if (target?.isConnected && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }
    lastFocusedElement = null;
  }
}

export function createAiSearchSession() {
  return {
    kind: "empty",
    context: null,
    messages: [],
    nextMessageId: 1,
    meta: "",
  };
}

export function conversationPayload(context, maxTurns = FOLLOWUP_MAX_TURNS) {
  if (!context) return null;
  const turns = Array.isArray(context.turns) ? context.turns.slice(-maxTurns) : [];
  if (context.type === "article") {
    return {
      type: "article",
      url: context.url,
      summary: context.summary,
      turns,
    };
  }
  return {
    type: "question",
    initialQuery: context.initialQuery,
    initialAnswer: context.initialAnswer,
    turns,
  };
}

export function shouldSubmitAiComposer(event) {
  return event?.key === "Enter"
    && event.shiftKey !== true
    && event.isComposing !== true
    && event.keyCode !== 229;
}

export function aiWebSearchSupported(aiState) {
  return aiResearchScopesAvailable(aiState) && aiState?.webSearchSupported === true;
}

export function aiResearchScopesAvailable(aiState) {
  return aiState?.configured === true;
}

function limitText(value, maxChars) {
  return [...String(value || "")].slice(0, maxChars).join("");
}

function looksLikeUrl(value) {
  const text = String(value || "").trim();
  return /^https?:\/\//i.test(text) || /^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(text);
}

function safeUiLink(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return url.href;
    return "";
  } catch {
    return "";
  }
}

function emptyResearchScope() {
  return {bookmarkFolderId:"",bookmarkFolderTitle:"",webSearch:false,cursor:""};
}

function normalizeUiResearchScope(value = {}, cursorOverride) {
  const input = value && typeof value === "object" ? value : {};
  return {
    bookmarkFolderId: String(input.bookmarkFolderId || "").trim().slice(0, 256),
    bookmarkFolderTitle: String(input.bookmarkFolderTitle || "").trim().slice(0, 500),
    webSearch: input.webSearch === true,
    cursor: String(cursorOverride ?? input.cursor ?? "").trim().slice(0, 256),
  };
}
