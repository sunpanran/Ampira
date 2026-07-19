<p align="center">
  <img src="assets/icons/ampira-logo.svg" width="128" height="128" alt="Ampira logo">
</p>

# Ampira 资讯新标签页

[简体中文](#简体中文) · [繁體中文](#繁體中文) · [English](#english)

## 简体中文

> 从书签里的网站获取新资讯，再用 AI 整理和解读。

Ampira 是一个支持 Google Chrome 与 Microsoft Edge 的 Manifest V3 新标签页扩展。它读取你选择的书签，把保存的网页和这些网站的新内容放进同一页。资讯可以按时间或重要性查看。AI 功能可选，可以生成卡片摘要和今日简报；打开正文后，还能继续提问。

如果你需要长期跟踪一个行业或研究主题，可以把常看的来源放进同一个书签文件夹。Ampira 会集中更新，按重要性排序，再用 AI 整理成今日简报。遇到值得继续看的内容，也可以打开正文追问。

内容默认保存在浏览器中，不用注册账号。Ampira 没有广告、行为分析、开发者服务器或远程代码。

[Chrome 应用商店](https://chromewebstore.google.com/detail/oifmohbnghkaadoeghlemkllegajdajc?utm_source=item-share-cb) · [最新版本](https://github.com/sunpanran/Ampira/releases/latest) · [隐私政策](https://sunpanran.github.io/Ampira/privacy.html) · [支持](https://sunpanran.github.io/Ampira/support.html)

### 功能亮点

- 以只读方式读取你选择的书签文件夹，并用 RSS、Atom、JSON Feed 和公共来源（Ampira）补充资讯。
- 资讯支持按时间或重要性排序；同一事件的相关报道会放在一起，也可以按日期回看。
- 配置自己的 API Key 后，可生成卡片摘要和今日简报，也能结合正文继续提问。
- 每日灵感从 Ampira 预设或指定书签文件夹换一组卡片，也支持手动“换一换”。
- 点击工具栏图标，或从资讯和书签卡片加入稍后读；站内阅读、搜索和归档用于继续处理或找回内容。
- 快捷书签、待办、天气、顶部浏览器搜索和主题可按需使用。
- 网站访问只申请精确来源；API 密钥留在当前浏览器配置中，不进入账号同步。
- 远程内容始终作为不可信数据处理，并支持简体中文、繁体中文和英文。

### 本地加载

1. 在 Chrome 打开 `chrome://extensions`，或在 Edge 打开 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本仓库根目录。
4. 打开新标签页，按引导确认新标签页接管、书签用途和可选来源权限。

浏览器不允许扩展在运行时自行取消新标签页覆盖。如需恢复默认新标签页，请在扩展管理页停用或卸载 Ampira。

### 项目结构

- `manifest.json`：Manifest V3 清单、新标签页覆盖、权限和 CSP。
- `dashboard.html`、`assets/client/`：页面外壳、控制器、视图、展示模型和浏览器端状态。
- `assets/styles/`：按固定级联顺序拆分的界面样式；`assets/dashboard.css` 是样式入口。
- `extension/service-worker.mjs`：Chrome 事件注册和运行时组装入口。
- `extension/runtime/`：消息路由、权限、刷新、AI、Reader 与维护工作流。
- `extension/core/`：Feed/Reader 解析、IndexedDB、书签映射、设置、网络策略和存储适配器。
- `tests/suites/`：按领域组织的行为、安全和架构测试；`tests/extension.mjs` 是统一入口。
- `_locales/`：简体中文、繁体中文和英文的 Chrome 本地化资源。
- `docs/`：GitHub Pages 隐私、支持和数据删除页面。
- `store/`：Chrome Web Store 与 Microsoft Edge Add-ons 文案、隐私披露、审核说明和上架素材。

旧版 `dashboard-cache/` 可能包含用户数据。扩展和打包脚本不会读取、迁移、删除或发布该目录。

### 权限与隐私

必需权限仅有：

- `activeTab`：仅在用户点击 Ampira 图标时临时读取当前页标题和网址，用于加入稍后读。
- `bookmarks`：只读整理书签，Ampira 不调用书签写入 API。
- `storage`：保存设置、本地缓存和当前浏览器配置中的 API 凭据。
- `alarms`：定期检查需要刷新的来源。

`activeTab` 只在明确点击后临时访问当前页，不提供持续标签页或浏览历史访问，也不会增加安装警告。可选的 `favicon` 权限只会在用户主动启用后申请，用于 Chrome 内置 Favicon API；Edge 不支持时回退到随包图标。站内阅读会在用户点击后先按普通 CORS 规则、无凭据且无 Referer 地尝试公开内容；只有网站不允许这种读取时，网站访问权限才从后续用户手势发起，并限制到精确来源。Ampira 不申请 `tabs`、`history`、`scripting`、`webRequest` 或必需的宽泛主机访问权限。

资讯、摘要、搜索缓存和阅读状态保存在 IndexedDB。API 密钥只保存在 `chrome.storage.local`，不会进入浏览器账号同步；调用用户配置的 AI 或图片搜索服务时，密钥会直接发送给相应服务商，不会发送给 Ampira 开发者。

### 验证与打包

需要 PowerShell 7 和 Node.js 20 或更高版本：

```powershell
.\scripts\verify-extension.ps1
```

创建商店上传包：

```powershell
$env:REQUIRED_SUPPORT_URL = "https://github.com/sunpanran/Ampira/issues"
.\scripts\verify-extension.ps1 -Package
```

产物位于 `dist/`，包括版本化 ZIP、SHA-256 校验文件和发布清单。打包使用明确允许列表，并检查秘密、本机绝对路径、远程代码和非允许文件。

---

## 繁體中文

> 從書籤裡的網站取得新資訊，再用 AI 整理與解讀。

Ampira 是支援 Google Chrome 與 Microsoft Edge 的 Manifest V3 新分頁擴充功能。它讀取你選擇的書籤，把保存的網頁和這些網站的新內容放進同一頁。資訊可以依時間或重要性查看。AI 功能可選，可以產生卡片摘要與今日簡報；開啟內文後，還能繼續提問。

如果你需要長期追蹤一個產業或研究主題，可以把常看的來源放進同一個書籤資料夾。Ampira 會集中更新，依重要性排序，再用 AI 整理成今日簡報。遇到值得繼續看的內容，也可以開啟內文追問。

每日靈感會從 Ampira 預設或指定書籤資料夾換一組卡片。稍後讀、站內閱讀、搜尋與封存則用來繼續處理或找回內容。

內容預設保存在瀏覽器中，不用註冊帳號。Ampira 沒有廣告、行為分析、開發者伺服器或遠端程式碼。

[Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/oifmohbnghkaadoeghlemkllegajdajc?utm_source=item-share-cb) · [最新版本](https://github.com/sunpanran/Ampira/releases/latest) · [隱私權政策](https://sunpanran.github.io/Ampira/zh-TW/privacy.html) · [支援](https://sunpanran.github.io/Ampira/zh-TW/support.html)

---

## English

> Get news from bookmarked sites, then let AI organize and explain it.

Ampira is a Manifest V3 New Tab extension for Google Chrome and Microsoft Edge. It reads the bookmarks you choose and brings saved pages and new posts from those sites into one page. Sort the result by time or importance. AI is optional. It can create card summaries and a daily brief. When you open an article, it can use the text to answer follow-up questions.

If you track an industry or research topic over time, put the sources you follow in one bookmark folder. Ampira keeps their updates together, sorts them by importance, and uses AI to create a daily brief. Open any article to ask follow-up questions.

Data stays in the browser by default, with no account needed. Ampira has no ads, behavioral analytics, developer-operated backend, or remotely hosted code.

[Chrome Web Store](https://chromewebstore.google.com/detail/oifmohbnghkaadoeghlemkllegajdajc?utm_source=item-share-cb) · [Latest release](https://github.com/sunpanran/Ampira/releases/latest) · [Privacy](https://sunpanran.github.io/Ampira/en/privacy.html) · [Support](https://sunpanran.github.io/Ampira/en/support.html)

### Highlights

- Reads the bookmark folders you choose in read-only mode, with RSS, Atom, JSON Feed, and Public sources (Ampira) as supplements.
- Sorts news by time or importance, groups coverage of the same event, and keeps previous dates available.
- Uses your own API key for card summaries, a daily brief, article analysis, and follow-up questions.
- Shows a different set of Inspiration cards each day from the Ampira preset or a bookmark folder you choose.
- Adds pages to Read later from the toolbar or a card; in-app reading, search, and archive help you continue or find content again.
- Keeps quick bookmarks, to-dos, weather, browser search, and themes available when you need them.
- Requests only exact website origins and keeps API keys out of browser account sync.
- Treats remote content as untrusted data and supports Simplified Chinese, Traditional Chinese, and English.

### Load locally

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the repository root.
4. Open a new tab and follow the onboarding flow for the new-tab override, bookmark access, and optional source permissions.

Browsers do not allow an extension to disable its own new-tab override at runtime. Disable or uninstall Ampira from the extensions page to restore the default new tab.

### Repository layout

- `manifest.json`: Manifest V3 configuration, new-tab override, permissions, and CSP.
- `dashboard.html`, `assets/client/`: page shell, controllers, views, presenters, and browser-side state.
- `assets/styles/`: styles split in a fixed cascade order; `assets/dashboard.css` is the stylesheet entry point.
- `extension/service-worker.mjs`: Chrome event registration and runtime composition entry point.
- `extension/runtime/`: message routing, permissions, refresh, AI, reader, and maintenance workflows.
- `extension/core/`: feed and reader parsing, IndexedDB, bookmark mapping, settings, network policy, and storage adapters.
- `tests/suites/`: domain-focused behavior, security, and architecture tests; `tests/extension.mjs` is the single test entry point.
- `_locales/`: Chrome localization resources for Simplified Chinese, Traditional Chinese, and English.
- `docs/`: GitHub Pages privacy, support, and data-deletion pages.
- `store/`: Chrome Web Store and Microsoft Edge Add-ons copy, privacy disclosures, reviewer notes, and listing assets.

The legacy `dashboard-cache/` directory may contain user data. The extension and packaging scripts never read, migrate, delete, or publish it.

### Permissions and privacy

Ampira requires only:

- `activeTab`: temporarily read the current page title and URL only when the user clicks the Ampira icon to add it to Read later.
- `bookmarks`: read-only bookmark organization; Ampira does not call bookmark mutation APIs.
- `storage`: settings, local caches, and API credentials for the current browser profile.
- `alarms`: periodic checks for sources that are due for refresh.

`activeTab` applies only to the current page after an explicit click, provides no continuous tab or browsing-history access, and adds no install warning. The optional `favicon` permission is requested only after a user action and uses Chrome's built-in Favicon API; Edge falls back to the packaged icon when that API is unavailable. Website access is also user-initiated and restricted to exact origins. Ampira does not request `tabs`, `history`, `scripting`, `webRequest`, or broad required host access.

Feed data, summaries, search caches, and reading state are stored in IndexedDB. API keys remain in `chrome.storage.local` and are excluded from browser account sync. When the user enables an AI or image-search provider, its key is sent directly to that provider and never to the Ampira developer.

### Verify and package

PowerShell 7 and Node.js 20 or newer are required:

```powershell
.\scripts\verify-extension.ps1
```

To create a store upload package:

```powershell
$env:REQUIRED_SUPPORT_URL = "https://github.com/sunpanran/Ampira/issues"
.\scripts\verify-extension.ps1 -Package
```

Versioned ZIP, SHA-256, and release-manifest files are written to `dist/`. Packaging uses an explicit allowlist and audits for secrets, local absolute paths, remote code, and unexpected files.

### Store release

Publish the pages in `docs/`, keep the store disclosures aligned with the extension's actual behavior, and use the Chrome and Edge materials under `store/` for submission. The same Chrome Web Store item should be used for private testing and public release.

Approval remains subject to each store's review.
