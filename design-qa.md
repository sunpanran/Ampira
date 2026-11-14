# Ampira MV3 QA

## 2026-11-15 — 灵感通栏影像与大小卡位

- 按确认稿调整今日灵感：大卡位使用 112px 通栏影像，分类、站点名和网址成组居中，取消分类底板，不增加图案或外链箭头；文字侧遮罩为 76%，向右减弱，图片恢复完整亮度。内部 14px 连续曲率圆角、18px 行间距和内容侧留白与外框协调，标题栏继续与今日资讯共用边距和“换一换”定位。四张内置封面补充焦点位置，远端预览保持默认裁切。
- 小卡位收起网址，保留分类和标题；168px 卡位显示两条完整内容，较高卡位按容器高度显示三条，列表内滚动并复用公共滚动条。大小卡位互换即时重排，保留同步换批、键盘打开、焦点、原有 URL 悬停提示和减少动态效果。
- 使用真实组件和内置公开站点／合成资讯，在隔离 Chrome 中通过深浅主题 × 1280×800／1440×1000／390×844 检查，并补查繁体中文与英文桌面／窄屏。完整条目数量、无横向溢出、按钮位置、公共滚动条、文字边界、键盘打开和滚动、连续换批、卡位互换、减少动态效果、远端预览重置、损坏图片回退与空态均通过；无页面或控制台错误，已查看大小卡位截图，未操作用户安装实例。见 [检查结果](output/playwright/inspiration-layout/results.json)、[浏览器记录](output/playwright/inspiration-layout/browser-check.log) 和 [可复用夹具](tests/browser/inspiration-layout.html)。
- 封面裁切回归和最终 `scripts/verify-extension.ps1 -Package` 完整通过，退出码 0。同步了三语隐私页、商店审核说明中的欢迎页与授权步骤，以及繁体 README 的主题追踪行为描述。ZIP、SHA-256 与逐文件发布清单核对通过：420 个文件与当前源码一致，根目录清单正确，无私密缓存、测试文件、凭据、机器绝对路径或远程脚本。见 [完整校验](output/playwright/inspiration-layout/verification-final.log) 和 [包审计](output/playwright/inspiration-layout/package-audit.json)。

## 2026-11-15 — 阅读队列复制全部链接

- 阅读队列在任意卡位的右键菜单中新增“复制全部链接”，位于“切换卡片”前；卡片标题、空白处及队列条目共用入口，条目保留单链接复制。按当前队列顺序输出每行一个网址，去重并排除空网址和已读条目，包含滚动区域之外的完整队列；空队列隐藏该操作。复制不打开网页、不标记已读、不移除条目、不写入存储，简繁英文案同步。
- 新增 `tests/suites/reading-queue-copy.mjs` 并接入统一测试，覆盖顺序、去重、最新数据、已读／空链接过滤、所有卡位、三语、切换类型和状态不变。菜单接线与序列化增加 429 字节首页静态源码，将相关源码体积预算从 768 KiB 明确调整为 769 KiB；未新增启动依赖。最终 `scripts/verify-extension.ps1` 完整通过，退出码 0；沙盒曾阻止测试临时文件重命名，最终在沙盒外完成。见 [完整校验](output/playwright/reading-queue-copy/verification-final.log)。
- 隔离 Chrome 使用真实队列、状态与菜单组件及合成数据，完成深浅主题 × 1280×800／390×844 × 三语 × 大小卡位的 48 次复制，再检查队列更新、Enter 复制及原有单链接复制，共 51 次写入。验证 Shift+F10、Escape 焦点恢复、空态、类型切换、菜单边界、减少动态效果及横向溢出，均通过，无页面或控制台错误；已查看最终菜单截图。剪贴板写入由夹具拦截核对，未覆盖系统剪贴板或操作用户安装实例。证据：[浏览器检查](output/playwright/reading-queue-copy/browser-check.log)、[结果摘要](output/playwright/reading-queue-copy/browser-summary.log)、[桌面截图](output/playwright/reading-queue-copy/dark-1280.png)、[窄屏截图](output/playwright/reading-queue-copy/light-390.png)。

## 2026-11-15 — 页面快捷键默认关闭

- 新配置及缺少快捷键开关字段的旧配置默认关闭；设置开关、按键响应和快捷键提示均仅在显式开启后生效。保留已保存的开关选择及自定义绑定。
- 快捷键回归覆盖默认不拦截按键、开启后执行、提示显隐、旧配置回退、保存选择、同步导入和草稿取消；设置存储与导入导出回归通过。最终 `scripts/verify-extension.ps1` 完整通过，退出码 0。见 [完整校验](output/playwright/keyboard-default-off/verification-final.log)。
- 隔离 Chrome 使用真实首页和合成数据，验证默认关闭、键盘操作开关、Alt+N 响应及输入焦点、开启／关闭后的保存重载和提示同步；无横向溢出、页面或控制台错误。检查采用深色 1280×800 与减少动态效果，已查看默认关闭截图；本次未改布局或样式，未操作用户安装实例。见 [浏览器检查](output/playwright/keyboard-default-off/browser-check.log)、[截图](output/playwright/keyboard-default-off/default-off.png)。

## 2026-11-15 — 移除备用图片搜索标题

- 删除“备用图片搜索”分组标题、空容器、闲置样式及三语翻译键；分组的无障碍名称改为引用现有“全网图片搜索”标签。
- `scripts/verify-extension.ps1` 完整通过。隔离 Chromium 合成预览检查三语、深浅主题、1280×800／390×844 下的无标题空行、开关展开／收起、键盘焦点、减少动态效果和横向溢出，均通过，无页面或控制台错误；已查看桌面与窄屏局部截图，未操作用户安装实例。见 [界面检查与截图](output/playwright/image-search-heading/)、[完整校验](output/playwright/image-search-heading/verification-final.log)。

## 2026-11-15 — 独立欢迎页与入门焦点

- 入门流程调整为“欢迎 → 内容来源 → 网站访问”。欢迎页沿用已确认的两行标题和说明，右侧“开始设置”按钮与后续步骤对齐，简繁英同步；不增加 AI 配置步骤或额外权限。来源页可返回欢迎页，授权页可返回来源选择，Escape 同样逐步返回；保存并恢复当前进度，兼容旧版 `folders` 和 `ai` 进度，已完成入门的用户不重显。
- 入门流程移除按钮与来源行外侧的青色焦点框。打开和切换步骤时将阅读焦点放在标题，鼠标操作保持正常选中外观，Tab／方向键导航使用轻量文字下划线，保留焦点约束与无障碍标题。
- 真实入门控制器与合成数据在隔离 Chromium 中通过 14 组检查：三语、深浅主题、1280×800／390×844、320px 溢出、按钮右对齐、标题焦点、Tab／Shift+Tab、方向键、Escape、减少动态效果、来源选择保留、书签明确同意、空文件夹、保存失败、刷新恢复、授权拒绝／重试、过期权限响应与重复点击保护。授权调用保留用户手势，欢迎按钮不读取书签或触发网站授权；已查看欢迎页、来源页和英文窄屏截图，无页面或控制台错误。权限响应使用合成数据，未操作用户安装实例或验证原生授权弹窗。
- 进度模型与权限回归、实际调用的清单／多语言／安全检查通过。最终 `scripts/verify-extension.ps1` 完整通过，退出码 0；保留既有启动体积预算，统一测试、模块语法、导入和资源检查通过。证据：[浏览器检查](output/playwright/onboarding-welcome/results.json)、[可复用夹具](tests/browser/onboarding.html)、[截图与检查脚本](output/playwright/onboarding-welcome/)、[完整校验记录](output/playwright/onboarding-welcome/verification.log)。既有图标合并授权的专项记录保留在 [图标授权检查](output/playwright/onboarding-favicon/results.json)。

