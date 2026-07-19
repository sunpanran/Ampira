import { normalizeLocale } from "./locale.mjs";

const SIMPLIFIED_MARKERS = new Set(Array.from(
  "这为发后里时会国业东丝丢两严丧个临丽举么义乌乐乔习乡书买乱争于亏云亚产亩亲亿仅从仓仪们价众优伙伞伟传伤伦伪体余佣侠侣侥侧侦儿党兰关兴养兽内冈册写军农冲决况冻净凉减凑凤凭凯击凿划刘则刚创删别剂剑剧劝办务动励劳势勋匀区医华协单卖卢卫却厂厅历厉压厌厕县参双变叙叶号叹吓吕吗吨听启吴呐呕员呛呜咏咙咸响哑哒喷团园围图圆圣场坏块坚坛坝坞坟坠垄垒垦垫埘执扩扫扬扰抚抛抢护报担拟拢拣拥拦拧拨择挂挚挛挜挝挞挟挠挡挣挥损捡换据掳掷掸掺揽搁搂搅携摄摆摇撑撵撸擞敌数斋斓斗斩断无旧显晋晒晓暂术机杀杂权条来杨杰松板极构枢枣枪柜柠标栈栋栏树样栾桨梦检椭楼榄欢欧欲歼残殴毁毕气汉汤沟没沣沤沥沦沧沪泪泼泽洁浅浆浇测济浑浓涂涌涛涝淀涡涣涤润涧涨涩渊渍渎渐渔渗温湾湿溃溅滚滞满滤滥滨滩潇潜澜灭灯灵灾灿炉炖炜炝点炼烁烂烃焕焖焘爱爷牍牵犹狈狞独狭狮狱猎猪猫献玛环现玺电画畅疗疟疡疮疯痈痉痒痨痪瘫瘾皱监盖盘眍着睁瞒瞩矫矿码砖础硕确碍礼祷祸离秃秆种积称秽稳穷窃窍窑窜窝窥竞笃笋笔笺笼筛筹签简箩篮篱类粤粪粮纠红纤约级纪纬纯纱纲纳纵纷纸纹纺纽线练组绅细织终绍经绑绒结绕绘给络绝绞统绢绣继绩绪续绳维绵绷综绿缀缉缎缓编缘缚缝缠缩缴罢罗罚罴羁翘耸耻聂职联聪肃肠肤肾肿胀胁胆胜胶脉脏脑脓脚脱脸腊腻腾舆舰舱艺节芜苇范茎荐荆荡荣荫药莅莱莲莳获营萧萨葱蒋蓝蔼蕴薮虑虚虫虽虾蚀蚁蚂蚕蛊蛎蛮补衬衮袄袭装裤见观规觅视览觉触誉计订认讥讨让训议讯记讲讳讴讶许论讼设访证评诅识诈诉诊词译试诗诚话诞诡询该详诫语误诱说请诸诺读课谁调谈谋谎谐谓谜谢谨谱贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贴贵贷贸费贺贼贾赃资赋赌赎赏赔赖赚赛赞赠赵赶趋跃践踊踪车轨轩转轮软轰轻载较辅辆辉辈边辽达迁过迈运还进远违连迟适选逊递逻遗遥邓郑邻郁酝酱释里鉴钉针钓钙钛钞钟钢钥钦钧钨钩钱钳钻铁铃铅铎铜铝铭铲银铺链销锁锅锈锋锐错锡锣锤锦键锯锰锻镀镇镜长门闪闭问闯闲间闷闻阀阁阅队阳阴阵阶际陆陈险随隐难雏雾静顶顷项顺须顾顿颁颂预领颇频题颜额风飞饥饭饮饰饱饲饺饼饿馅馆驱驳驶驻驾骂骄验骑骗骚骤鱼鲁鲜鸟鸡鸣鸭鸿鹅麦黄齐齿龙"
));
const TRADITIONAL_MARKERS = new Set(Array.from(
  "這為發後裡時會國業東絲丟兩嚴喪個臨麗舉麼義烏樂喬習鄉書買亂爭於虧雲亞產畝親億僅從倉儀們價眾優夥傘偉傳傷倫偽體餘傭俠侶僥側偵兒黨蘭關興養獸內岡冊寫軍農衝決況凍淨涼減湊鳳憑凱擊鑿劃劉則剛創刪別劑劍劇勸辦務動勵勞勢勳勻區醫華協單賣盧衛卻廠廳歷厲壓厭廁縣參雙變敘葉號嘆嚇呂嗎噸聽啟吳吶嘔員嗆嗚詠嚨鹹響啞噠噴團園圍圖圓聖場壞塊堅壇壩塢墳墜壟壘墾墊塒執擴掃揚擾撫拋搶護報擔擬攏揀擁攔擰撥擇掛摯攣撾撻挾撓擋掙揮損撿換據擄擲撣摻攬擱摟攪攜攝擺搖撐攆擼擻敵數齋斕鬥斬斷無舊顯晉曬曉暫術機殺雜權條來楊傑鬆闆極構樞棗槍櫃檸標棧棟欄樹樣欒槳夢檢橢樓欖歡歐慾殲殘毆毀畢氣漢湯溝沒灃漚瀝淪滄滬淚潑澤潔淺漿澆測濟渾濃塗湧濤澇澱渦渙滌潤澗漲澀淵漬瀆漸漁滲溫灣濕潰濺滾滯滿濾濫濱灘瀟潛瀾滅燈靈災燦爐燉煒熗點煉爍爛烴煥燜燾愛爺牘牽猶狽獰獨狹獅獄獵豬貓獻瑪環現璽電畫暢療瘧瘍瘡瘋癰痙癢癆瘓癱癮皺監蓋盤瞘著睜瞞矚矯礦碼磚礎碩確礙禮禱禍離禿稈種積稱穢穩窮竊竅窯竄窩窺競篤筍筆箋籠篩籌簽簡籮籃籬類粵糞糧糾紅纖約級紀緯純紗綱納縱紛紙紋紡紐線練組紳細織終紹經綁絨結繞繪給絡絕絞統絹繡繼績緒續繩維綿繃綜綠綴緝緞緩編緣縛縫纏縮繳罷羅罰羆羈翹聳恥聶職聯聰肅腸膚腎腫脹脅膽勝膠脈臟腦膿腳脫臉臘膩騰輿艦艙藝節蕪葦範莖薦荊蕩榮蔭藥蒞萊蓮蒔獲營蕭薩蔥蔣藍藹蘊藪慮虛蟲雖蝦蝕蟻螞蠶蠱蠣蠻補襯袞襖襲裝褲見觀規覓視覽覺觸譽計訂認譏討讓訓議訊記講諱謳訝許論訟設訪證評詛識詐訴診詞譯試詩誠話誕詭詢該詳誡語誤誘說請諸諾讀課誰調談謀謊諧謂謎謝謹譜貝貞負貢財責賢敗賬貨質販貪貧貶購貯貫貳賤貼貴貸貿費賀賊賈贓資賦賭贖賞賠賴賺賽讚贈趙趕趨躍踐踴蹤車軌軒轉輪軟轟輕載較輔輛輝輩邊遼達遷過邁運還進遠違連遲適選遜遞邏遺遙鄧鄭鄰鬱醞醬釋裡鑑釘針釣鈣鈦鈔鐘鋼鑰欽鈞鎢鉤錢鉗鑽鐵鈴鉛鐸銅鋁銘鏟銀鋪鏈銷鎖鍋鏽鋒銳錯錫鑼錘錦鍵鋸錳鍛鍍鎮鏡長門閃閉問闖閒間悶聞閥閣閱隊陽陰陣階際陸陳險隨隱難雛霧靜頂頃項順須顧頓頒頌預領頗頻題顏額風飛飢飯飲飾飽飼餃餅餓餡館驅駁駛駐駕罵驕驗騎騙騷驟魚魯鮮鳥雞鳴鴨鴻鵝麥黃齊齒龍"
));

