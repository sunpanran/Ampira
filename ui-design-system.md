# Ampira UI 设计规范

## 设计原则

- 保持高密度信息终端风格，以扫描效率和清晰层级为先。
- 主看板、资讯、归档、设置与浮层共用同一套颜色、控件和状态规则。
- 本规范约束一致性，不改变现有信息架构、页面布局或内容密度。
- 重点色只表达选中、焦点、进度和主要操作；危险操作使用红色。

## 基础令牌

颜色与动效令牌定义在 `assets/styles/tokens.css` 的 `:root` 中，并由浅色模式覆盖：

- 页面：`--bg`、`--bg-grid`、`--bg-grid-strong`
- 表面：`--surface-0` 至 `--surface-3`、`--surface-row`
- 边框：`--line`、`--line-soft`、`--line-faint`、`--card-line`
- 文字：`--text-strong`、`--text`、`--muted`、`--muted-2`
- 状态：`--accent`、`--active-bg`、`--active-line`、`--red`、`--danger-soft`

字体保持本地字栈：界面使用 `--font-ui`，大标题使用 `--font-display`。数据默认启用等宽数字。不要引入远程字体。

圆角层级：

- 面板：`--radius-panel`，16px
- 卡片：`--radius-card`，12px
- 列表行和输入框：`--radius-row` / `--radius-control`，10px
- 文本按钮：`--radius-button`，胶囊
- 纯图标按钮：`--radius-icon-button`，正圆

控件尺寸保持紧凑：`--control-height-compact` 为 28px，标准按钮为 36px，搜索框为 42px。普通按钮水平内边距使用 `--control-padding-inline`。

## 按钮

以下操作控件必须使用胶囊造型：

- `.btn`、`.empty-state-action`、`.column-action`、`.efficiency-action`
- `.ai-digest-refresh-mini`、`.settings-tabs button`、`.theme-swatch`
- `.segmented`、`.segmented button`、`.segment-indicator`
- `.context-menu button` 和导航展开状态

纯图标按钮必须等宽等高并显示为正圆，包括 `.icon-btn`、`.action-toggle`、`.seen-toggle`、`.search-ai` 和图标排序按钮。导航折叠时是正圆，展开后随宽度自然成为胶囊。

语义上属于内容的按钮式列表行不胶囊化，例如 `.efficiency-row` 和 `.ai-digest-brief-item`；它们继续使用列表行圆角，避免破坏信息密度。

所有按钮状态遵循同一顺序：

1. 默认状态使用控件表面和弱边框。
2. 悬停只提升背景或边框，不改变布局尺寸。
3. 选中状态使用重点色背景与边框。
4. 按下状态使用轻微下移和缩放。
5. 键盘焦点必须显示重点色焦点环。
6. 禁用或加载状态降低透明度并阻止重复操作。

状态动效使用 `--motion-press-duration`、`--motion-state-duration` 和 `--motion-emphasis-duration`。不要为相同按钮另设局部时长。

## 下拉选择框

- 所有单选 `select` 由 `assets/client/select-combobox.mjs` 渐进增强，并复用 `assets/styles/primitives.css` 的公共规则。触发框保持 `38px` 紧凑高度、`--radius-control` 圆角、主题表面、弱边框和右侧双线箭头；原生 `select` 继续作为选项、值、校验和表单事件的数据源。
- 默认、悬停、展开、键盘焦点和禁用状态必须可辨认。焦点只使用重点色边界与轻量外框，不得改变盒模型、位移或缩放；禁用状态使用弱化文字、表面和不可操作光标。
- 展开面板使用顶层 `listbox`，与触发框同宽并限制在视口内，最大高度 `280px`；选项行最小高度 `34px`。当前项显示重点色勾选，活动项、悬停项和禁用项使用各自的语义表面。空间不足时允许向上展开，长列表在面板内滚动。
- 浮动列表不得使用 `scrollbar-gutter: stable` 预留滚动条槽；短列表必须保持左右边距对称，只有内容实际溢出时才让滚动条占用空间。新增或重构下拉框、菜单和弹出列表时都要复核这一点。
- 触发框和选项文字均为纯文本并安全省略；完整文字放入 `title`。较长的中英文标签不得覆盖箭头、勾选标记、撑破字段网格或造成横向滚动。
- 使用 `role="combobox"`、`listbox`、`option`、`aria-expanded`、`aria-selected` 和 `aria-activedescendant` 描述状态。保留 Tab、方向键、Home、End、Page Up/Down、Enter、Space、Escape 和按文字检索；提交选择继续派发冒泡的 `input` 与 `change` 事件。
- 同一文档同时只展开一个列表；点击外部、Tab 或 Escape 关闭，提交后焦点返回触发框。动态增删选项、程序设置 `value` / `selectedIndex`、加载占位、空文件夹和锁定状态都必须同步到增强控件。
- 强制高对比度模式不启用自定义列表，直接保留系统原生 `select` 与系统箭头；这是高对比度环境的可访问性回退，不要求跨平台统一展开面板。

