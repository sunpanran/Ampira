import { spanText } from "./dom.mjs";
import { createAiTaskStatus } from "./ui-primitives.mjs";
import { aiTaskLabelKey, briefTaskPhase, isAiTaskBusy } from "./ai-task-state.mjs";
import { usesBotBrief } from "../../extension/core/bot-mode.mjs";
import { botBriefStatusKey, botBriefEmptyStateKeys } from "./bot-runner-status.mjs";
import { renderAiMarkdown } from "./ai-markdown.mjs";

export function createDigestCardView({ state, t, createEmptyState, createIcon, localizedErrorMessage, openAiSettings,
  openExternal, refreshDailyDigest, isRevealPending }) {
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "action-toggle digest-refresh";
  refreshButton.append(createIcon("refresh-cw-01", "action-toggle-icon"));
  refreshButton.addEventListener("click", (event) => {
    if (refreshButton.getAttribute("aria-disabled") === "true") return;
    refreshDailyDigest(event);
  });
  return { render };
  function dailyDigestStatusLabel(digest, ai) {
    const phase = briefTaskPhase(state);
    if (phase) return t(aiTaskLabelKey(phase));
    if (usesBotBrief(state.data)) return t(botBriefStatusKey(state.data.bot, digest));
    if (ai?.enabled !== true) return t("digest.status.noService");
    if (!digest?.generatedAt) return t("digest.status.waiting");
    if (digest.status === "ai") return t("digest.status.ai");
    if (digest.status === "quota-or-empty") return t("digest.status.quota");
    if (digest.status === "no-api-key") return t("digest.status.noService");
    if (digest.status === "fallback") return t("digest.status.failed");
    if (digest.status === "pending") return t("digest.status.waiting");
    return t("digest.status.notGenerated");
  }

  function createDailyDigestEmptyState(digest) {
    if (usesBotBrief(state.data)) {
      const copy = botBriefEmptyStateKeys(state.data.bot, digest);
      return createEmptyState({ title: t(copy.title), body: t(copy.body), variant: "compact",
        actionLabel: copy.action ? t(copy.action) : "", onAction: refreshDailyDigest });
    }
    if (state.data?.ai?.enabled !== true) {
      return createEmptyState({
        title: t("digest.noService.title"),
        body: t("digest.noService.body"),
        variant: "compact",
        actionLabel: t("action.configureAi"),
        onAction: openAiSettings,
      });
    }
    if (digest?.status === "fallback") {
      return createEmptyState({
        title: t("digest.failed.title"),
        body: digest.errorKey
          ? localizedErrorMessage({ messageKey: digest.errorKey, messageParams: digest.errorParams || {} })
          : t("digest.failed.body"),
        variant: "compact",
        actionLabel: t("action.reorganize"),
        onAction: refreshDailyDigest,
      });
    }
    if (digest?.status === "quota-or-empty") {
      return createEmptyState({
        title: t("digest.retry.title"),
        body: t("digest.retry.body"),
        variant: "compact",
        actionLabel: t("action.reorganize"),
        onAction: refreshDailyDigest,
      });
    }
    return createEmptyState({
      title: t("digest.empty.title"),
      body: t("digest.empty.body"),
      variant: "compact",
      actionLabel: t("action.generateDigest"),
      onAction: refreshDailyDigest,
    });
  }

  function hasGeneratedDailyDigestOverview(digest, lines) {
    if (digest?.status !== "ai") return digest?.status === "bot" && lines.length > 0;
    return lines.length > 0 || (Array.isArray(digest.items) && digest.items.some(Boolean));
  }

  function render() {
    const digest = state.data?.dailyDigest;
    const phase = briefTaskPhase(state);
    const busy = isAiTaskBusy(phase);
    const statusLabel = dailyDigestStatusLabel(digest, state.data?.ai);
    const available = usesBotBrief(state.data) ? Boolean(state.data.bot.connection) : state.data?.ai?.enabled === true;
    refreshButton.setAttribute("aria-disabled", String(busy || !available));
    refreshButton.title = busy || !available ? statusLabel : t("action.reorganize");
    refreshButton.setAttribute("aria-label", refreshButton.title);
    const meta = spanText(statusLabel, "efficiency-meta");
    if (phase) meta.replaceChildren(createAiTaskStatus(phase, statusLabel));
    const overview = document.createElement("div");
    overview.className = "ai-digest-overview";
    if (digest?.status === "bot") overview.classList.add("is-bot-content");
    overview.tabIndex = 0;
    overview.setAttribute("role", "region");
    overview.setAttribute("aria-label", t("digest.cardTitle"));
    const overviewLines = Array.isArray(digest?.overview)
      ? digest.overview.map((line) => String(line || "").trim()).filter(Boolean)
      : [];
    if (hasGeneratedDailyDigestOverview(digest, overviewLines)) {
      overview.replaceChildren(...dailyDigestBriefNodes(digest));
    } else if (busy && !usesBotBrief(state.data)) {
      overview.replaceChildren(createEmptyState({ body: t("digest.refreshing.body"), variant: "compact" }));
    } else {
      overview.replaceChildren(createDailyDigestEmptyState(digest));
    }
    return { meta, actions: [refreshButton], content: overview, busy, bot: digest?.status === "bot", resolving: isRevealPending() && !busy };
  }

  function dailyDigestBriefNodes(digest) {
    const nodes = [];
    const overviewLines = Array.isArray(digest?.overview)
      ? digest.overview.map((line) => String(line || "").trim()).filter(Boolean).slice(0, digest.status === "bot" ? undefined : 3)
      : [];
    if (overviewLines.length) {
      const summary = document.createElement("div");
      summary.className = "ai-digest-summary";
      if (digest.status === "bot") {
        summary.classList.add("ai-digest-markdown");
        renderAiMarkdown(summary, overviewLines.join("\n\n"), { openExternal,
          labels: { copyCode: t("aiSearch.copyCode"), codeCopied: t("aiSearch.codeCopied") },
        });
      } else {
        summary.append(...dailyDigestParagraphs(overviewLines).map((line) => {
          const paragraph = document.createElement("span");
          paragraph.className = "ai-digest-paragraph";
          paragraph.textContent = line;
          return paragraph;
        }));
      }
      nodes.push(summary);
    }
    return nodes;
  }

  function dailyDigestParagraphs(lines) {
    if (lines.length !== 1) return lines;
    const segments = lines[0].match(/[^；;。！？]+(?:[；;。！？]+|$)/gu)
      ?.map((segment) => segment.trim())
      .filter(Boolean) || [];
    if (segments.length < 2) return lines;
    const groupCount = Math.min(4, segments.length);
    const groups = Array.from({ length: groupCount }, () => []);
    segments.forEach((segment, index) => {
      groups[Math.min(groupCount - 1, Math.floor(index * groupCount / segments.length))].push(segment);
    });
    return groups.map((group) => group.join(""));
  }

}