export function classifyContentLocale(value, declaredLocale = "") {
  const text = String(value || "");
  const fallback = normalizeDeclaredLocale(declaredLocale);
  const hanCount = (text.match(/\p{Script=Han}/gu) || []).length;
  const latinCount = (text.match(/\p{Script=Latin}/gu) || []).length;
  let simplifiedScore = 0;
  let traditionalScore = 0;
  for (const character of text) {
    if (SIMPLIFIED_MARKERS.has(character)) simplifiedScore += 1;
    if (TRADITIONAL_MARKERS.has(character)) traditionalScore += 1;
  }
  if (latinCount >= 10 && latinCount >= hanCount * 2) {
    return { locale: "en", confidence: "detected", simplifiedScore, traditionalScore, hanCount, latinCount };
  }
  if (hanCount >= 4) {
    if (simplifiedScore >= 2 && simplifiedScore >= traditionalScore * 2) {
      return { locale: "zh-CN", confidence: "detected", simplifiedScore, traditionalScore, hanCount, latinCount };
    }
    if (traditionalScore >= 2 && traditionalScore >= simplifiedScore * 2) {
      return { locale: "zh-Hant", confidence: "detected", simplifiedScore, traditionalScore, hanCount, latinCount };
    }
    if (fallback === "zh-CN" || fallback === "zh-Hant") {
      return { locale: fallback, confidence: "declared", simplifiedScore, traditionalScore, hanCount, latinCount };
    }
  }
  return { locale: fallback, confidence: fallback ? "declared" : "unknown", simplifiedScore, traditionalScore, hanCount, latinCount };
}