## 动效系统

动效必须先说明意图：即时操作表达响应，内容进入帮助建立层级，加载反馈缓解等待焦虑，循环只说明“仍在处理”，装饰性回弹仅用于低频品牌反馈。CSS 与 Web Animations API 共用以下唯一曲线：

| 曲线 | 令牌 | 使用范围 |
|---|---|---|
| standard | `--motion-ease-standard` | 悬停、颜色、边框、按钮状态和进度变化 |
| enter | `--motion-ease-enter` | 首屏、浮层、内容、空态和错误态进入 |
| exit | `--motion-ease-exit` | 浮层关闭、列表删除和内容退出 |
| move | `--motion-ease-move` | 分段指示器、FLIP 重排和展开区域 |
| ambient | `--motion-ease-ambient` | 长等待的低对比透明度呼吸 |
| brand | `--motion-ease-brand` | Logo 返回和低频成功图标 |

时长只使用 `100ms` 按压、`180ms` 普通状态、`240ms` 移动或强调、`300ms` 浮层、`360ms` 首屏或 Reader、`1600ms` 环境循环。`linear` 仅用于恒速旋转和骨架扫光；禁止在组件内新增匿名 `cubic-bezier` 或 `ease` 系列曲线。

新标签页首屏采用分层错峰：主题、背景和最终布局在 `0ms` 可用；导航从 `24ms`、标题与日期从 `40ms`、搜索从 `88ms`、快捷栏从 `120ms` 开始进入，约半秒内完成。数据可用后只动画效率卡和三列工作台的直接内容，使用 `360ms enter`、`32ms` 错峰且最多 `96ms`，不得重复动画内部卡片。头图独立使用 `480ms enter`，从 `scale(1.018)` 回到原位。

首次空载等待分三段：`<160ms` 只保留几何、不显示骨架；`160–700ms` 显示静态骨架；`>700ms` 才启动 `1600ms linear` 的低对比扫光。已有正文刷新时保留内容，不以骨架覆盖。AI 答案完整渲染后整体进入，不使用逐字延时。

`prefers-reduced-motion: reduce`、后台标签页和不可见文档取消首屏错峰、位移、缩放、回弹、FLIP 与循环，只保留即时状态和静态忙碌反馈。动画不得阻断点击；WAAPI 完成或反向操作后必须清理 `will-change`、固定高度、临时 class 和 finished effect。

## 表面与内容

- 页面背景保留现有网格纹理。
- 大面板使用 `--radius-panel`，内容卡片使用 `--radius-card`，嵌套行使用 `--radius-row`。
- 普通内容通过表面色和边框区分层级；阴影只用于已有浮层和整体容器。
- 审美图片卡片可以保留图片遮罩，但容器边框、焦点和交互状态与其他卡片一致。

## 响应式与变更边界

- 保持现有 `1120px`、`820px`、`520px` 断点及超宽屏布局规则。
- 保持桌面悬浮导航、三列工作台、移动端单列和底部导航。
- 保持大标题、头图、设置弹窗、卡片尺寸和页面间距。
- 不因统一样式而修改 API、设置结构、缓存键、中文文案或交互流程。

## 视觉验收

- 深色与浅色模式中，文字按钮应为胶囊，图标按钮应为正圆。
- 按钮悬停、选中、焦点、按下、禁用和加载状态均可辨认。
- 按钮文字和图标不得裁切，展开导航不得产生尺寸跳动。
- 桌面、窄屏和手机均不得出现横向溢出。
