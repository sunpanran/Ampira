# Ampira 文案规范

## 适用范围

这份规范约束 Ampira 的消费者文案，包括：

- Chrome Web Store 与 Microsoft Edge Add-ons 商店页面
- Manifest 简介
- 扩展内关于页、首次设置和 AI 设置入口
- GitHub Pages 官网
- README 首屏与 GitHub 仓库简介

普通按钮、状态提示和错误信息仍以三语本地化资源为准。隐私实践、权限说明和审核材料可以写得更细，但不能与本规范中的产品事实冲突。

## 核心定位

Ampira 先解决两个具体问题：

- 收藏夹里存了不少以后想看的网页，真正再打开的并不多。
- 关注的网站散在不同地方，很难每天逐个查看。

产品主线固定为：

`书签与关注网站 → 每日新内容 → AI 整理与解读 → 持续跟踪`

书签是主要资讯来源。RSS、Atom、JSON Feed 和公共来源（Ampira）是补充，不要把产品写成普通 RSS 阅读器，也不要把待办、天气或主题写成核心卖点。

## 信息层级

不同页面可以增减细节，但顺序不要颠倒。

1. 广告语说明 Ampira 做什么。
2. 痛点说明为什么需要它。
3. 解决方式说明书签资讯、排序和 AI 如何配合。
4. 专业场景说明当前产品可以承担长期跟踪任务。
5. 功能与权限补充使用边界。
6. 安装入口给出明确动作。

## 锁定文案

锁定文案需要在对应页面保持一致。修改其中任何一句时，必须同步三种语言、静态 HTML 回退和一致性测试。

### 扩展名称

| 语言 | 名称 |
|---|---|
| 简体中文 | Ampira 新标签页 |
| 繁體中文 | Ampira 新分頁 |
| English | Ampira New Tab |

### 品牌广告语

| 语言 | 文案 |
|---|---|
| 简体中文 | 从书签里的网站获取新资讯，再用 AI 整理和解读。 |
| 繁體中文 | 從書籤裡的網站取得新資訊，再用 AI 整理與解讀。 |
| English | Get news from bookmarked sites, then let AI organize and explain it. |

使用位置：

- 扩展设置“关于”
- 首次设置第一步正文
- 浏览器“扩展程序”管理页的 Manifest 简介
- 官网 H1
- README 三语首屏

### Manifest 与浏览器“扩展程序”管理页

Manifest 的 `appDescription` 使用品牌广告语。Chrome 或 Edge 的“扩展程序”管理页会显示这段文字，因此不要在这里使用商店长摘要。

三语文案与上方品牌广告语完全一致，来源文件为 `_locales/*/messages.json`。

### 商店短描述与官网 Meta 摘要

| 语言 | 字符数 | 文案 |
|---|---:|---|
| 简体中文 | 70 | 从书签里的网站获取新资讯，按时间或重要性查看。AI 功能可选，可生成摘要和今日简报，也能结合正文继续解读。数据默认保存在本地，不用注册账号。 |
| 繁體中文 | 70 | 從書籤裡的網站取得新資訊，依時間或重要性查看。AI 功能可選，可產生摘要與今日簡報，也能讀取內文並繼續解讀。資料預設留在本機，不用註冊帳號。 |
| English | 131 | News from your bookmarks, sorted by time or importance. Optional AI summarizes and answers questions. Data stays local. No sign-up. |

摘要必须满足以下条件：

- Chrome 商店、Edge 商店和官网 Meta 描述使用完全相同的对应语言文本。
- 每种语言不超过 Chrome Web Store 的 132 字符限制。
- 商店短描述保留功能与隐私信息，不用广告语代替。

### 商店开场

#### 简体中文

> 收藏夹里有不少以后想看的网页，真正再打开的并不多。关注的网站也散在不同地方，很难每天逐个查看。Ampira 读取你选择的书签，把保存的网页和这些网站的新内容放进新标签页，并按时间或重要性整理。需要时，AI 会生成卡片摘要和今日简报，也能读取正文并继续回答问题。

#### 繁體中文

> 收藏夾裡存了不少打算以後再看的網頁，真正回頭開啟的卻不多。關注的網站也散在不同地方，很難每天逐一查看。Ampira 讀取你選擇的書籤，把保存的網頁和這些網站的新內容放進新分頁，再依時間或重要性整理。需要時，AI 會產生卡片摘要與今日簡報，也能讀取內文並繼續回答問題。

