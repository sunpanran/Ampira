# Ampira MV3 QA

本文件只保留当前 Manifest V3 扩展的 QA 基线和最近一次仍有效的界面结论，不作为逐次改动日志。历史实现与发布记录应通过 Git 历史查询。

已移除的 Node 版不属于当前架构。旧 `dashboard-cache/` 仅包含用户自行管理的历史数据；验证、迁移和打包均不得读取、删除或发布它。

## Current Architecture

- `dashboard.html` 是新标签页单页入口；`assets/client/` 使用本地 ESM 组装控制器、视图、状态和消息客户端，不加载或执行远程代码。
- `extension/service-worker.mjs` 只负责 Chrome 事件注册和运行时组装；Chrome 工作流位于 `extension/runtime/`，确定性领域逻辑与适配器位于 `extension/core/`。
- `assets/dashboard.css` 按固定顺序导入 `assets/styles/`；界面保持高密度信息终端风格、单一网格纹理、桌面浮动导航、移动底部导航，以及 `1120px`、`820px`、`520px` 断点。
- 必需权限为 `activeTab`、`alarms`、`bookmarks`、`storage`。`activeTab` 仅用于用户点击工具栏后的当前页稍后读捕获；书签只读。`favicon`、`search` 和精确网站来源均为用户手势触发的可选权限。
- 非凭据设置可进入 Chrome Sync；API Key 只存于 `chrome.storage.local`。Feed、Reader、摘要、阅读状态及其他缓存通过现有 IndexedDB/存储抽象管理。
- UI 同步支持简体中文、繁体中文和英文。远程文本保持惰性，只能通过结构化 DOM 和 `textContent` 渲染。
- Microsoft Edge 使用浏览器中立文案和扩展管理入口；不请求 Edge 不支持的 Chrome 原生 `favicon` 权限，并回退到随包图标。

## Current UI Baseline

- Dashboard、首次引导和设置使用克制的玻璃表面、细边线与现有主题令牌；不得恢复装饰性卡片堆叠、宽幅渐变或营销式大标题。
- 首次引导保留产品说明、来源选择、网站授权和 AI 交接四步。桌面面板目标宽度为 `600px`；窄屏能力标签使用单列，主操作获得初始焦点。
- 设置保留 AI、资讯、书签、屏蔽、外观、浏览器和关于七类。桌面弹窗目标尺寸为 `1040px × 84dvh`；窄屏使用可横向滚动的分类导航，并恢复各分类滚动位置。AI 顶部的额度、缓存和自动整理状态必须常驻：桌面使用中性磨砂底、带列分隔线的三列状态带，不使用紫色装饰渐变；`820px` 以下纵向排列，不使用折叠容器或独立状态卡片。
- 首页视觉减重仅作用于 `#daily`；设置弹窗和其他页面不得继承首页的透明承载层规则。快捷入口继续支持滚动、拖动、渐隐、空状态和键盘焦点。
- “显示高度”和“模糊强度”常驻为“标题 → 滑动条 → 当前值”布局；禁用时保留可见的原生 `disabled` 状态，拖动预览不得改变轨道宽度。
- 深色、浅色和跟随系统主题均须可用；`prefers-reduced-motion` 下不得保留必要性之外的循环或入场动画；强制色模式及不支持 `backdrop-filter` 时必须回退到可读实色表面。
- 浮动选择器、菜单和弹出列表不得使用 `scrollbar-gutter: stable`，短列表左右内边距应保持对称。

## Automated Verification

每次代码或内容修改运行：

```powershell
.\scripts\verify-extension.ps1
```

验证至少应覆盖：

- `node tests/extension.mjs` 统一测试入口，以及全部扩展 ESM 的语法检查。
- Manifest 权限、CSP、静态本地资源、非字面量动态导入、远程代码和不安全 HTML sink 禁令。
- 三种客户端语言与三套 Chrome Manifest locale 的键和值完整性。
- 消息信封、请求关联、过期响应保护、权限代际、刷新代际与并发写入顺序。
- 设置归一化、Chrome Sync 边界、本机凭据隔离、IndexedDB 缓存配额、裁剪和失效策略。
- Feed、Reader、图片、网络地址与权限策略的安全边界和失败回退。
- `extension/service-worker.mjs` 的 composition-root 约束、core/runtime 依赖方向和本地 CSS import 完整性。
- 文档、商店材料、支持 URL、打包允许列表及敏感内容检查。

对策略、存储、权限、解析器、运行时或 UI 模型的行为改动，应在 `tests/suites/` 增加聚焦覆盖并从 `tests/extension.mjs` 注册。

## Browser Verification

UI 或交互修改后，使用安全合成数据的本地预览或加载已解压扩展验证：

- 深色 `1280×800`、浅色 `1440×1000` 和窄屏 `390×844`；必要时补充相反主题和系统主题。
- 页面、设置、引导、Reader、菜单和弹窗横向溢出均为 `0`，控制台无错误。
- 键盘焦点、Escape/背景关闭、关闭后焦点恢复、滚动位置恢复、加载/空/错误状态均正常。
- 减少动态效果下无持续动画；强制色模式下文字、边界、选中态和焦点仍可辨识。
- 权限只能从用户手势发起；拒绝或外部撤权后界面保持可用并立即反映状态。
- 新标签页安装状态必须如实说明，不得显示可写的伪开关；内部搜索必须明确标为 Ampira 内容搜索。
- 不得使用真实 API Key、私人书签、Chrome Profile 或运行时缓存进行测试或截图。
- 仅将有意保留且隐私安全的截图写入 `output/playwright/`；未实际执行加载已解压扩展的手动 QA 时必须明确说明。