export function classifyFeedEntryLocale(title, summary, declaredLocale = "") {
  const declared = normalizeDeclaredLocale(declaredLocale);
  const titleLanguage = classifyContentLocale(title, declared);
  const summaryLanguage = classifyContentLocale(summary, declared);
  if (titleLanguage.confidence === "detected" && titleLanguage.locale !== declared) {
    return { ...titleLanguage, detectedField: "title" };
  }
  if (summaryLanguage.confidence === "detected" && summaryLanguage.locale !== declared) {
    return { ...summaryLanguage, detectedField: "summary" };
  }
  if (titleLanguage.confidence === "detected") return { ...titleLanguage, detectedField: "title" };
  if (summaryLanguage.confidence === "detected") return { ...summaryLanguage, detectedField: "summary" };
  return { ...classifyContentLocale(`${title}\n${summary}`, declared), detectedField: "combined" };
}

export function contentMatchesLocale(value, locale) {
  const target = normalizeLocale(locale);
  const classified = classifyContentLocale(value);
  if (classified.locale === target) return true;
  if ((target === "zh-CN" || target === "zh-Hant") && classified.hanCount >= 4) {
    const oppositeScore = target === "zh-CN" ? classified.traditionalScore : classified.simplifiedScore;
    const targetScore = target === "zh-CN" ? classified.simplifiedScore : classified.traditionalScore;
    return oppositeScore < 2 || targetScore >= oppositeScore * 2;
  }
  return false;
}

export function localizedSummaryMatchesLocale(title, summary, locale) {
  const target = normalizeLocale(locale);
  const parts = [String(title || "").trim(), ...(Array.isArray(summary) ? summary : [])]
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (parts.length < 2 || !contentMatchesLocale(parts.join("\n"), target)) return false;
  return parts.every((part) => {
    const classified = classifyContentLocale(part);
    if (classified.locale && classified.confidence === "detected" && classified.locale !== target) return false;
    if (target === "en" && classified.hanCount >= 4) return false;
    if (target !== "en" && classified.latinCount >= 10 && classified.latinCount >= classified.hanCount * 2) return false;
    return true;
  });
}

export function filterPresentableFeedItems(items = [], locale, options = {}) {
  const target = normalizeLocale(locale);
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    if (!isPresentableFeedItem(item, target, options)) return [];
    if (item?.externalDiscovery !== true || normalizeDeclaredLocale(item?.contentLocale) === target) return [item];
    const localizedSummary = Array.isArray(item.summary) ? item.summary.filter(Boolean) : [];
    return [{
      ...item,
      title: item.summaryTitle,
      excerpt: localizedSummary.join(" "),
      summary: localizedSummary,
      presentationLocale: target,
      localizedByAi: true,
    }];
  });
}

export function isPresentableFeedItem(item, locale, {
  aiConfigured = false,
  providerOrigin = "",
} = {}) {
  if (item?.externalDiscovery !== true) return true;
  const target = normalizeLocale(locale);
  const contentLocale = normalizeDeclaredLocale(item?.contentLocale);
  if (contentLocale === target) return true;
  if (!aiConfigured || item?.summaryStatus !== "ai" || item?.summaryLocale !== target) return false;
  if (!sameOrigin(item?.summaryProviderOrigin, providerOrigin)) return false;
  return localizedSummaryMatchesLocale(item?.summaryTitle, item?.summary, target);
}

function normalizeDeclaredLocale(locale) {
  const text = String(locale || "").trim();
  if (!text) return "";
  return normalizeLocale(text);
}

function sameOrigin(left, right) {
  try {
    return new URL(String(left || "")).origin === new URL(String(right || "")).origin;
  } catch {
    return false;
  }
}
