const COMPARE_PATTERN = /(?:哪个|哪個|哪款|哪一|比较|比較|对比|對比|区别|區別|优缺点|優缺點|\bvs\.?\b|\bversus\b|\bcompare\b|\bcomparison\b|\bwhich\b.*\bbetter\b)/i;
const RECOMMEND_PATTERN = /(?:值得买|值得買|推荐|推薦|怎么选|怎麼選|选什么|選什麼|买什么|買什麼|\bbuy\b|\brecommend(?:ation)?\b|\bwhat should i (?:buy|choose)\b)/i;
const SUMMARY_PATTERN = /(?:总结|總結|概括|梳理|解读|解讀|摘要|\bsummari[sz]e\b|\brecap\b)/i;
const POPULAR_PATTERN = /(?:热门|熱門|热度|熱度|最火|流行|受欢迎|受歡迎|\bpopular\b|\btrending\b|\bmost viewed\b)/i;
const RECENT_PATTERN = /(?:最新|最近|近期|更新|发布|發佈|上线|上線|\blatest\b|\brecent(?:ly)?\b|\bnewest\b|\bupdates?\b)/i;
const GENERIC_PURCHASE_PATTERN = /^(?:帮我|幫我|请|請|能不能|可以)?\s*(?:看看|查查|推荐|推薦|告诉我|告訴我)?\s*(?:什么|什麼|哪些|哪种|哪種)?\s*(?:商品|产品|產品|东西|東西|好物|物品|products?|items?)\s*(?:值得买|值得買|可以买|可以買|推荐|推薦|好|吗|嗎|呢|\?|？)*$/i;
const REFERENCE_PATTERN = /^(?:那|这|這|它|他们|他們|这些|這些|哪个|哪個|哪一个|哪一個|前者|后者|後者|(?:which|that|those|it|they|what\s+(?:about|changed)|how\s+about|(?:was|is|are|were|does|do|did|can|could|will|would|has|have)\s+(?:it|that|they|those|these))\b)/i;

export function planResearchQuestion(query, options = {}) {
  const current = cleanText(query).slice(0, 8000);
  const previousQuestion = cleanText(options.previousQuestion).slice(0, 2000);
  const standaloneQuery = standaloneResearchQuery(current, previousQuestion);
  const timeIntent = options.timeIntent && typeof options.timeIntent === "object"
    ? options.timeIntent
    : { kind: RECENT_PATTERN.test(standaloneQuery) ? "recent" : "default", explicit: false };
  const intent = detectIntent(standaloneQuery, timeIntent);
  const clarificationNeeded = intent === "recommend" && GENERIC_PURCHASE_PATTERN.test(standaloneQuery);
  return {
    intent,
    standaloneQuery,
    freshnessIntent: String(timeIntent.kind || "default"),
    clarificationNeeded,
  };
}

export function assessResearchPassages(input = []) {
  const passages = (Array.isArray(input) ? input : []).filter((item) =>
    item?.evidenceLayer === "passage" && item.readLevel !== "bookmark"
    && item.url && cleanText(item.snippet).length >= 40);
  return {
    hasEvidence: passages.length > 0,
    passageCount: passages.length,
    documentCount: new Set(passages.map((item) => item.documentId || item.url)).size,
    datedPassages: passages.filter((item) => item.timeVerified !== false && verifiedDate(item.publishedAt)).length,
  };
}

export function researchPlanningCopy(plan, assessment, locale = "zh-CN") {
  const traditional = locale === "zh-Hant";
  const english = locale === "en";
  if (plan?.clarificationNeeded) {
    if (english) return "What kind of product are you looking for? Add the category, budget, intended use, and any must-have constraints before I research recommendations.";
    if (traditional) return "你想買哪一類商品？請先補充品類、預算、用途和必須滿足的條件，我再按這些標準定向研究。";
    return "你想买哪一类商品？请先补充品类、预算、用途和必须满足的条件，我再按这些标准定向研究。";
  }
  if (assessment?.hasEvidence) {
    if (plan?.freshnessIntent === "default" || assessment.datedPassages > 0) return "";
    if (english) return "Publication dates could not be verified. These passages provide background, but do not establish what is latest or within the requested period.";
    if (traditional) return "這些資料的發布日期尚未核實，可供了解背景，不能據此確認最新進展或是否屬於指定期間。";
    return "这些资料的发布日期尚未核实，可供了解背景，不能据此确认最新进展或是否属于指定期间。";
  }
  if (english) return "No question-relevant page passage was retrieved, so bookmark titles and URLs were not used as answer evidence.";
  if (traditional) return "本輪沒有讀到與問題相關的網頁正文片段，因此沒有把書籤標題或 URL 當作回答證據。";
  return "本轮没有读到与问题相关的网页正文片段，因此没有把书签标题或 URL 当作回答证据。";
}

function detectIntent(query, timeIntent) {
  if (POPULAR_PATTERN.test(query)) return "recent";
  if (SUMMARY_PATTERN.test(query)) return "summarize";
  if (COMPARE_PATTERN.test(query)) return "compare";
  if (RECOMMEND_PATTERN.test(query)) return "recommend";
  if (timeIntent?.kind !== "default" || RECENT_PATTERN.test(query)) return "recent";
  return "lookup";
}

function standaloneResearchQuery(query, previousQuestion) {
  if (!previousQuestion || query.length > 80 || !REFERENCE_PATTERN.test(query)) return query;
  return `${previousQuestion}；追问：${query}`;
}

function verifiedDate(value) {
  return Number.isFinite(Date.parse(String(value || "")));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