安全合成预览记录只能作为当次变更证据，不构成持续有效的手动浏览器 QA；是否完成真实 Chrome/Edge 验证必须在发布检查中重新确认。

2026-07-17 的 AI 运行状态带使用安全合成数据覆盖深色 `1280×800`、浅色 `1440×1000` 和浅色 `390×844`：桌面三列、窄屏三行，分隔线方向正确，三个状态值无截断，页面与设置横向溢出均为 `0`，控制台零错误与警告。截图位于 `output/playwright/runtime-status-band/`；未执行加载已解压扩展后的手动 Chrome/Edge QA。

## Release Verification

发布前设置真实公开 HTTPS 支持地址并运行：

```powershell
$env:REQUIRED_SUPPORT_URL = "https://github.com/sunpanran/Ampira/issues"
.\scripts\verify-extension.ps1 -Package
```

- 版本只从 `manifest.json` 读取，不在文档或自动化中硬编码。
- 检查生成的版本化 ZIP、SHA-256 sidecar 和 release manifest；ZIP 根目录必须直接包含 `manifest.json`。
- 确认产物不含 `dashboard-cache/`、测试、输出、隐藏配置、密钥、本机绝对路径、远程代码或允许列表外文件。
- 确认 `docs/` 页面已发布，三语商店文案、隐私披露、权限理由、审核说明与实际行为一致。
- 不得手工编辑 `dist/` 生成物。

## 2026-07-17 — 资讯与书签页轻量极简化

- 资讯页仅在 `#news` 作用域内减重：卡片边线使用 `--card-line` 的 `65%`，玻璃底色使用 `--blur-panel-bg` 的 `88%`，取消静态阴影；正文保持 `14px` 内边距和 `8px` 间距。favicon 占位光为 `.34 / blur(20px) / saturate(1.35)`，卡片光晕为 `.055 / 200px / 240ms`，真实图片、刷新、悬停和焦点状态不变。
- 书签页仅在 `#library` 作用域内减重：分类面板使用相同的 `65%` 边线和 `88%` 玻璃底色，无静态阴影，间距与内边距为 `10px / 12px`；入口行保持透明表面，间距与内边距为 `8px / 8px`。分类和入口光晕分别为 `.055 / 200px / 240ms` 与 `.07 / 180px / 240ms`。
- 使用安全合成数据完成深色 `1280×800`、浅色 `1440×1000`、窄屏深色 `390×844` 检查：资讯页 10 张卡片、书签页 3 个分类和 9 条入口在全部视口的横向溢出均为 `0`，控制台错误为 `0`。真实图片与 favicon 回退、加载、空、合成错误、已看/稍后读、无匹配、右键菜单、键盘焦点、关闭光晕和减少动态效果均已覆盖。
- 设置书签页 `1440×1000` 隔离检查通过；设置表面、边线、背景模糊和编辑器未受页面作用域规则影响。截图位于 `output/playwright/news-library-minimal/`。
- `git diff --check`、`node tests/extension.mjs` 和 `.\scripts\verify-extension.ps1` 通过。
- 截图和预览不含真实 API Key、私人书签、Chrome Profile 或运行时缓存。本次未执行加载已解压扩展的手动 Chrome QA。

## 2026-07-17 — 五入口导航轻量化

- 今日、资讯、书签、搜索、设置五个入口的顺序、图标、文案、DOM 标识和交互保持不变；静态选中态继续使用既有强调色边线、胶囊底色、强文字和阴影。桌面按钮维持 `42px`，`1440px` 以上维持 `48px`，移动端维持 `42px` 纯图标触控目标。
- 桌面轨道改用导航专属的半透明主题表面、弱边线、轻量模糊和克制阴影；移除按钮鼠标径向光晕。未选中项悬停仅显示低对比表面，选中项仅在悬停时轻微调整底色；悬停与 `focus-within` 展开、三语动态宽度和标签淡入逻辑保留，并增加语言安全余量。
- 使用安全合成数据完成深色 `1280×800`、浅色 `1440×1000` 和深色 `390×844` 检查：页面横向溢出均为 `0`，英文 `Settings` 展开标签无裁切，移动端标签保持隐藏，书签关闭后底栏由 5 项正确重排为 4 项。键盘焦点具有清晰 `2px` 轮廓，减少动态效果下标签过渡时长降为 `0.00001s`。
- 今日、资讯、书签滚动定位正常；搜索和设置打开时活动态正确切换，关闭后恢复至当前内容入口。控制台错误和警告均为 `0`。截图位于 `output/playwright/navigation-lightweight/`。
- `git diff --check`、`node tests/extension.mjs` 和 `.\scripts\verify-extension.ps1` 通过。截图和预览不含真实 API Key、私人书签、Chrome Profile 或运行时缓存；本次未执行加载已解压扩展后的手动 Chrome/Edge QA。
