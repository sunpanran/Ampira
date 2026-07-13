import { cleanAiAnswerMarkup, extractDirectAnswer, parseAiAnswer } from "./ai-answer-format.mjs";

export function createAiSearchController(options) {
  const { state, els, t, apiPost } = options;
  let generation = 0;

  return { open, close, run };

  function open(query = "", shouldRun = false) {
    generation += 1;
    state.aiSearchBusy = false;
    els.aiSearchSubmit.disabled = false;
    els.aiSearchOverlay.classList.add("open");
    document.querySelectorAll(".nav-btn").forEach((item) => item.classList.toggle("active", item.id === "aiSearchNav"));
    resetAnswer();
    els.aiSearchInput.value = query || "";
    if (shouldRun) options.clearTopSearchFilter();
    els.aiSearchInput.focus();
    if (shouldRun && els.aiSearchInput.value.trim()) run(els.aiSearchInput.value);
  }

  function close() {
    generation += 1;
    state.aiSearchBusy = false;
    els.aiSearchSubmit.disabled = false;
    els.aiSearchOverlay.classList.remove("open");
    if (state.aiSearchTypeTimer) clearInterval(state.aiSearchTypeTimer);
    state.aiSearchTypeTimer = null;
    options.syncNavToCurrentSection();
  }

  async function run(rawQuery) {
    const query = String(rawQuery || "").trim();
    if (!query || state.aiSearchBusy) return;
    const requestGeneration = ++generation;
    state.aiSearchBusy = true;
    els.aiSearchSubmit.disabled = true;
    els.aiSearchMeta.textContent = t(looksLikeUrl(query) ? "aiSearch.readingPage" : "aiSearch.organizingAnswer");
    els.aiAnswer.hidden = false;
    els.aiAnswer.textContent = t("aiSearch.analyzing");
    try {
      if (looksLikeUrl(query) && typeof options.requestWebsitePermission === "function") {
        els.aiSearchMeta.textContent = t("aiSearch.requestingWebsitePermission");
        const granted = await options.requestWebsitePermission(query);
        if (!isCurrent(requestGeneration)) return;
        if (!granted) {
          els.aiSearchMeta.textContent = t("aiSearch.permissionRequired");
          streamAnswer(t("aiSearch.permissionDeclined"), [], "notice");
          return;
        }
        els.aiSearchMeta.textContent = t("aiSearch.readingPage");
      }
      const result = await apiPost("/api/ai/search", { query });
      if (!isCurrent(requestGeneration)) return;
      if (!result.ok) throw new Error(options.localizedResponseMessage(result, "error.requestFailed"));
      const label = result.type === "url"
        ? t(result.mode === "article" ? "aiSearch.articleSummary" : "aiSearch.websiteIntro")
        : t("aiSearch.answer");
      els.aiSearchMeta.textContent = result.cached ? t("aiSearch.cached", { label }) : label;
      const answer = result.error ? t("aiSearch.localFallback", { answer: result.answer, error: result.error }) : result.answer;
      streamAnswer(answer, result.links || [], result.usedAi ? result.mode : "fallback");
    } catch (error) {
      if (!isCurrent(requestGeneration)) return;
      els.aiSearchMeta.textContent = t("error.requestFailed");
      streamAnswer(options.localizedErrorMessage(error), [], "error");
    } finally {
      if (requestGeneration !== generation) return;
      state.aiSearchBusy = false;
      els.aiSearchSubmit.disabled = false;
    }
  }

  function isCurrent(requestGeneration) {
    return requestGeneration === generation && els.aiSearchOverlay.classList.contains("open");
  }

  function resetAnswer() {
    if (state.aiSearchTypeTimer) clearInterval(state.aiSearchTypeTimer);
    state.aiSearchTypeTimer = null;
    els.aiAnswer.hidden = true;
    els.aiAnswer.replaceChildren();
  }

  function streamAnswer(text, links, mode = "answer") {
    if (state.aiSearchTypeTimer) clearInterval(state.aiSearchTypeTimer);
    els.aiAnswer.replaceChildren();
    els.aiAnswer.dataset.mode = mode;
    const textNode = document.createTextNode("");
    els.aiAnswer.append(textNode);
    const rawContent = String(text || "").trim() || t("aiSearch.noAnswer");
    const content = mode === "dashboard"
      ? extractDirectAnswer(rawContent)
      : cleanAiAnswerMarkup(rawContent);
    let index = 0;
    state.aiSearchTypeTimer = setInterval(() => {
      index = Math.min(content.length, index + Math.max(1, Math.ceil(content.length / 90)));
      textNode.textContent = content.slice(0, index);
      els.aiAnswer.scrollTop = els.aiAnswer.scrollHeight;
      if (index < content.length) return;
      clearInterval(state.aiSearchTypeTimer);
      state.aiSearchTypeTimer = null;
      if (mode !== "dashboard") renderStructuredAnswer(content);
      appendLinks(links);
      els.aiAnswer.scrollTop = 0;
    }, 22);
  }

  function renderStructuredAnswer(text) {
    const parsed = parseAiAnswer(text);
    els.aiAnswer.replaceChildren();
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
    els.aiAnswer.append(report);
  }

  function appendLinks(links) {
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
    els.aiAnswer.append(document.createTextNode("\n\n"), block);
  }
}

function looksLikeUrl(value) {
  const text = String(value || "").trim();
  return /^https?:\/\//i.test(text) || /^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(text);
}