## 2026-11-15 — 搜索空态与展开动画修复

- 修复隐藏 AI 入口后，空结果列表的零高度导致展开动画被跳过的问题。高度过渡改为覆盖整个搜索区域，保留 300ms 时长、现有缓动、关闭暂停与中途反向；结果和底部提示一次展开，清空时一起收起。
- 空输入及纯空格输入隐藏整个底部提示区和“启用浏览记录搜索”；有实际查询后显示，慢请求继续提供延迟加载反馈与错误提示。未配置 AI 时仍隐藏 AI 行。移除统一搜索中失效的配置跳转，点击前继续复核问答可用性。
- 统一搜索定向回归和修改模块的语法检查通过。隔离 Chromium 对深浅主题 × 1280×800／390×844 × 已配置／未配置 AI 的 8 种状态逐帧记录展开与收起，确认存在中间高度、单调过渡和准确终态；快速清空／重新输入无高度跳变。浏览记录入口显隐、空态无占位、键盘焦点恢复、减少动态效果、慢请求／错误提示均通过，无页面／控制台错误或外部请求。已查看桌面深色与窄屏浅色截图，未操作用户安装实例。此前的稳态检查未覆盖零行展开动画，本项补齐。见 [最终逐帧检查](output/playwright/search-ai-visibility/motion-final-browser-check.log) 和 [截图](output/playwright/search-ai-visibility/)。
- `scripts/verify-extension.ps1` 已执行，在首页静态依赖图的 768 KiB 预算断言处停止。最终定向测量为 786708 字节，超出 276 字节；按本轮修改前的搜索代码重建测量，当前其余工作区改动下仍为 786628 字节。本轮搜索代码净增 80 字节，未放宽预算或修改无关模块，不将此次完整校验记录为通过。见 [完整校验日志](output/playwright/search-ai-visibility/motion-verification.log) 和 [体积核对脚本](output/playwright/search-ai-visibility/size-check.mjs)。

## 2026-11-15 — 已看归档列表间距

- 归档条目最小高度由 40px 收紧至 32px，上下内边距为 6px；行间距由 8px 收紧至 4px。左右留白、字体、删除线、标题栏和卡片尺寸沿用当前样式，触屏仍保留 44px 条目点击范围。
- 隔离 Chromium 的真实归档组件与合成数据检查通过：深浅主题 × 1280×800／390×844 的行高、间距、左右留白、键盘焦点／打开、长列表滚动及横向溢出均正常；独立触屏上下文确认 44px 点击范围和触摸打开。无页面或控制台错误，已查看桌面及窄屏截图；未操作用户安装实例。证据：[界面检查](output/playwright/archive-density/browser-check.log)、[截图](output/playwright/archive-density/)。
- `scripts/verify-extension.ps1` 已执行，当前工作区首页静态依赖为 786831 字节，超出 768 KiB 预算 399 字节，检查在架构断言处停止。本次仅修改 CSS 与设计记录，不影响 JavaScript 依赖体积；未更改预算或无关模块。见 [完整校验日志](output/playwright/archive-density/verification.log)。

## 2026-11-15 — 已看资讯卡片移除

- 标记已看后同步更新 SIGNAL FEED，展示池排除已看条目；换批、重载与后台更新继续沿用这一筛选。已看记录保留在归档中，取消归档或从阅读队列重新打开后恢复显示，保持其余未看条目的会话顺序。
- 复用原有卡片退场与增量更新。修复图片缓存命中后空 `class` 属性影响节点比较的问题，避免移除卡片时重建其余已解码的图片。
- 新增 `tests/suites/summary-seen.mjs` 并注册到统一测试，覆盖已看筛选、分页、归档数据可用性、恢复与空态；扩展卡片复用回归覆盖缓存命中留下的空类属性。最终 `scripts/verify-extension.ps1` 完整通过，退出码 0；首次沙箱运行遇到合成临时文件重命名权限限制，常规环境最终检查通过。
- 隔离 Chrome 加载真实首页与合成数据，验证深色 1280×800 的键盘标记、队列移除、归档保留、图片节点复用、刷新、换批和右键取消归档，以及浅色 390×844 的快速标记、全部已读、运行时重新打开、减少动态效果、全已看空态与后台更新。无横向溢出、页面或控制台错误，已查看两张截图；未操作用户安装实例。证据：[主要交互检查](output/playwright/seen-card-removal/browser-check.log)、[关联状态检查](output/playwright/seen-card-removal/edge-check.log)、[最终完整校验](output/playwright/seen-card-removal/verification-final.log)、[截图](output/playwright/seen-card-removal/)。

## 2026-11-15 — 搜索中隐藏未配置的 AI 入口

- 统一搜索仅在 AI 问答可用时生成提问行，未配置时不再显示“配置 AI 后提问”或占位；空输入、已有查询和设置更新遵循同一规则，Bot 接管问答时保留入口。
- 扩展既有统一搜索回归，覆盖未配置／配置后的查询、空列表折叠、配置切换和 Bot 接管。定向检查及 `scripts/verify-extension.ps1` 完整通过；首次沙盒校验因临时文件重命名 EPERM 中止，最终在沙盒外完成。见 [完整校验](output/playwright/search-ai-visibility/verification-final.log)。
- 隔离 Chromium 使用真实搜索面板、控制器与合成数据，检查深浅主题 × 1280×800／390×844、三语、配置切换、空／加载／错误状态、历史授权入口、Bot 提问、键盘选择与焦点恢复、减少动态效果和溢出，均通过，无页面／控制台错误或外部请求。已查看桌面深色与窄屏浅色截图，确认无残留空行；未操作用户安装实例。证据：[浏览器检查](output/playwright/search-ai-visibility/browser-check.log)、[截图](output/playwright/search-ai-visibility/)。

## 2026-11-15 — 已看归档纯标题列表

- 已看条目仅显示带删除线的标题，使用常规字重与次级文字颜色；移除条目网站图标、来源小字和常驻已读按钮。保留与其他卡片一致的外框、阴影、圆角、标题栏勾号和卡位尺寸，不显示数量、不折叠内容。右侧三个点菜单仅提供“清空归档”并保留确认；取消归档和切换卡片保留在右键菜单，简繁英文案同步。
- 归档回归覆盖保留记录、新闻／书签原始目标、键盘打开、取消归档、重复卡片的稳定菜单入口、清空确认／取消及并发确认保护；菜单回归验证三个点不继承切换卡片，并保留右键切换及焦点恢复。最终 `scripts/verify-extension.ps1` 完整通过，退出码 0，见 [完整校验](output/playwright/archive-minimal/verification-final.log)。
- 隔离 Chromium 使用真实卡片、已读状态和菜单控制器及合成内容，完成深浅主题 × 1280×800／390×844 的大小卡位检查；覆盖三语菜单、无数量、删除线、标题图标、打开条目、移除、清空／取消、空状态、长列表滚动、键盘焦点与无横向溢出。实际计算样式确认卡片外框及标题栏与其他卡片一致，普通动效退出清理、减少动态效果及触屏 44px 条目点击范围通过，无页面或控制台错误。已查看桌面深色、窄屏浅色和仅清空菜单截图；未操作用户安装实例。证据：[界面检查](output/playwright/archive-minimal/browser-check.log)、[触屏与动效](output/playwright/archive-minimal/touch-motion-check.log)、[截图](output/playwright/archive-minimal/)。

