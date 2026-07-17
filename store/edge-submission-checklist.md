# Microsoft Edge Add-ons submission checklist

先完成共享的 Chrome 功能、隐私、合成数据和打包检查，再执行以下 Edge 专项检查。

## Edge compatibility QA

- [x] 从 `edge://extensions` 加载仓库根目录，确认 Manifest、Service Worker 和控制台无错误。
- [x] 打开 `edge://newtab` 完成四步引导；精确网站权限不得依赖或请求 Chrome 专属 `favicon` 权限。
- [x] “设置 → 浏览器”应说明网站图标不受支持、隐藏权限开关并稳定使用随包图标。
- [x] 扩展管理操作打开 `edge://extensions/`；不得声称 Ampira 能控制 Edge 的新标签页浏览器外壳图标。
- [ ] 启用并撤销顶部搜索权限，确认使用 Edge 当前默认搜索服务，撤权后恢复 Ampira 内容搜索。
- [ ] 使用合成数据验证工具栏捕获、只读书签、alarms、精确来源权限、恢复出厂设置和两个已登录 Edge 实例间的可选同步。
- [ ] 在水平标签、垂直标签和分屏中复核深浅主题、键盘焦点、减少动态效果及基准视口，无横向溢出和控制台错误。

## Listing and review

- [ ] 使用 `store/edge-listing/` 与 `store/edge-reviewer-notes.md` 的 Microsoft Edge 文案，不提交 Chrome 品牌版本。
- [ ] 披露新标签页覆盖、可选精确来源、浏览器账号同步和 Edge 网站图标回退。
- [ ] 确认公开隐私、支持和删除页面同时说明 `chrome://extensions` 与 `edge://extensions`。
- [ ] 仅在 Edge 专项 QA 通过后上传同一个已验证 ZIP。
