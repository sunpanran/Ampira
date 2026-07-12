# Ampira Chrome 新标签页扩展

Ampira 是一个本地优先的 Manifest V3 Chrome 扩展。它把用户选择的 Chrome 书签、公开 Feed 和阅读状态整理成高密度新标签页，提供今日信号、事件主题、阅读队列、Signal Feed、Archive Index、结构化安全阅读器和可选 AI 摘要。

扩展没有账号、广告、分析、开发者服务器或远程代码。

## 本地加载

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本仓库根目录。
4. 打开新标签页，按四步引导确认新标签页接管、书签用途和可选来源权限。

Chrome 不支持扩展在运行时动态取消新标签页覆盖。要恢复默认页面，请在扩展管理页停用或卸载 Ampira。

## 结构

- `manifest.json`：Manifest V3 清单、新标签页覆盖、权限和 CSP。
- `dashboard.html`、`assets/`：现有高密度信息终端界面、三语言文案与浏览器模块。
- `extension/service-worker.mjs`：消息路由、书签读取、后台刷新、AI 调用和权限控制。
- `extension/core/`：IndexedDB、Feed/Reader 解析、书签映射、设置归一化、有界网络请求、并发配额、客户端状态和本机凭据存储。
- `_locales/`：Chrome 清单与商店所需的简中、繁中、英文名称和描述。
- `docs/`：用于 GitHub Pages 的隐私、支持和数据删除页面。
- `store/`：商店文案、隐私实践、审核说明和上架图片。
- `THIRD_PARTY_NOTICES.txt`：随包分发的 Lucide 图标许可声明。
- `tests/*.mjs`：Manifest、本地化、书签、Feed、设置、缓存、并发状态、配额、凭据、Reader 和远程代码测试。

旧版 `dashboard-cache/` 不会被扩展读取、迁移、删除或打包，可以由用户自行备份后清理。

## 权限与数据

必需权限只有：

- `bookmarks`：只读整理书签；代码不调用写入方法。
- `storage`：保存同步设置、本地缓存和当前 Chrome 配置中的 API 凭据。
- `alarms`：每 15 分钟检查到期来源。

可选的 `favicon` 权限只在用户点击启用后申请，用于通过 Chrome 内置 Favicon API 显示书签与页面的网站图标；Ampira 不申请 `tabs` 或 `history`，也不会把这些地址发送给第三方图标服务。网站来源权限同样只在用户操作后按具体域名申请。普通 HTTP 只允许 `localhost` 和 `127.0.0.1`。

部分非凭据小型偏好使用 Chrome Sync；用户开启 Chrome Sync 时，Chrome 可能把这些设置复制到同账号的其他 Chrome 安装。资讯、摘要、搜索缓存和阅读状态使用 IndexedDB。API 密钥只保存在当前 Chrome 配置的 `chrome.storage.local` 中，不参与同步，保存后页面不会回显完整密钥；调用 AI 或图片搜索时，对应密钥会直接发送给用户配置的服务商以验证请求，不会发送给 Ampira 开发者。

公共 Feed 补盲默认开启，可在设置中关闭，并且只在用户授权相应精确来源域名后读取。今日灵感会在用户授权对应站点后优先读取页面声明的原站主图，并在首屏渲染前启动当天固定 15 张（含三批“换一换”）的预加载；原图缺失或加载失败时，才使用用户另行配置的 Brave 图片搜索兜底。Reader 与卡片显示远程图片时由浏览器直接请求图片域名，Ampira 不代理请求。

## 验证与打包

```powershell
.\scripts\verify-extension.ps1
.\scripts\verify-extension.ps1 -Package
```

脚本要求 PowerShell 7 和 Node.js 20 或更高版本。标准验证会按名称运行全部顶层 `tests/*.mjs`，递归检查扩展模块语法与本地依赖，并核对 Manifest、本地化键、根页面资源以及 `docs/` 全部本地子页链接；真实支持 URL、发布占位和公开发布元数据在 `-Package` 模式中强制检查。

带 `-Package` 时还会执行发布元数据门禁。公开支持入口为 `https://github.com/sunpanran/Ampira/issues`；本地打包时必须设置同值环境变量：

```powershell
$env:REQUIRED_SUPPORT_URL = "https://github.com/sunpanran/Ampira/issues"
.\scripts\verify-extension.ps1 -Package
```

打包输出包括 `dist/ampira-<manifest version>.zip`、对应 `.zip.sha256` 和 `.manifest.json`。ZIP 使用排序文件和固定时间戳创建；发布清单记录 ZIP 哈希、逐文件 SHA-256，以及 CI 中可用的 `GITHUB_SHA`。打包从 `manifest.json` 读取默认版本，使用明确允许列表，并在覆盖已有 ZIP 前完成环境与输入检查；它会扫描疑似密钥、本机绝对路径和远程脚本，不包含 `dashboard-cache/`、日志、测试文件、截图历史或本机配置。

`.github/workflows/verify.yml` 在 Windows、PowerShell 7 和 Node.js 20 上运行同一验证与打包流程，并上传三项版本化产物。仓库必须配置 `REQUIRED_SUPPORT_URL` Actions variable，否则发布作业会按设计失败。

## Chrome Web Store

提交前：

1. 先配置并写入真实 `REQUIRED_SUPPORT_URL`，再将 `docs/` 发布到 GitHub Pages，并把隐私政策与支持 URL 填入开发者后台。
2. 使用 `store/listing/`、`store/privacy-practices.md` 和 `store/reviewer-notes.md` 填写商店与隐私字段。
3. 上传 `store/assets/` 中的 1280×800 截图和 440×280 宣传图。
4. 先用同一商店项目的 Private trusted testers 完成审核，再切换为 Public。
5. 开发者 Google 账号必须启用两步验证。

Google 最终是否批准由 Chrome Web Store 审核决定。本仓库提供可复现打包流程和提交材料；只有填入并发布真实支持 URL、完成提交清单且 `-Package` 验证通过后，生成的当前版本 ZIP 才可提交审核。