## 2026-11-15 — 导航自动隐藏

- 外观新增默认关闭的“自动隐藏导航”，与首页模糊效果、鼠标跟随光效同组；原“视觉效果”改为“显示与交互”，简中、繁中、英文同步。闲置约 1.2 秒后完全隐藏，无指示条；对应边缘保留透明的鼠标／触屏唤出区域，键盘进入导航时恢复显示。显隐采用 300ms 淡化、420ms 轻移，支持中途反向与减少动态效果。
- 复用外观预览、保存、放弃和设置同步／导入导出路径，新增逻辑仅在开启时加载。设置事务、默认值、导入兼容、跨页通知和隐藏计时／悬停／按压／键盘保护有定向回归；完整校验通过。整页合成预览验证过保存、刷新恢复与放弃修改。
- 最终分组的三语、深浅主题、桌面／窄屏以及导航触屏唤出、键盘焦点和减少动态效果通过真实导航／外观控制器的组件预览检查；逐帧显隐保持单调，隐藏中途唤出没有位移跳变。整页合成夹具后续出现初始化挂起，关闭自动隐藏的对照也复现，因此最终浏览器检查限定于相关组件；未操作用户安装实例，未将夹具问题判定为产品缺陷。
- 位置检查覆盖四个方向、深浅主题、1440×1000／1280×800 及 390×844，完全隐藏和边缘唤出通过，无横向溢出。证据：[位置与主题](output/playwright/navigation-auto-hide/final-layout-results.json)、[设置与交互](output/playwright/navigation-auto-hide/final-interaction-results.json)、[逐帧显隐](output/playwright/navigation-auto-hide/final-motion-results.json)、[截图](output/playwright/navigation-auto-hide/)、[完整校验](output/playwright/navigation-auto-hide/verification.log)。

## 2026-11-14 — 今日简报右键复制

- 今日简报的右键菜单在“切换卡片”前提供“复制简报”，适用于任意卡片位置。复制当前展示的正文段落，Bot 简报保留完整 Markdown；刷新时仍可复制旧正文，空内容、首次加载和错误提示不提供复制项。复用现有剪贴板工具与菜单，简繁英文案同步。
- 扩展 `tests/suites/digest-refresh.mjs`，覆盖正文格式、Bot 完整段落、刷新期间复制、最新内容、三语、卡片类型切换与空状态。最终 `scripts/verify-extension.ps1` 通过，统一测试、模块语法、导入、资产与安全检查完成；沙盒临时文件重命名曾受限，最终校验在沙盒外运行。
- 隔离 Chromium 使用真实效率卡片和菜单控制器及合成内容，完成深浅主题 × 1280×800／390×844、三语、普通／Bot 简报、大小位置的 48 次复制，加上刷新与键盘复制共 50 次。检查 Shift+F10、Enter、Escape 焦点恢复、空／加载／错误状态、菜单边界、减少动态效果和来源链接原生菜单，均通过，无页面或控制台错误；已查看桌面深色与窄屏浅色菜单截图。测试拦截剪贴板写入核对内容，未覆盖系统剪贴板或操作用户安装实例。证据：[浏览器摘要](output/playwright/digest-copy/browser-summary.log)、[交互检查](output/playwright/digest-copy/browser-check.log)、[完整校验](output/playwright/digest-copy/verification.log)、[截图](output/playwright/digest-copy/)。

## 2026-11-14 — 天气右键切换城市

- 天气卡片右键菜单在“切换卡片”前提供“切换城市”，复用已有城市搜索、授权、保存和天气刷新流程；标题栏城市入口继续可用。重复打开编辑器保留当前输入、搜索和结果。简繁英菜单文案同步。
- 新增 `tests/suites/weather-city-menu.mjs` 并接入统一测试入口，覆盖三语入口、焦点、草稿保留、搜索中重复打开、城市保存与刷新、拒绝授权及离开卡片后的过期结果；与天气服务、共享天气状态、右键菜单及客户端多语言回归分别通过，变更的前端模块语法检查通过。
- 隔离 Chromium 使用真实卡片、天气状态与菜单控制器及合成数据，检查深浅主题 × 1280×800／390×844 的大小卡片；覆盖搜索选择、同类卡片更新、刷新保留、三语、Shift+F10／Enter、输入框原生菜单、加载／错误／空结果／拒绝授权、减少动态效果及溢出。均通过，无页面或控制台错误，已查看桌面深色、窄屏浅色菜单和编辑器截图；未操作用户安装实例。证据见 [浏览器检查](output/playwright/weather-city-menu/browser-check.log)、[定向回归](output/playwright/weather-city-menu/focused-tests.log) 和 [截图](output/playwright/weather-city-menu/)。
- `scripts/verify-extension.ps1` 已执行，但当前工作区的 service worker 静态依赖为 885141 字节，超出既有 864 KiB 预算 405 字节，统一检查在该断言处停止。本次修改不涉及该后台依赖图，未更改预算或无关后台代码；不将定向检查记为完整校验通过。记录见 [完整校验日志](output/playwright/weather-city-menu/verification.log)。

## 2026-11-14 — 默认卡片类型排列

- 默认左侧从上到下为天气预报、今日简报、待办事项，右侧为今日资讯、今日灵感、阅读队列；复用既有网格与断点。保留已保存的类型、旧版工具卡选择和拖动顺序，待办快捷键定位左下卡片。
- 默认值、无效配置回退、旧配置保留及待办定位的针对性测试通过。隔离 Chrome 使用真实首页和合成数据完成深浅主题 × 1280×800、1440×1000、390×844 检查；桌面列对齐、窄屏顺序、天气加载／错误／正常、空态、减少动态效果、键盘新增待办及刷新保存均通过，无横向溢出或页面／控制台错误。已查看桌面深色与窄屏浅色截图，未操作用户安装实例。
- 完整验证未通过：工作区并行改动期间首次停在服务 worker 的 864 KiB 预算（884,768 字节），最近一次停在首页的 768 KiB 预算（789,224 字节）；本次两个默认字符串合计减少 2 字节，未修改预算或其他功能。证据：[针对性测试](output/playwright/default-card-types/focused-tests.log)、[浏览器检查](output/playwright/default-card-types/browser-check.log)、[保存恢复](output/playwright/default-card-types/persistence-check.log)、[最近完整校验](output/playwright/default-card-types/verification.log)、[截图](output/playwright/default-card-types/)。

## 2026-11-14 — 常规控件按压统一

