export function mcpIsEnabled(settings) {
  return settings?.mcpEnabled === true;
}

export function isBotMode(settings) {
  return mcpIsEnabled(settings) && settings?.dashboardMode === "bot";
}

export function botOrganizesNews(settings) {
  return isBotMode(settings) && settings.botOrganizeNews === true;
}

export function botGeneratesBrief(settings) {
  return isBotMode(settings) && settings.botGenerateBrief !== false;
}

export function botAnswersQuestions(settings) {
  return isBotMode(settings) && settings.botAnswerQuestions !== false;
}

export function boardUsesBot(data) {
  return data?.bot?.mcpEnabled === true && data.bot.mode === "bot";
}

export function usesBotBrief(data) {
  return boardUsesBot(data) && data.bot.botGenerateBrief !== false;
}

export function usesBotChat(data) {
  return boardUsesBot(data) && data.bot.botAnswerQuestions !== false;
}