#### English

> Bookmarks are easy to save and easy to forget. The sites you follow are scattered across the web, and checking each one every day takes time. Ampira reads the bookmarks you choose, brings saved pages and new posts from those sites into one New Tab page, and sorts them by time or importance. Optional AI creates card summaries and a daily brief. It can also read an article and answer follow-up questions.

### 专业使用场景

这段话只描述已经可用的功能。它用来说明产品上限，不承诺未来版本。

#### 简体中文

> 如果你需要长期跟踪一个行业或研究主题，可以把常看的来源放进同一个书签文件夹。Ampira 会集中更新，按重要性排序，再用 AI 整理成今日简报。遇到值得继续看的内容，也可以打开正文追问。

#### 繁體中文

> 如果你需要長期追蹤一個產業或研究主題，可以把常看的來源放進同一個書籤資料夾。Ampira 會集中更新，依重要性排序，再用 AI 整理成今日簡報。遇到值得繼續看的內容，也可以開啟內文追問。

#### English

> If you track an industry or research topic over time, put the sources you follow in one bookmark folder. Ampira keeps their updates together, sorts them by importance, and uses AI to create a daily brief. Open any article to ask follow-up questions.

### AI 设置与首次设置

| 位置 | 简体中文 | 繁體中文 | English |
|---|---|---|---|
| 设置标题 | AI 整理与解读 | AI 整理與解讀 | AI summaries & analysis |
| 首次设置第四步 | 配置 AI，整理和解读内容 | 設定 AI，整理與解讀內容 | Set up AI to organize and analyze content |

保留现有本地化键，不要为了改标题另建一套近义词。

### 商店安装入口

商店地址：

`https://chromewebstore.google.com/detail/oifmohbnghkaadoeghlemkllegajdajc?utm_source=item-share-cb`

| 语言 | 按钮或链接文字 |
|---|---|
| 简体中文 | 从 Chrome 应用商店安装 |
| 繁體中文 | 從 Chrome 線上應用程式商店安裝 |
| English | Install from the Chrome Web Store |

官网按钮在新标签页打开，并带 `rel="noopener noreferrer"`。README 使用较短的链接名称：

- 简体中文：Chrome 应用商店
- 繁體中文：Chrome 線上應用程式商店
- English：Chrome Web Store

GitHub About 的 Website 字段继续指向官网，不用商店链接替换。

### GitHub About

仓库简介使用直接的技术描述：

> A local-first new tab for news from bookmarked sites, with optional AI summaries and content analysis.

在线修改 GitHub About 前需要单独确认。

## 功能顺序

商店和 README 的功能说明按以下顺序排列：

1. 书签资讯
2. 时间与重要性排序
3. AI 整理与解读
4. 每日灵感
5. 阅读流程
6. 辅助工具

每项说明的边界如下。

### 书签资讯

- 书签是主要来源。
- RSS、Atom、JSON Feed 和公共来源（Ampira）只能写成补充来源。
- 必须说明书签只读。Ampira 不会创建、修改或删除原书签。

### 时间与重要性排序

- 资讯可以按时间或重要性查看。
- 同一事件的相关内容可以放在一起。
- 日期浏览和归档用于回看旧内容。

不要写“智能排序”或“精准推荐”。现有排序依据需要具体说明。

### AI 整理与解读

AI 是可选的核心能力，当前覆盖：

- 卡片摘要与今日简报
- 结合正文回答问题
- 针对同一内容继续提问

必须说明用户配置自己的 API Key。没有配置 AI 时，资讯获取、排序、稍后读和阅读器继续可用。

不要暗示 AI 会替用户完成研究，也不要承诺准确率、客观性或自动决策能力。

### 每日灵感

每日灵感会从灵感预设（Ampira）或用户指定的书签文件夹换一组卡片。用户也可以手动“换一换”。

不要把它写成算法推荐、个性画像或无限内容流。

### 阅读流程

阅读流程包括：

- 从工具栏、资讯卡片或书签卡片加入稍后读
- 在站内阅读器查看提取后的正文
- 用搜索和归档找回已收录内容

涉及安全边界时，说明站内阅读不会运行远程脚本或嵌入播放器。

### 辅助工具