- 常规文字按钮、图标、开关、分段选项、下拉、菜单、折叠入口和快捷网站统一为 100ms 轻压、180ms 平稳复位；按控件尺寸区分缩放幅度。保留导航短按及换批／返回顶部的专用反馈，移除资讯操作按钮另行叠加的回弹。工具栏“稍后读”弹窗复用相同规则。
- 统一事件委托支持动态控件、鼠标、触摸、空格和 Enter；移出、手势取消、拖动、失焦和切到后台时释放，不阻断原操作。禁用、加载和减少动态效果不压缩。分段指示条与下拉列表使用未缩放的布局尺寸，定位按钮的原有 transform 保持有效。
- 隔离 Chromium 使用真实首页／设置控制器与合成数据，完成深浅主题 × 1280×800、1440×1000、390×844 检查；覆盖普通／图标／长行／开关、键盘焦点、禁用、加载、减少动态效果、分段指示条、下拉定位及横向溢出。动态组件补查菜单、折叠入口、日期按钮、复制、连续快按、即时点击响应、中途禁用与减少动态效果、触摸按下及取消；工具栏弹窗以真实 HTML 和共享样式检查深浅主题、Enter 与右键。均通过，无页面或控制台错误，已查看桌面、窄屏和弹窗截图。未操作用户安装实例。
- `tests/suites/control-feedback.mjs` 覆盖委托、取消、键盘、焦点切换、禁用及监听清理；分段控件回归覆盖按压期间布局尺寸与滚动定位。最终 `scripts/verify-extension.ps1` 完整通过，退出码 0。证据：[界面检查](output/playwright/control-press/browser-check.log)、[手势与动态控件](output/playwright/control-press/interaction-check.log)、[弹窗检查](output/playwright/control-press/popup-check.log)、[完整校验](output/playwright/control-press/verification.log)、[截图](output/playwright/control-press/)。

## 2026-11-14 — 入门比例、图标与授权门槛

- 按已确认方案调整为 560px 单栏面板，使用等高独立来源行、单列图标和简洁的 `1 / 2` 进度。隐藏单选圆点但保留原生单选、方向键和整行焦点；返回入口位于第二步顶部。底部仅保留右侧主要操作，删除“稍后设置”和“暂不授权”。
- 首次设置在所有看板模式下都须完成所选来源授权；Escape 在第一步保持引导打开，在第二步返回来源选择。授权被拒绝或复核未通过时停留并提供重试提示。后台完成入口再次检查来源权限及个人书签同意，拒绝未授权的直接完成请求；选择内置内容仍不隐含书签同意。三语提示、隐私说明和商店审核说明已同步。
- 使用真实入门控制器、共享样式和下拉组件的隔离 Chromium 合成预览，覆盖简繁英、深浅主题、1280×800／390×844，以及来源明细、书签同意、读取失败、文件夹选择、空文件夹、返回、拒绝授权及重试等 40 个状态。检查了键盘循环、无跳过入口、Escape 无法完成、等高行、单按钮操作区、减少动态效果、溢出与页面/控制台错误；均通过，并查看了桌面与窄屏截图。未操作用户安装实例。
- 来源授权、撤权后完成失败及书签同意边界的回归已补充到 `tests/suites/onboarding.mjs`；最终 `scripts/verify-extension.ps1` 完整通过，退出码 0。初次沙箱运行遇到合成 MCP 临时文件重命名限制，最终在常规环境验证。证据见 [交互记录](output/playwright/onboarding-ui/results.json)、[完整校验](output/playwright/onboarding-ui/verification-final.log) 和 [界面截图](output/playwright/onboarding-ui/zh-CN-dark-1280-preset.png)。

## 2026-11-14 — 资讯图片悬停缩放

- 资讯摘要卡片悬停时图片或无图状态的模糊网站图标放大至 103%，以 420ms 共用标准曲线过渡，移出平滑恢复；保留原有模糊、图标基础变换、卡片尺寸、正文位置、遮罩和裁切。触屏与减少动态效果模式保持原尺寸。
- 隔离 Chromium 使用真实资讯视图与合成内容，深浅主题 × 1280×800／390×844 的进入、移出、快速反向、键盘焦点与溢出检查通过；逐帧确认缩放连续且正文及卡片几何稳定。图片加载显隐及实际触摸上下文检查通过；新增无图卡片检查确认相同缩放曲线、原有 22px 模糊与基础变换保持不变，键盘、触屏和减少动态效果正常。无页面或控制台错误，已查看图片及无图状态的桌面深色与窄屏浅色截图；未操作用户安装实例。证据见 [图片检查](output/playwright/news-image-hover/browser-check.log)、[模糊图标检查](output/playwright/news-image-hover/fallback-browser-check.log)、[截图](output/playwright/news-image-hover/)。

- `scripts/verify-extension.ps1` 完整通过，退出码 0；日志见 [完整校验](output/playwright/news-image-hover/fallback-verification.log)。

## 2026-11-14 — 公共来源的首页书签默认关闭

- 新配置和首次引导选择公共来源时，“在首页显示书签”默认关闭；设置中从书签来源切换到公共来源也取消勾选，保存后隐藏首页书签区及导航入口。开关仍可手动开启，已保存的显式开关值继续保留；书签来源缺少此字段时仍默认开启。
- 设置归一化、引导选择、来源切换和同步存储回归已覆盖。`scripts/verify-extension.ps1` 完整通过，退出码 0；首次沙箱运行被合成 MCP 临时文件重命名权限阻断，常规环境重跑通过。
- 隔离 Chrome 合成预览使用真实设置、书签和导航控制器，检查默认关闭、键盘开启、保存/重载、切换公共来源及放弃修改恢复；均通过，无页面或控制台错误、无横向溢出，已查看默认关闭状态截图。本次只改默认值与交互行为，未变更布局或样式，未操作用户安装实例。证据见 [检查记录](output/playwright/public-source-bookmark-default/results.json)、[截图](output/playwright/public-source-bookmark-default/public-default-off.png) 和 [完整校验](output/playwright/public-source-bookmark-default/verification-final.log)。

## 2026-11-14 — 设置资讯与 AI 图标

- 设置侧栏“资讯”使用同系列的 Material Symbols Rounded 报纸图标，AI 使用已有星芒图标；沿用共享尺寸、主题滤镜及装饰图标语义。新增 SVG 来自现有第三方声明记录的固定修订，保留来源注释。
- 合成数据的隔离 Chromium 预览覆盖深浅主题 × 1280×800／390×844，两个入口的选中态、图标加载和尺寸、键盘焦点、减少动态效果、横向溢出及控制台检查通过；已查看桌面及窄屏截图。最终代码的完整验证通过，退出码 0。未操作用户安装实例。截图、预览脚本及日志位于 [验证目录](output/playwright/settings-news-icon/)；初次沙箱验证受临时文件重命名权限阻断，常规环境验证通过。

## 2026-11-14 — 设置分段控件首次定位

