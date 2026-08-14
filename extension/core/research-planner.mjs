const COMPARE_PATTERN = /(?:哪个|哪個|哪款|哪一|比较|比較|对比|對比|区别|區別|优缺点|優缺點|\bvs\.?\b|\bversus\b|\bcompare\b|\bcomparison\b|\bwhich\b.*\bbetter\b)/i;
const RECOMMEND_PATTERN = /(?:值得买|值得買|推荐|推薦|怎么选|怎麼選|选什么|選什麼|买什么|買什麼|\bbuy\b|\brecommend(?:ation)?\b|\bwhat should i (?:buy|choose)\b)/i;
const SUMMARY_PATTERN = /(?:总结|總結|概括|梳理|解读|解讀|摘要|\bsummari[sz]e\b|\brecap\b)/i;
const POPULAR_PATTERN = /(?:热门|熱門|热度|熱度|最火|流行|受欢迎|受歡迎|\bpopular\b|\btrending\b|\bmost viewed\b)/i;
const RECENT_PATTERN = /(?:最新|最近|近期|更新|发布|發佈|上线|上線|\blatest\b|\brecent(?:ly)?\b|\bnewest\b|\bupdates?\b)/i;
const GENERIC_PURCHASE_PATTERN = /^(?:帮我|幫我|请|請|能不能|可以)?\s*(?:看看|查查|推荐|推薦|告诉我|告訴我)?\s*(?:什么|什麼|哪些|哪种|哪種)?\s*(?:商品|产品|產品|东西|東西|好物|物品|products?|items?)\s*(?:值得买|值得買|可以买|可以買|推荐|推薦|好|吗|嗎|呢|\?|？)*$/i;
const REFERENCE_PATTERN = /^(?:那|这|這|它|他们|他們|这些|這些|哪个|哪個|哪一个|哪一個|前者|后者|後者|which|that|those|it|they)\b/i;
const PRICE_PATTERN = /(?:价格|價格|价位|價位|预算|預算|免费|免費|订阅|訂閱|收费|收費|\bprice\b|\bpricing\b|\bcost\b|\bfree\b|\bbudget\b)/i;
const FEATURE_PATTERN = /(?:功能|特性|能力|支持|限制|优点|優點|缺点|缺點|\bfeature\b|\bcapabilit\b|\bsupport\b|\blimit\b|\bpros?\b|\bcons?\b)/i;
const USE_CASE_PATTERN = /(?:用途|场景|場景|适合|適合|工作流|人群|用户|用戶|\buse case\b|\bworkflow\b|\bbest for\b|\baudience\b)/i;
const METRIC_PATTERN = /(?:阅读量|閱讀量|浏览量|瀏覽量|播放量|销量|銷量|评分|評分|星级|星級|评论|評論|点赞|點讚|转发|轉發|下载量|下載量|\bviews?\b|\bratings?\b|\breviews?\b|\bcomments?\b|\blikes?\b|\bsales?\b|\bdownloads?\b)/i;

export function planResearchQuestion(query, options = {}) {
  const current = cleanText(query).slice(0, 8000);
  const previousQuestion = cleanText(options.previousQuestion).slice(0, 2000);
  const standaloneQuery = standaloneResearchQuery(current, previousQuestion);
  const timeIntent = options.timeIntent && typeof options.timeIntent === "object"
    ? options.timeIntent
    : { kind: RECENT_PATTERN.test(standaloneQuery) ? "recent" : "default", explicit: false };
  const intent = detectIntent(standaloneQuery, timeIntent);
  const requiredEvidence = evidenceRequirements(intent, standaloneQuery);
  const clarificationNeeded = intent === "recommend" && GENERIC_PURCHASE_PATTERN.test(standaloneQuery);
  return {
    intent,
    standaloneQuery,
    subqueries: buildSubqueries(standaloneQuery, intent),
    requiredEvidence,
    freshnessIntent: String(timeIntent.kind || "default"),
    clarificationNeeded,
    clarificationReason: clarificationNeeded ? "missing-decision-context" : "",
    popularityClaimAllowed: false,
  };
}