快捷书签、待办、天气、顶部浏览器搜索和深浅色主题只用一句话带过。它们帮助日常使用，但不是产品定位。

## 专业场景边界

消费者文案可以写：

- 长期跟踪一个行业或研究主题
- 把常看的来源放进同一个书签文件夹
- 集中更新并按重要性排序
- 用 AI 生成今日简报，打开正文继续追问

消费者文案暂时不要写：

- Pro、付费、价格或订阅
- 路线图、上线时间或“即将推出”
- 专题雷达、简报工作室或研究项目
- 尚未上线的协作、自动报告或研究管理能力

专业场景是一段普通正文，不加“专业版”“研究工作台”一类营销标题，也不制作付费卡片。

## 事实与权限

以下事实不能因为润色而省略或改写成更强的承诺。

| 事实 | 可以写 | 不要写 |
|---|---|---|
| 新标签页 | 安装后 Ampira 会替换浏览器的新标签页 | Ampira 可以在设置中关闭新标签页覆盖 |
| 书签 | 读取用户选择的书签；书签只读 | Ampira 会整理或修改浏览器书签 |
| 本地保存 | 数据默认保存在本地或浏览器中 | 所有数据永远不会离开设备 |
| 同步 | 稍后读、待办和天气城市可以分别开启浏览器同步 | 所有内容会自动同步 |
| API Key | 只保存在当前浏览器配置中，不进入账号同步 | 密钥由 Ampira 托管或代管 |
| AI 请求 | 使用功能时，数据和密钥直接发送给用户选择的服务商 | AI 在本地运行 |
| 来源权限 | 从用户手势申请精确来源，并可在设置中撤销 | Ampira 可以访问所有网站 |
| `activeTab` | 点击工具栏图标时读取当前页标题和网址，用于稍后读 | 后台监控标签页或浏览历史 |

审核材料可以列出网站数量、域名数量、封面数量和权限清单。消费者文案不罗列这些审核数字。

## 三语术语

| 概念 | 简体中文 | 繁體中文 | English |
|---|---|---|---|
| 浏览器页面 | 新标签页 | 新分頁 | New Tab page |
| 主要来源 | 书签 | 書籤 | bookmarks |
| 内容集合 | 资讯 | 資訊 | news |
| 排序方式 | 时间 / 重要性 | 時間 / 重要性 | time / importance |
| AI 短内容 | 卡片摘要 | 卡片摘要 | card summary |
| AI 日报 | 今日简报 | 今日簡報 | daily brief |
| 文章内容 | 正文 | 內文 | article text |
| 稍后处理 | 稍后读 | 稍後讀 | Read later |
| 阅读页面 | 站内阅读 | 站內閱讀 | in-app reading |
| 灵感功能 | 每日灵感 | 每日靈感 | Inspiration |
| 补充资讯 | 公共来源（Ampira） | 公共來源（Ampira） | Public sources (Ampira) |
| 内容留存 | 归档 | 封存 | archive |

术语使用规则：

- 简体中文用“资讯”描述产品内容流，用“新闻”会把范围缩得过窄。
- 繁體中文按当地习惯使用“資料夾”“本機”“網域”和“擷取”。
- English 的 `Read later` 是功能名时首字母大写；普通动词不大写。
- `AI`、`API Key`、`RSS`、`Atom` 和 `JSON Feed` 保持现有写法。
- 不在同一页面轮换“整理、归纳、聚合、汇总”等近义词来避免重复。一个概念固定一个名称。

## 语气与句式

### 基本语气

- 从用户正在做的事情出发：保存网页、关注网站、查看更新、追问正文。
- 用具体功能支撑判断，不用抽象形容词。
- 一句话只承担一个主要任务。事实较多时拆句。
- 直接承认条件和边界，例如“AI 功能可选”“需要配置自己的 API Key”。

### 避免的写法

不用这些泛化词：

- 重新定义
- 一站式
- 强大
- 高效
- 无缝
- 智能赋能
- 全新体验
- 提升生产力

也不要使用：

- 表情符号
- 连续三项口号
- “不仅……而且……”式否定排比
- 频繁破折号
- 模糊的“智能推荐”“精准洞察”
- changelog 式功能堆积

### 改写示例

不推荐：

> 一站式聚合多源信息，用强大的 AI 重新定义高效阅读体验。

推荐：