- 颜色模式、导航位置、头图样式和标题透明度在首次显示、切回外观页和重新打开设置时直接定位到当前值；后续点击选项保留原有滑动过渡。共用控件在隐藏时清除动画就绪状态，首次可见时先提交位置再允许切换动画。
- 隔离 Chromium 使用真实设置与外观控制器及合成数据，逐帧复现旧版本从左端滑入，再检查修复后的深浅主题 × 1280×800／390×844。四组控件从首帧就位、点击滑动、重开与返回、键盘焦点、减少动态效果、溢出和控制台检查通过；已查看桌面深色及窄屏浅色截图。未操作用户安装实例。检查脚本、截图及日志位于 [验证目录](output/playwright/segmented-initial-position/)。
- 自动化覆盖首次可见、隐藏后重开、手动切换、显式静态定位和滚动坐标；设置导航回归覆盖进入外观页时四组控件均禁用过渡。`scripts/verify-extension.ps1` 完整通过，退出码 0；首次沙箱运行被合成 MCP 测试的临时文件重命名权限阻断，常规环境重跑通过，日志均保存在上述目录。

## 2026-11-14 — 随手记列表行左右留白

- 随手记列表行左右内边距统一为 12px；小卡通过 `padding-block` 保留上下 6px，避免原先的简写把左右留白覆盖为 3px。大卡保留上下 8px，正文与日期均从高亮背景边缘向内留出空间。
- 隔离 Chromium 中以合成记录检查大小卡位、深浅主题和 1280／390px，正文左侧及日期右侧实际留白均为 12px，无横向溢出；键盘焦点、Enter 打开编辑、Escape 返回及控制台检查通过，并查看深浅主题截图。`scripts/verify-extension.ps1` 完整通过，退出码 0。截图与校验日志位于 `output/playwright/notes-padding-20261114/`。

本文件只保留当前回归范围、仍适用的验证证据和未闭环事项。已替换的设计、旧发行快照及重复的过程日志不再累积；历史实现查 Git，清理前的工作区记录保存在 `output/qa-cleanup-20261114/`。

架构、权限和验证要求以 [AGENTS.md](AGENTS.md) 为准；界面细节以 [UI 设计规范](ui-design-system.md) 和 [文案规范](copy-guidelines.md) 为准，避免在 QA 中维护另一套尺寸、版本或功能数量。

## 验证入口与范围

- 仅维护说明或内部记录变更：核对差异、事实和相关链接。
- 代码、配置、本地化、公开文档或商店材料变更：运行一次完整验证；通过后，仅因后续改动、失败或未解决的问题补充检查。
- 策略、存储、权限、解析、运行时和 UI 模型行为变更：补充相关 `tests/suites/` 覆盖，并注册到统一入口。

```powershell
.\scripts\verify-extension.ps1
```

完整入口包含统一测试、ESM 语法、本地依赖与资源、Manifest/CSP、语言目录及项目约束检查。静态启动体积以架构测试中的现行预算为准，不把历史源文件字节数当成启动耗时或内存指标。

| 回归区域 | 需要保留的行为 | 主要自动化入口 |
| --- | --- | --- |
| 消息与架构 | 请求关联、迟到响应保护、权限与刷新代次、串行写入、本地代码和依赖方向 | [统一测试](tests/extension.mjs)、[架构](tests/suites/architecture.mjs)、[API 路由](tests/suites/api-routing.mjs) |
| 权限与隐私 | 工具栏只捕获用户点击页面的标题与 URL；书签只读；网站按精确来源授权；历史搜索按查询使用、撤权失效且不持久化或传给 AI | [Manifest 安全](tests/suites/manifest-security.mjs)、[权限状态](tests/suites/permission-state.mjs)、[统一搜索](tests/suites/unified-search.mjs) |
| 设置与凭据 | 三语一致、草稿与错误恢复、密钥不回显或导出；凭据同步独立且默认关闭；新设备重新授权 | [设置迁移](tests/suites/settings-transfer.mjs)、[设置导航](tests/suites/settings-navigation.mjs)、[客户端语言](tests/suites/client-i18n.mjs) |
| 个人内容同步 | 分类独立且默认关闭；开启总开关不自动全选；版本合并、删除保护、配额失败保留本机数据，关闭类别只清理其同步副本 | [内容同步](tests/suites/content-sync.mjs)、[同步控件](tests/suites/content-sync-settings.mjs)、[主题追踪同步](tests/suites/tracked-topics-sync.mjs)、[日历同步](tests/suites/calendar-sync.mjs)、[随手记与时钟](tests/suites/notes-world-clock.mjs) |
| 引导与来源 | 两步引导、明确同意后读取书签、所选来源授权后完成、拒绝授权保留引导、精确来源与受支持的网站图标合并授权、RSS 校验和失败恢复 | [引导](tests/suites/onboarding.mjs)、[公共来源](tests/suites/public-feeds.mjs)、[自定义 RSS](tests/suites/custom-feeds.mjs) |
| 搜索与研究 | URL/书签/历史优先级，收藏夹和联网范围隔离，正文相关性与日期过滤，有限证据回答、取消和引用校验 | [统一搜索](tests/suites/unified-search.mjs)、[研究搜索](tests/suites/research-search.mjs) |
| 资讯与图片 | 转载去重但保留事件状态与数字差异；排序稳定；更新内容时保留未改变的图片节点 | [今日新闻](tests/suites/today-news.mjs)、[资讯整理](tests/suites/news-organization.mjs)、[图片稳定](tests/suites/summary-image-stability.mjs)、[今日视图](tests/suites/daily-view.mjs) |
| AI 与 MCP | 服务商切换保留草稿，旧配置可编辑；请求参数与流式恢复；实际进度、额度、错误和接管状态一致 | [服务商预设](tests/suites/ai-provider-presets.mjs)、[流式请求](tests/suites/ai-stream.mjs)、[状态视图](tests/suites/status-view.mjs)、[Bot 接管](tests/suites/bot-takeover.mjs) |
| 卡片与个人记录 | 类型以当前分组表为准；浮窗从卡位展开并收回，连续反向、模态隔离及焦点恢复正确；重复类型共享内容、实例保留草稿；跨页版本冲突不能覆盖新内容 | [卡片类型](tests/suites/dashboard-card-types.mjs)、[类型选择器](tests/suites/utility-card-picker.mjs)、[布局](tests/suites/dashboard-layout.mjs)、[个人卡片](tests/suites/personal-cards.mjs)、[日历](tests/suites/calendar.mjs)、[随手记与时钟](tests/suites/notes-world-clock.mjs) |
| 书签与外观 | 主/子分类筛选和自然高度；头图图片/视频、填充、预览/放弃/保存；标题透明度及旧值归一化 | [书签筛选](tests/suites/bookmark-filters.mjs)、[头图](tests/suites/header-cover.mjs)、[本地媒体](tests/suites/header-cover-media.mjs)、[填充方式](tests/suites/header-cover-fit.mjs)、[标题透明度](tests/suites/title-opacity.mjs) |
| 天气与行情 | 大小卡片的预报范围、缺失读数、缓存失效和离线回退；行情解析、授权和自选列表 | [天气卡片](tests/suites/weather-utility.mjs)、[股票](tests/suites/stocks.mjs) |

## 浏览器与发布检查

