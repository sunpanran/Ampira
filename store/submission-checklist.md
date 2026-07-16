# Chrome Web Store submission checklist

本清单只保留每次提交都需要重新确认的发布门槛。功能级回归范围以 `design-qa.md` 和自动化测试为准。

## Accounts and public URLs

- [ ] 发布 Google 账号已启用两步验证，并继续使用同一个 Chrome Web Store 正式条目。
- [ ] `REQUIRED_SUPPORT_URL` 指向真实公开 HTTPS 支持地址，`docs/` 中的隐私、支持和数据删除页面无需登录即可访问。
- [ ] 隐私政策包含 Limited Use 声明；三语文档、商店文案、权限理由和实际行为一致。

## Unpacked extension QA

- [ ] 从 `chrome://extensions` 加载仓库根目录，确认 Manifest、Service Worker 和控制台无错误。
- [ ] 完成四步首次引导；分别验证跳过与进入 AI 设置的交接，并确认新标签页覆盖由扩展安装状态控制。
- [ ] 在 HTTPS 页面点击工具栏图标，确认只捕获当前页标题和 URL、重复项去重、不支持页面安全失败；不得读取页面正文或其他标签页。
- [ ] 验证书签只读；拒绝书签或精确网站权限后界面仍可用，授权与撤权会立即更新来源、Reader 和缓存状态。
- [ ] 启用并撤销可选 `favicon` 权限，确认 Chrome 原生图标只在授权期间使用，失败时回退到随包图标。
- [ ] 启用并撤销可选 `search` 权限，确认顶部字段使用 Chrome 当前默认搜索服务且导航搜索仍明确为 Ampira 内容搜索。
- [ ] 使用合成内容和非生产凭据验证 AI 同意、精确 Provider 来源授权、连接测试、手动 Token 提醒和撤权后的重新锁定；测试后删除凭据。
- [ ] 验证 Reader 只读取已授权的公开 HTML，跨来源 Feed 需要独立授权，非本地 HTTP、无关 URL 和未授权来源均被拒绝。
- [ ] 验证阅读队列、待办和天气城市三个 Chrome Sync 开关默认关闭、互相独立；关闭同步后远端副本删除而本地副本保留，API Key 和缓存不得进入 Sync。
- [ ] 使用合成数据取消并确认一次恢复出厂设置；确认 Ampira 本机/同步数据与可选权限被清理，Chrome 书签不变，所有看板回到四步引导。
- [ ] 在深色 `1280×800`、浅色 `1440×1000` 和窄屏窗口验证 Dashboard、设置、引导和 Reader：无横向溢出、键盘焦点可见、减少动态效果有效、加载/空/错误状态可用。
- [ ] 测试和截图不得使用真实 API Key、私人书签、Chrome Profile 或运行时缓存。

## Package and listing

- [ ] 在 PowerShell 7 与 Node.js 20+ 环境设置真实 `REQUIRED_SUPPORT_URL`，运行 `.\scripts\verify-extension.ps1 -Package`。
- [ ] 上传脚本生成的 Manifest 版本化 ZIP，并保留 `.zip.sha256` 与 `.manifest.json`；CI 构建时确认记录预期 `GITHUB_SHA`。
- [ ] 审计 ZIP：根目录直接包含 `manifest.json`，不含测试、`output/`、`dashboard-cache/`、隐藏配置、密钥、本机路径、私人数据或允许列表外文件。
- [ ] 使用 `store/listing/`、`store/privacy-practices.md` 和 `store/reviewer-notes.md` 的当前内容。
- [ ] 上传 `store/assets/` 中当前列出的商店素材；若可见界面或权限状态变化，重新捕获对应截图。
- [ ] 确认无应用内购买、成熟内容、分析、广告、远程代码或开发者后端需要额外披露。
- [ ] 确认 Open-Meteo 与 GeoNames 的可见归属和许可仍满足当前发布方式。

## Rollout

- [ ] 先以 Private 向可信测试者发布同一个条目。
- [ ] 修复审核或测试反馈后，每个新 ZIP 都递增 `manifest.json` 版本并重新完整验证。
- [ ] 将同一个已审核条目切换为 Public，不创建重复正式条目。