> Ampira 读取你选择的书签，把这些网站的新内容放进新标签页。需要时，AI 可以生成摘要，也能结合正文回答问题。

不推荐：

> 所有数据都在本地，隐私绝对安全。

推荐：

> 数据默认保存在浏览器中。使用 AI 时，问题和选定内容会直接发送给你配置的服务商。

## 各页面结构

### Chrome 与 Edge 商店

详细描述只使用两个栏目：

- 主要功能 / Main features
- 数据与权限 / Data and permissions

固定结构：

1. 痛点与解决方式
2. 无标题的专业场景
3. 六项主要功能
4. 数据与权限
5. 新标签页替换说明

Chrome 与 Edge 使用相同信息顺序。涉及浏览器名称、同步方式和配置文件时，按对应平台改写。

### 官网

三语首页顺序固定为：

1. Logo 与 AMPIRA 字标
2. 语言切换
3. 品牌广告语 H1
4. 痛点
5. Chrome Web Store 安装按钮
6. 解决方式
7. 专业场景
8. 隐私说明
9. 隐私、支持和数据删除链接

安装按钮是页面唯一的实心主要操作。不要再加第二个同级 CTA。

### README

每种语言的首屏顺序为：

1. 品牌广告语
2. 基础定位
3. 专业场景
4. 本地保存与隐私说明
5. 商店、版本、隐私和支持链接
6. 功能亮点

开发、权限、验证和打包内容保留在简体中文或英文技术部分，不要用营销文案替换。

### 扩展内

- 关于页只显示品牌广告语，不放商店长描述。
- 首次设置第一步用品牌广告语解释产品目的。
- AI 设置和首次设置第四步使用锁定标题。
- 普通状态文案说明当前状态和下一步，不重复品牌定位。

## 文件与来源

| 内容 | 文件 |
|---|---|
| Manifest 三语简介 | `_locales/en/messages.json`、`_locales/zh_CN/messages.json`、`_locales/zh_TW/messages.json` |
| 扩展三语文案 | `assets/client/locales/en.mjs`、`assets/client/locales/zh-CN.mjs`、`assets/client/locales/zh-Hant.mjs` |
| 静态 HTML 回退 | `dashboard.html` |
| Chrome 商店正文 | `store/listing/` |
| Edge 商店正文 | `store/edge-listing/` |
| 官网首页 | `docs/index.html`、`docs/zh-TW/index.html`、`docs/en/index.html` |
| 官网样式与 Logo | `docs/styles.css`、`docs/assets/ampira-logo.svg` |
| GitHub 首屏 | `README.md` |
| 一致性断言 | `tests/suites/manifest-security.mjs` |
| 视觉与文案 QA | `design-qa.md` |

不要把 `_locales` 或静态 HTML 当成唯一来源。运行时本地化、静态回退、商店和官网需要一起检查。

## 本地化流程

1. 先核对当前功能、权限和隐私边界。
2. 先写简体中文，句子稳定后再写繁体中文。
3. 繁体中文按当地习惯重写，不做机械字词替换。
4. 英文独立改写，保留相同事实和信息顺序。
5. 对三种语言分别检查直接性、节奏、信任度、真实性和精炼度。
6. 每种语言低于 45/50 时继续修改。

新增或删除本地化键时，三种语言必须同时更新。占位符名称和数量保持一致。

## 变更检查

修改核心文案后逐项确认：

- 品牌广告语在关于页、首次设置、官网和 README 中一致。
- Manifest 简介与品牌广告语一致。
- Chrome、Edge 商店短描述与官网 Meta 描述完全一致。
- 三种摘要都不超过 132 字符。
- 商店正文保留痛点开场和专业场景。
- 功能顺序没有变化，书签仍是主要来源。
- AI 的可选性、API Key 和正文解读边界没有丢失。
- 书签只读、本地保存、同步边界和精确来源授权仍然准确。
- 官网与 README 使用同一个 Chrome Web Store 地址。
- 消费者文案没有写入付费或未来功能承诺。
- 三种语言都经过 `humanizer-zh` 复核。

运行：

```powershell
.\scripts\verify-extension.ps1
git diff --check
```

涉及官网、关于页或首次设置的文字长度变化时，再检查桌面与窄屏的换行、截断和横向溢出。没有实际执行的手动浏览器检查，不要记录为已完成。