- UI 局部变更覆盖受影响的主题、尺寸和状态，检查焦点、减少动态效果、溢出和控制台。全局布局、主题、共享令牌或断点变更覆盖深浅主题 × `1280×800`、`1440×1000`、窄屏，并检查加载、空和错误状态。
- 使用生产页面或安全组件预览；卡片尺寸相关变更必须回到真实首页卡位验证。专注卡片需覆盖用户反馈对应的宽屏和显示比例，不能只用固定高度夹具。
- 使用合成数据及隔离浏览器配置。区分组件预览、实际加载未打包扩展和用户安装实例的人工验收；截图与日志保存到 `output/playwright/`。
- 不读取、截图或打包真实密钥、私人书签、用户浏览器资料和运行缓存；旧 `dashboard-cache/` 不参与检查、迁移、删除或打包。
- 发布仍执行 [Chrome 清单](store/submission-checklist.md) 与 [Edge 清单](store/edge-submission-checklist.md)。旧版本的勾选、包审计和截图不自动覆盖当前待发布代码。

```powershell
$env:REQUIRED_SUPPORT_URL = "https://github.com/sunpanran/Ampira/issues"
.\scripts\verify-extension.ps1 -Package
```

版本取自 `manifest.json`。核对 ZIP 根目录 Manifest、SHA-256 和发布清单，以及文件允许列表、隐私与三语披露；确认公开支持、隐私和删除页面可访问。不手改 `dist/` 生成物。

## 近期仍适用的验证证据

以下记录各功能最近一次适用的检查结论。每项结论只覆盖对应功能与当时状态；后续改动应替换相应记录，不能用某次局部通过代表当前整个工作区或完整发行验收。

### 2026-11-14

