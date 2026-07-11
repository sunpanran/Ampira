# Ampira UI 设计规范

## 设计原则

- 保持高密度信息终端风格，以扫描效率和清晰层级为先。
- 主看板、资讯、归档、设置与浮层共用同一套颜色、控件和状态规则。
- 本规范约束一致性，不改变现有信息架构、页面布局或内容密度。
- 重点色只表达选中、焦点、进度和主要操作；危险操作使用红色。

## 基础令牌

颜色令牌定义在 `assets/dashboard.css` 的 `:root` 中，并由浅色模式覆盖：

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