export function assessResearchPassages(plan, input = []) {
  const passages = Array.isArray(input) ? input.filter((item) => cleanText(item?.snippet).length >= 40) : [];
  const documents = new Map();
  let datedPassages = 0;
  let metricPassages = 0;
  for (const passage of passages) {
    const documentId = cleanText(passage?.documentId) || cleanText(passage?.url);
    if (!documentId) continue;
    const fields = documents.get(documentId) || new Set();
    const text = `${cleanText(passage?.title)} ${cleanText(passage?.snippet)}`;
    if (PRICE_PATTERN.test(text)) fields.add("price");
    if (FEATURE_PATTERN.test(text)) fields.add("features");
    if (USE_CASE_PATTERN.test(text)) fields.add("use-case");
    documents.set(documentId, fields);
    if (verifiedDate(passage?.publishedAt)) datedPassages += 1;
    if (METRIC_PATTERN.test(text) && /\d/.test(text)) metricPassages += 1;
  }
  const sharedComparisonFields = ["price", "features", "use-case"].filter((field) =>
    [...documents.values()].filter((fields) => fields.has(field)).length >= 2);
  const checks = {
    "passage-text": passages.length > 0,
    "multiple-entities": documents.size >= 2,
    "comparison-fields": sharedComparisonFields.length > 0,
    "decision-context": plan?.clarificationNeeded !== true,
    "verified-date": datedPassages > 0,
    "audience-metrics": metricPassages > 0,
  };
  const missingRequirements = (Array.isArray(plan?.requiredEvidence) ? plan.requiredEvidence : [])
    .filter((requirement) => checks[requirement] !== true);
  return {
    canAnswer: passages.length > 0 && !missingRequirements.length,
    missingRequirements,
    passageCount: passages.length,
    documentCount: documents.size,
    datedPassages,
    metricPassages,
    sharedComparisonFields,
    popularityClaimAllowed: metricPassages > 0,
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
  const missing = new Set(assessment?.missingRequirements || []);
  if (missing.has("audience-metrics")) {
    if (english) return "The retrieved passages contain no verifiable views, ratings, reviews, comments, sales, or similar audience metrics, so I cannot call any item popular. I can only list items worth watching.";
    if (traditional) return "讀到的正文片段沒有可核對的瀏覽量、評分、評論、銷量等熱度指標，因此不能稱為「熱門」，只能整理為「值得關注」。";
    return "读到的正文片段没有可核对的浏览量、评分、评论、销量等热度指标，因此不能称为“热门”，只能整理为“值得关注”。";
  }
  if (missing.has("verified-date")) {
    if (english) return "The retrieved passages do not contain a verifiable publication date, so they cannot support a claim about the latest or recent updates.";
    if (traditional) return "讀到的正文片段沒有可核對的發布日期，因此不能據此回答「最新」或「最近更新」。";
    return "读到的正文片段没有可核对的发布日期，因此不能据此回答“最新”或“最近更新”。";
  }
  if (missing.has("multiple-entities") || missing.has("comparison-fields")) {
    if (english) return "The current passages do not cover at least two options using a shared field such as features, price, or use case, so they cannot support a reliable comparison or best-choice claim.";
    if (traditional) return "目前的正文片段沒有用功能、價格或適用場景等共同字段覆蓋至少兩個選項，因此還不能可靠比較或判定「最好」。";
    return "目前的正文片段没有用功能、价格或适用场景等共同字段覆盖至少两个选项，因此还不能可靠比较或判定“最好”。";
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

function evidenceRequirements(intent, query) {
  const required = ["passage-text"];
  if (intent === "compare") required.push("multiple-entities", "comparison-fields");
  if (intent === "recommend") required.push("decision-context", "multiple-entities", "comparison-fields");
  if (intent === "recent") required.push("verified-date");
  if (POPULAR_PATTERN.test(query)) required.push("audience-metrics");
  return [...new Set(required)];
}

function buildSubqueries(query, intent) {
  if (intent === "compare" || intent === "recommend") {
    return [`${query} 功能`, `${query} 价格`, `${query} 适用场景`].slice(0, 3);
  }
  if (intent === "recent") return [query, `${query} 发布日期`];
  return [query];
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