| 区域 | 保留的验证结论与边界 | 证据 |
| --- | --- | --- |
| 首屏导航入场与书签显隐 | 导航在书签显隐确定后以最终尺寸入场，采用 300ms 渐显与 420ms 移动曲线归位；图标在 HTML 中直接引用本地资源。复现并修复关闭书签后入场高度缩减、居中位置跳动；无缓存时复用一次设置存储读取，迟到响应不覆盖已应用设置，读取失败保留设置流程回退。导航与标题各自结束清理。完整校验通过；隔离 Chromium 合成首页完成深浅主题 × 1280×800、1440×1000、390×844 × 书签开关检查，可见帧宽高变化小于 0.1px，无透明度反向、横向溢出、页面或控制台错误。冷启动、慢设置/样式、设置/数据错误、空态、四个位置、减少动态效果及中途切换通过；查看深浅主题中间帧，玻璃模糊、键盘焦点、入场期间设置打开与 Escape 关闭正常。未执行用户安装实例人工验收或真实设备帧率测量 | [逐帧与主题检查](output/playwright/nav-entrance/browser-check.log)、[冷启动与交互检查](output/playwright/nav-entrance/edge-check.log)、[截图](output/playwright/nav-entrance/)、[行为回归](tests/suites/first-frame-motion.mjs)、[完整校验](output/playwright/nav-entrance/verification.log) |
| 首屏标题与内容入场 | 标题、快捷栏和可见卡片统一为 240ms 渐显与 420ms 轻移，卡片按屏幕位置错峰；屏幕外卡片跳过入场。首屏时钟由实际 CSS 播放建立，结束事件清理，修复样式慢加载时动画提前消失；隐藏页面或中途开启减少动态效果会取消卡片动画并释放临时合成提示。完整校验通过。真实首页与合成接口在隔离 Chromium 中完成深浅主题 × 1280×800、1440×1000、390×844 检查，覆盖逐帧透明度／位移连续、慢样式和慢数据、换位、空／错误状态、键盘焦点、溢出和效果清理；全屏背景下查看深浅主题中间帧，玻璃模糊保留。无页面或控制台错误。未执行用户安装实例人工验收或真实设备帧率测量 | [浏览器检查](output/playwright/first-frame-motion/browser-check.log)、[背景与交互检查](output/playwright/first-frame-motion/interaction-check.log)、[截图](output/playwright/first-frame-motion/)、[行为回归](tests/suites/first-frame-motion.mjs)、[完整校验](output/playwright/first-frame-motion/verification.log) |
| 网站权限与来源状态列表 | 授权行两侧留白加宽，来源状态条与设置分类指示条同为 3px。完整校验通过；实际渲染器与合成数据在隔离 Chromium 中完成简中／英文、深浅主题、1280×800 与 390×844 检查，覆盖授权／撤销按钮布局、长域名、长短列表及空状态、各来源状态、滚动、键盘焦点、减少动态效果和横向溢出；修正旧预览夹具后无页面或控制台错误。未执行用户安装实例人工验收 | [浏览器检查](output/playwright/source-list-spacing/browser-check.log)、[截图](output/playwright/source-list-spacing/)、[完整校验](output/playwright/source-list-spacing/verification.log) |
| 设置按钮图标 | 移除测试、测试图片搜索、移除搜图密钥、清除个性偏好、重置今日额度、恢复出厂设置、清除列表和一键屏蔽的图标；服务商改用本地服务器图标。合成设置预览在三语、深浅主题和 1280／390px 下检查文字居中、图标加载、禁用与可用状态、键盘焦点及减少动态效果，通过且无横向溢出或页面／控制台错误。已查看局部截图，完整校验通过；未执行用户安装实例人工验收 | [局部截图与浏览器检查](output/playwright/settings-button-icons/)、[完整校验](output/playwright/settings-button-icons/verification.log) |
| 资讯内容更新与分批刷新 | 原文、修改时间与事件相关报道参与摘要、翻译及简报缓存判断；订阅正文与短摘录分开保存，正文上限 12,000 字符，内置卡片整理输入上限 6,000 字符。每轮最多补读八篇同域已授权短文，每源最多两篇；复用 Reader 正文提取，补读材料随资讯缓存清理。首个来源立即提交，后续四源或 400ms 合并，文字先于补图显示；未变化的补充正文与图片复用。完整验证通过，包含更新失效、304、失败保留、撤权、取消、迟到图片与正文补读集成回归。隔离 Chromium 在 1280×800、正常和减少动态效果下验证分批呈现、卡片顺序、真实焦点保留与溢出通过，无页面或控制台错误；使用合成数据，未做用户安装实例或真实站点覆盖率验收。服务 worker 静态源码预算由 850 调整至 864 KiB，新增三模块另限 6 KiB；不是启动耗时测量 | [行为回归](tests/suites/news-refresh-upgrade.mjs)、[浏览器结果](output/playwright/news-upgrade/results.json)、[首批文字](output/playwright/news-upgrade/first-text.png)、[补图完成](output/playwright/news-upgrade/complete.png)、[完整校验](output/news-pipeline-upgrade/verification.log) |
| 设置分类指示条 | 同一根指示条以 240ms 移动曲线切换位置，桌面上下滑动、窄屏左右滑动；首次打开和布局变化直接就位。完整校验通过。实际控制器与合成数据在隔离 Chromium 中完成深浅主题 × 1280×800、390×844 逐帧检查，覆盖双向切换、连续反向、短窗口侧栏滚动、跨断点缩放、三语标签宽度变化、键盘焦点、减少动态效果及强制颜色；无页面或控制台错误。未执行用户安装实例人工验收 | [逐帧与状态检查](output/playwright/settings-indicator-motion/results.json)、[截图与检查脚本](output/playwright/settings-indicator-motion/)、[完整校验](output/playwright/settings-indicator-motion/verification.log) |
| 按钮按压反馈 | “换一换”和 Ampira 标志共用按住压缩、420ms 衰减回弹，连续按压从当前姿态接续；五个导航按钮独立使用 100ms 轻压与 180ms 平稳归位，没有过冲。完整校验通过。隔离 Chromium 的深浅主题、1440×1000 和 390×844 检查通过，覆盖按住、连点、取消、Space/Enter、焦点、减少动态效果、禁用状态、溢出与效果清理；原生触摸事件验证轻点和取消手势，不改变点击次数。截图使用合成内容，未执行用户安装实例人工验收 | [弹性按钮](output/playwright/shuffle-feel/results.json)、[五个导航按钮](output/playwright/shuffle-feel/navigation-results.json)、[触摸检查](output/playwright/shuffle-feel/touch-results.json)、[完整校验](output/playwright/shuffle-feel/verification.log) |
| 所有“换一换”动效 | 今日资讯、今日灵感和资讯页统一为 240ms 同步交叉淡化，图文作为完整画面切换。完整校验通过。隔离 Chromium 的深浅主题 × 1280×800、1440×1000、390×844 检查通过；逐帧透明度互补且无延迟入场，可见图片在解码后参与首帧；实际鼠标连点保持当前帧并合并为最新后续批次。同类卡片同步、滚动裁切、按钮焦点、快速跨栏目操作、减少动态效果、空状态和既有客户端 DOM 回归通过。未执行用户安装实例人工验收 | [逐帧检查](output/playwright/batch-motion/results.json)、[连点与回归](output/playwright/batch-motion/continuous-results.json)、[完整校验](output/playwright/batch-motion/verification.log)、[合成首页夹具](tests/browser/batch-motion.html) |
| 卡片类型浮窗 | 完整校验通过。三语、深浅主题、大小卡片及首页六卡位换位检查通过，保留草稿、单次保存、焦点、键盘、短窗口滚动及强制颜色回归。动效专项在实际首页的桌面与窄屏逐帧验证原卡片交叉淡化、文字错开显隐、收尾接续及中途反向：收回结束前原卡片已可见，位置和各层透明度无反向跳变，减少动态效果即时完成。隔离 Chromium 与合成内容检查无页面或控制台错误，未执行用户安装实例人工验收 | [组件检查](output/playwright/card-picker-floating/results.json)、[首页卡位](output/playwright/card-picker-floating/homepage-results.json)、[动效逐帧](output/playwright/card-picker-motion/results.json)、[完整校验](output/playwright/card-picker-motion/verification.log) |
| 设置与搜索窗口动效 | 两个窗口统一为 8px 轻移、300ms 平稳归位与 180ms 渐显；设置遮罩独立淡入，搜索页面遮罩继续不模糊。实际控制器与合成数据在深浅主题、1280×800 和 390×844 下逐帧检查开合与快速反向通过，位置和透明度无跳变，旧关闭计时器不影响复开。设置首次打开不叠加页签动画；头图临时预览、加载/错误、溢出、键盘、减少动态效果与强制颜色回退通过。搜索结果展开与焦点恢复通过；减少动态效果下的自动输入焦点已修复并单独复核。完整校验通过；未执行用户安装实例人工验收 | [设置检查](output/playwright/settings-motion/browser-check.log)、[搜索逐帧](output/playwright/settings-motion/search-results.json)、[减少动态效果](output/playwright/settings-motion/reduced-focus.json)、[完整校验](output/playwright/settings-motion/verification.log) |
| 搜索图标 | 深浅主题、桌面与窄屏下保持中性色；输入、结果及焦点切换通过 | [图标检查](output/playwright/search-icon-neutral-20261114/) |
| 随手记与世界时钟 | 隔离扩展验证保存恢复、编辑冲突、置顶、转待办、城市增删和独立同步开关；三语、大小卡片、错误重试与时区回归通过。未做真实双设备账户同步 | [记录与时钟](output/playwright/notes-world-clock-20261114/) |
| 随手记与时钟操作 | 图钉、实际取消弹窗、文字保存按钮、成功返回列表及失败保留输入通过；世界时钟点击/键盘更换城市、右键删除、最后一项删除后恢复本地时间入口、并发版本和同步传播通过。卡片选择器旧夹具更新后，该轮完整校验通过 | [交互调整](output/playwright/notes-clock-polish-20261114/) |
| 主题追踪 | 内容按时间倒序展示，旧未读偏好及已读状态不隐藏条目，不感兴趣内容仍排除；规则编辑与跨页更新通过。同步开关默认关闭、独立保存，规则合并及删除保护有合成回归 | [内容视图](output/playwright/topics-content-direct-20261114/)、[同步](output/playwright/topics-sync-20261114/) |
| 专注计时 | 持久化恢复、暂停、跨午夜统计及跨页并发有回归。小卡居中布局沿用真实宽屏间距修正；大卡留白与分段控件内外圆角分别通过实际首页检查 | [功能](output/playwright/focus-topics-20261114/)、[小卡间距](output/playwright/focus-actual-spacing-20261114/)、[大卡留白](output/playwright/focus-large-spacing-20261114/)、[圆角](output/playwright/focus-mode-corners-20261114/) |
| 日历 | 月历、编辑、草稿保护、冲突、删除、重试及三语大小卡片通过；独立且默认关闭的同步覆盖上传字段、远端修改/删除、配额失败及本机保留。小卡日期和文字以整卡中线居中，较矮位置自动保留日期空间；隔离扩展真实首页宽屏/窄屏与深浅主题组件检查通过，覆盖空/长日程、滚动、焦点、编辑及错误恢复。完整校验通过 | [日历](output/playwright/calendar-implementation/)、[同步](output/playwright/calendar-sync/)、[居中检查](output/playwright/calendar-centering/) |
| 天气 | 未设置城市时简繁中文使用北京、英文使用伦敦；切换语言更新默认城市，显式城市不覆盖，默认值不写入存储或同步。临时错误至少间隔一分钟重试，页面可见且有天气卡片时定时恢复，联网事件可立即重试；权限错误仍等待用户授权。请求超时延长至 15 秒并单独提示，保留同日有效缓存回退。天气状态按需加载，启动体积预算及完整校验通过。隔离 Chromium 的三语、深色 1280×800／浅色 390×844、大小卡片、键盘编辑、城市保存、语言切换、拒绝授权与重试、减少动态效果、共享请求和实际首页联网事件恢复通过，无横向溢出及页面／控制台错误；界面使用合成数据，已查看截图。真实北京接口在该浏览器本次返回 200、约 0.9 秒；命令行直连超时不能代表浏览器路径，也不能据此判定截图发生时的网络原因。未操作用户安装实例。原小卡两天／大卡五天及缺失读数回退保持原行为 | [默认城市与恢复检查](output/playwright/weather-default/browser-check.log)、[首页集成检查](output/playwright/weather-default/integration-check.log)、[接口复核](output/playwright/weather-default/network-check.log)、[完整校验](output/playwright/weather-default/verification.log)、[原天气大卡](output/playwright/weather-large/) |
| 自定义 RSS | 预览、添加、改名、停用、删除、重复/不安全地址、拒绝授权、无效响应与迟到响应通过；使用实际解析器，权限由适配器模拟 | [RSS 检查](output/playwright/rss/)、[可复用夹具](tests/browser/custom-feeds.html) |
| AI 服务商与配置 | 精简服务商列表、旧服务自定义回退、配置草稿、只读预设地址、本地模型无密钥布局及授权状态通过。操作顺序改为“测试 → 服务商 → 配置”；合成浏览器预览的三语、深浅主题、1280／390px、正反向键盘焦点、测试按钮启用／禁用及溢出检查通过，控制台无错误；完整校验通过。模型参数使用合成响应验证，未调用真实服务 | [服务商列表](output/playwright/provider-picker-20261114/)、[配置区](output/playwright/provider-configuration-20261114/)、[按钮顺序](output/playwright/ai-provider-button-order/) |
| 运行概览 | 用量与自动整理状态合组、缓存独立，操作跟随对应状态；额度边界、长错误、缺权限、加载和减少动态效果通过。正常状态不再保留 AI 服务常驻标题 | [概览](output/playwright/runtime-overview-20261114/)、[标题清理](output/playwright/overview-heading/) |
| 浏览器与 MCP 设置 | 搜索、页面功能、同步及网站权限分组检查通过；MCP 连接、总开关、独立接管、说明展开、复制失败及焦点恢复通过。后续新增同步项以各功能记录为准 | [浏览器设置](output/playwright/browser-settings-20261114/)、[MCP 设置](output/playwright/mcp-settings-hierarchy/) |
| 折叠与操作行 | 原生折叠、条件展开、空/加载/错误/长列表及键盘滚动通过；图片搜索授权、测试和移除按钮在同一操作行自然换行 | [折叠区域](output/playwright/settings-disclosures-20261114/)、[图片搜索按钮](output/playwright/brave-actions-alignment/)、[屏蔽按钮](output/playwright/exclusion-button-20261114/) |
| 设置窗口与公共浮层 | 设置窗口沿用收紧高度与同一底色，桌面侧栏分隔线已复核；确认框、危险操作及右键菜单轻分区的三语、焦点和窄屏检查通过 | [设置窗口](output/playwright/settings-window-compact/)、[确认框与菜单](output/playwright/overlay-light-sections/) |
| 导航 Logo | 导航 Logo 已恢复独立尺寸；深浅主题、导航收展和窄屏隐藏检查通过 | [导航 Logo](output/playwright/nav-logo-size-20261114/) |
| 资讯排序位置 | 排序胶囊移至 FEED 右侧，与文字可见底部对齐；桌面右侧操作按钮共用该底线，窄屏排序仍跟随标题，操作区另起一行。完整校验通过；隔离 Chromium 合成预览的三语、深浅主题、1440／390px 对齐、菜单边界、排序切换、键盘焦点与减少动态效果检查通过；320px 溢出、空状态及禁用状态通过，最终预览无页面或控制台错误。已查看桌面与英文窄屏截图，未执行用户安装实例人工验收 | [位置与交互检查](output/playwright/summary-order-position/browser-check.log)、[截图](output/playwright/summary-order-position/)、[完整校验](output/playwright/summary-order-position/verification.log)、[既有胶囊与高对比度检查](output/playwright/summary-order-capsule/) |
| 今日灵感封面 | 当前采用 covers-A4，旧 Unsplash 三维图及中性配色方案已替换。暗图文字/遮罩、换批、网站预览替换与坏图回退通过；资源预算及署名已检查 | [当前封面](output/playwright/inspiration-a4-20261114/)、[资源记录](output/inspiration-a4-20261114/) |
| 简报空状态 | 沿用共用紧凑布局；三语均移除标题栏“服务未就绪”及其占位。隔离 Chromium 合成预览覆盖大小卡位、深浅主题、1280／390px、配置按钮与焦点、生成／失败／就绪状态，控制台无错误；完整校验通过 | [通用空状态](output/playwright/digest-empty-layout/generic-results.json)、[状态文字检查](output/playwright/digest-status-hidden/browser-check.log)、[完整校验](output/playwright/digest-status-hidden/verification-final.log) |
| 研究与客户端交互 | 研究正文相关性、事件状态去重及同步并发修复有定向回归；结构精简另有完整校验和隔离扩展 DOM 检查，覆盖确认/取消、图片节点保留及连续换批。研究回答未连接真实模型 | [客户端交互](output/playwright/overengineering/)、[DOM 夹具](tests/browser/client-behavior.html) |

### 2026-11-13

| 区域 | 保留的验证结论与边界 | 证据 |
| --- | --- | --- |
| 书签 | 子分类同行下拉、键盘选择、失效恢复及长菜单通过；分类卡片自然高度、多列断点、来源标签显隐和无内部滚动通过；分组标题不再显示数量 | [子分类](output/playwright/bookmark-dropdown/)、[卡片布局](output/playwright/bookmark-card-layout/) |
| 外观与背景 | 当前字段分组、三语、预览/放弃/保存及焦点检查通过；图片/视频共用填充方式、全屏视频和高度默认值有专项记录。旧横排固定标签布局不再作为基线 | [外观布局](output/playwright/appearance-layout/)、[填充方式](output/playwright/header-cover-fit/)、[高度范围](output/playwright/header-height-range/)、[默认提示](output/playwright/header-height-default/) |
| 设置文案与维护 | 八页签静态/动态文案、授权失败/恢复、短长列表检查通过；导入、导出、恢复出厂及维护按钮直接显示，确认和接口分发通过。后续布局以 11 月 14 日记录为准 | [文案复核](output/playwright/settings-audit/)、[权限提示](output/playwright/settings-permissions/)、[维护按钮](output/playwright/settings-actions/) |
| 归档与已读 | 归档和阅读队列标题数量均已移除；平面列表、清空确认中的计数、悬停/触屏清空入口、全部已读操作与三语弹窗检查通过 | [归档检查](output/playwright/archive-cleanup/)、[全部已读](output/playwright/queue-read-all/) |
| 工具栏图标 | 保持用户原稿比例，原生 24px 映射和无额外透明边距已验证；临时浏览器中未复现用户反馈的相对偏小现象 | [工具栏对照](output/playwright/logo-revision/toolbar-detail-final.png)、[映射结果](output/playwright/logo-revision/toolbar-final.json) |

## 未闭环事项与验收边界

- 真实登录账户的两台设备同步尚未完成，特别是新增日历、主题追踪、随手记和世界时钟；合成双端回归及未登录浏览器的 storage 事件检查不能替代它。
- 工具栏图标相对其他扩展偏小的问题尚未复现，不能写成已解决。
- 工具栏捕获、真实网站 Reader、真实 AI/原生联网与外部 MCP 客户端、Edge 专属窗口场景等安装级验收，继续按商店清单逐项确认。现有合成预览不代表这些场景已完成。
- 股票行情数据的使用授权仍需在商店发布前确认；某次端点可访问不能替代授权核对。

更新本文件时，替换对应功能的旧结论，并保留未解决问题和验证限制；不再追加已失效的布局数值、旧版本打包结果或重复的沙箱重试过程。
