# Ampira MV3 QA

## 2026-11-20 — 小版本发布验证与首屏对比

- 针对“新标签页首屏出现慢”，将上一已发布 ZIP 与当前候选 ZIP 分别加载到未登录的隔离 Chromium，使用相同合成设置、真实 `chrome://newtab/` 导航和交替顺序，对比普通配置与 160 条排除记录的分块配置。共 84 次打开：各配置每版 12 次连续新标签页、9 次浏览器重启后的首次打开；阻断外部网络，未读取用户浏览器数据。首屏绘制与内容填充分别计时，不能将脚本源码大小当作启动耗时。
- 普通配置首屏绘制中位数为旧版／候选 120／134 ms，重启后为 220／228 ms；分块配置为 132／120 ms，重启后为 240／220 ms。普通配置重启后的内容就绪中位数为 479.5／516.8 ms，分块配置为 464.8／447.7 ms；没有复现明显的首屏绘制退化，不将本次隔离结果推断为用户真实配置或联网图片耗时。未据此改动启动代码。见 [合并结果](output/playwright/startup-compare/summary.json)、[首轮样本](output/playwright/startup-compare/initial-runs.json) 和 [冷启动复核](output/playwright/startup-compare/cold-confirm-runs.json)。
- `scripts/verify-extension.ps1 -Package` 完整通过，退出码 0，覆盖统一测试、所有模块语法、三语、资源与安全约束；首次沙盒运行受本机合成服务连接限制，正常本地环境复跑通过。见 [完整日志](output/playwright/release-27.0.4/verification-full.log)。
- 真实扩展在另一份未登录隔离 Chromium 中完成 18 项发布检查：深浅主题 × 1280×800／1440×1000／390×844 首页与同步操作布局、无横向溢出、确认／取消及焦点恢复、键盘、减少动态效果、上传／下载、损坏副本及未保存草稿反馈、英文和繁体窄屏。无页面错误或非预期控制台错误，已查看桌面确认框与窄屏截图；数据与权限状态为合成环境，未验证真实账号云端传输。见 [结果](output/playwright/release-27.0.4/results.json) 和 [浏览器日志](output/playwright/release-27.0.4/browser-check.log)。
- 发布 ZIP、SHA-256 sidecar 与逐文件清单审计通过：430 个文件与源码一致，根目录 `manifest.json` 正确，无缓存、测试、输出文件、凭据模式、机器绝对路径或远程脚本。见 [包审计](output/playwright/release-27.0.4/package-audit.json)。

## 2026-11-20 — 同步一致性修复与核心重构

- 修复审查中复现的四项问题：旧分块清理与恢复记录收尾保持在写入锁内，并在删除前重查当前根记录引用；首次读取不完整配置时拒绝建立截断镜像，已有完整镜像继续可读，保存则等待完整数据；新写入的分块附带 SHA-256 校验，拒绝新旧分块混用；覆盖上传逐条验证本机记录，自动合并也不允许损坏本机输入覆盖或删除有效远端记录。
- 保留 `ampira.settings.v1`、内容记录与密钥记录的现有标识和版本。分块的 `settingsChunks.version` 仍为 1，校验信息为附加字段；当前已保存的无校验 v1 数据继续可读，首次显式保存补充校验。使用仓库已推送基线 a46604f 的冻结读取器及已有 released-settings 夹具检查兼容；旧读取器可以读取新记录。无原始校验值的旧记录仍采用 v1 完整性规则，不虚构历史批次校验信息。
- 将内容记录、数据集定义、版本与限额规则拆入 `content-sync-records.mjs`，共用 `sync-values.mjs` 的值校验工具；自动同步和手动计划共用编解码及时间推进规则。普通保存与手动上传共用设置写入计划和清理方法；恢复未完成时暂停普通保存和自动同步写入，存储事件先处理恢复。多项目同步共用一次全区读取和元数据读取，只有变化时才写元数据，避免无变化的重复落盘；旧记录中的本机专有字段仍会在显式保存时移除。
- 新增 [一致性回归](tests/suites/sync-integrity.mjs) 和 [已推送读取器夹具](tests/fixtures/published-sync-settings.mjs)，覆盖四项故障、延迟分块、混合／重复记录、清理中断、恢复期间排队写入、旧格式读取与升级、损坏配置无镜像时的显式清空，以及批量读取和无变化写入计数。已有同步、凭据、设置存储、日历、主题追踪等检查保持通过。
- `scripts/verify-extension.ps1` 最终完整通过，退出码 0，沿用现有体积预算。两份未登录的隔离 Chromium 配置完成 11 项同步／分批分块／旧读取器检查，再完成 6 项清空流程及 1 项本机缓存保留检查，全部通过，无页面或控制台错误；仅使用合成传输，不涉及真实账号。见 [完整校验](output/playwright/sync-core-refactor/verification.log)、[双设备结果](output/playwright/sync-core-refactor/results.json)、[清空结果](output/playwright/sync-core-refactor/clear-results.json) 和 [缓存结果](output/playwright/sync-core-refactor/cache-results.json)。

## 2026-11-20 — 导入导出状态与格式重构

- 将读文件、解析、确认和提交放入同一设置操作会话，并增加单次导入锁。连续选文件不会共享确认结果；读取或确认期间关闭设置后，过期回调不再提交。导入实现拆为按需加载的 `settings-import-controller.mjs`，入口保留文件选择、锁定和焦点恢复。
- 后台拆分保存提交与缓存／刷新处理。导入及导入授权返回明确的 `committed` 和 `postCommit` 状态；提交后的缓存或视图读取失败仍返回已保存状态和授权需求，不误报整次导入失败。新增只处理当前配置的 `settings:reconcile-import`，客户端最多自动重试一次后续处理，不重放配置或密钥写入；持续失败保留明确反馈。提交阶段出错继续恢复设置、凭据和本机同意。
- 授权流程返回 `ready`、`pending`、`cancelled` 或 `failed`，保留文件内及后续发现的完整权限集合，每轮读取当前设置和权限后复查。早期网站或图标权限被撤销时再次提示缺失项，全部核验后才完成。有效的本机同意与既有权限继续复用，浏览器申请仍发生在确认按钮的同步点击回调。
- `settings-transfer-schema.mjs` 集中普通字段顺序、白名单和校验规则，`settings-transfer-errors.mjs` 统一前后台错误映射；v1/v2 在解析入口统一为内部结构。加入已推送字段集的 v1 夹具和未含同步开关的已保存 v2 夹具，保留缺失字段不改本机状态的语义，不新增格式版本或中间版本适配器。
- 三个审查复现已转为正式行为测试，补充关闭、取消、过期回调、提交后失败与无重写恢复、视图失败、跨轮撤权、已有授权和服务身份变化。部分源码片段断言改为行为断言。定向复现修复结果见 [回归记录](output/reviews/settings-transfer-audit-fixed.json)。
- 合成浏览器完成既有三语／深浅主题／1280 与 390px 的 56 项检查，以及新增多轮撤权、提交后恢复和持续失败的 9 项检查，均通过；已查看补授权截图。见 [界面结果](output/playwright/settings-transfer/ui-refactor-results.json)、[新增流程结果](output/playwright/settings-transfer/refactor-results.json)、[补授权截图](output/playwright/settings-transfer/revoked-earlier-grants.png)。本轮未测试真实密钥或真实云端账号。
- 最终 `scripts/verify-extension.ps1` 完整通过，退出码 0，见 [完整日志](output/playwright/settings-transfer/verification-refactor-complete.log)。验证同时覆盖工作区正在进行的同步重构；自定义 Feed 回滚夹具改为同时变更一个同步字段，以实际触发写入失败而不被去重跳过。首页静态脚本较本轮基线减少 3,444 字节；后台预算 904 KiB 包含共享工作区的同步完整性校验及本次提交后恢复，不能将整体增长全部归因于导入重构。这些数值是源码体积，不是耗时测量。

## 2026-11-20 — 导入导出闭环复核与已有授权保留

- 修复同一服务域名导入时无条件清除本机 AI 同意的问题。现在保留当前设备对同一服务仍有效的 AI 同意、书签同意和已授予的浏览器权限；更换服务域名会清除旧 AI 同意，新设备仍需本机确认。导入文件不复制实际授权，也不删除当前已有的网站权限。
- 导出前拦截未保存的设置草稿，避免用户以为新选择已进入文件；以实际下载的格式化 JSON 字节数检查 256 KiB 上限，避免导出后无法导入。导入保存成功后，设置界面刷新失败不再跳过权限申请；后续界面处理失败会明确说明配置已经导入，不误报存储失败。
- 定向回归覆盖已授权同服务直接使用、跨域重授、旧版文件、同步开关恢复、损坏／超限文件、未保存草稿、界面刷新失败、拒绝／取消／未真正授予权限及书签同意后新域名发现。实际请求比较仍保持服务地址、协议、模型和密钥绑定一致。
- 使用专用扩展副本和未登录的隔离 Chromium 配置，以仅含合成域名的安装夹具建立历史授权后恢复生产 `manifest.json`，验证真实扩展存储和权限接口。已有授权重导入、清空合成密钥并关闭同步后恢复均通过；随后撤销这些可选权限并重新导入，观察到原生权限框。自动点击原生按钮曾遇到窗口几何错误，之后观察到原生框结束、真实权限恢复；不将点击成功归因于自动化。最终回读为 129/129 域名已授权，favicon／search／history 均生效，AI／书签同意与凭据同步为 true，AI／Brave 密钥存在。真实运行时的 AI 测试路径使用合成响应成功，认证头和模型绑定匹配。见 [最终回读](output/playwright/settings-transfer/installed-audit-result.json)、[界面证据](output/playwright/settings-transfer/installed-grants.png)。未使用用户真实配置或密钥。一次后续重复运行因测试浏览器关闭而中断，未记为通过。
- `scripts/verify-extension.ps1` 完整通过，退出码 0；见 [本轮完整校验](output/playwright/settings-transfer/verification-final-audit.log)。首页为导出保护与导入后处理反馈增加 1 KiB 静态源码预算（771 → 772 KiB），不代表启动耗时变化。用户之前确认的 OpenAI 地区限制不属于配置迁移问题，本轮未声称真实 OpenAI 服务恢复可用。

## 2026-11-20 — 恢复导出时的 AI 同步选项与 403 诊断

- 新导出文件记录独立的 `syncAiSettingsEnabled`，与密钥、服务地址、协议和模型从同一凭据快照读取。导入确认明确说明开启会将密钥放入浏览器账号同步存储、关闭会移除云端副本；后台要求明确确认后才改变同步选择。旧文件没有此字段时保持当前选择，不推测历史状态；此前已经导出的旧文件需要手动恢复开关后重新导出。
- 回归覆盖开启状态导出、关闭／更换配置后的导入恢复、关闭状态恢复、本机密钥保留、缺少确认时拒绝并保留原配置、旧文件保持现状。使用合成密钥比较导入前后实际生成的 AI 请求，接口 URL、模型、协议和认证头一致。未使用真实密钥测试。
- 对 HTTP 403，只在返回的错误代码／类型明确为 `unsupported_country_region_territory` 时显示地区限制；其他 403 保留原因未明提示，不回显服务响应原文。覆盖普通和流式请求，保持非重试错误与密钥隐私。用户更新后的测试反馈为“当前网络所在地区不受支持”，因此本例 403 已定位到服务端地区限制，不属于扩展网站权限或同步开关。
- 三语的同步开启／关闭确认、390px 浅色与 1280px 深色显示及恢复状态共 6 项检查通过，已查看截图；见 [界面记录](output/playwright/settings-transfer/sync-preference-check.log)。后台为同步恢复确认及本地化 403 诊断增加 2 KiB 静态源码预算（896 → 898 KiB），这是源码大小约束，不是启动耗时。`scripts/verify-extension.ps1` 完整通过，退出码 0；见 [完整校验](output/playwright/settings-transfer/verification-sync-preference.log)。

## 2026-11-20 — 导入后补齐新发现的网站权限

- 修复导入授权清单在书签读取同意之前生成的问题：首次申请后会重新读取当前所需来源，对新发现的未授权域名单独补弹确认，并在新的点击手势中发起原生权限请求。进入授权流程时同样重新读取清单，覆盖导入响应过期／未携带待授权域名的情况。旧版文件选中书签来源时也会申请本机书签读取同意。
- 每次申请后调用浏览器 `permissions.contains` 回读网站及命名权限，未实际生效时保留“尚未授权”反馈；浏览器异常显示具体失败原因。重新收集来源后仍有缺失时继续申请，最多三轮；只有所需权限确实齐全才显示完成。
- 新增回归先复现“127 个新域名未申请却显示完成”（修复前 0/127），修复后覆盖首次书签同意、已有书签同意但清单为空、旧文件、拒绝、API 异常及返回成功但未授予权限。完整校验通过，见 [日志](output/playwright/settings-transfer/verification-permission-fix.log)。三语、深浅主题和窄屏的 56 项既有界面检查通过，另有 21 项补授权检查通过，见 [界面日志](output/playwright/settings-transfer/browser-permission-fix.log)、[新增域名检查](output/playwright/settings-transfer/discovery-check.log)。
- 隔离 Chromium 中加载真实扩展并建立合成书签，已观察到浏览器原生“请求获得更多权限”窗口及“允许／拒绝”按钮，真实 API 调用保留点击手势。原生按钮自动点击因工具的窗口几何／缓存索引错误未完成，因此不声称原生接受后的端到端验收通过；127 个域名实际授予及回读的检查使用合成权限实现。未操作用户安装实例或真实权限。

## 2026-11-20 — 配置密钥迁移与导入授权

- 配置导出升级为格式 2，包含 AI / Brave 密钥及对应 AI 服务配置、已开启的可选权限清单和书签读取同意请求。文件为明文；关于页仅保留“导出含网址、服务地址和明文密钥，请妥善保管。”，不常驻显示授权与缓存说明，三语同步。格式 1 仍可导入；缺失／空白密钥保留本机值，换域名且没有对应密钥时清除旧 AI 密钥。
- 导入复用设置事务和凭据回滚，先保存配置、暂停导入的 AI 凭据，再弹出授权确认。网站图标、浏览器搜索、历史建议及精确网站来源在确认按钮的同步点击回调中合并申请；AI 数据传输和书签读取同意仅在接受后记录。实际授权不会随文件迁移，导入不会开启密钥同步，已有同步选择继续生效。Edge 跳过不支持的图标权限并提示。取消、拒绝或申请失败保留已导入配置，完成后焦点返回导入按钮。
- [格式回归](tests/suites/settings-transfer.mjs) 和 [工作流回归](tests/suites/settings-transfer-workflow.mjs) 覆盖密钥绑定、旧文件、非法权限、超限／损坏数据、隐私边界、保存失败回滚、已有同步选择、授权前不启动 AI、过期服务配置以及取消／拒绝／失败／失效回调。三语隐私、商店披露和审阅说明已同步。
- 真实 Chrome 中的合成页面使用实际导入控制器与确认弹窗，通过三语 × 深浅主题 × 1280×800／390×844、焦点与键盘、减少动态效果、长网站列表、授权拒绝／失败检查；权限调用保留真实点击手势，页面和控制台无错误。另验证下载文件重新上传后出现完整授权弹窗、无效 JSON 被拒绝。已查看桌面深色和英文窄屏浅色截图。浏览器权限响应使用合成桩，未操作用户安装实例或真实密钥，未把这些检查记为原生权限弹窗人工验收。见 [界面结果](output/playwright/settings-transfer/results.json)、[文件回读](output/playwright/settings-transfer/file-check.log)、[桌面授权](output/playwright/settings-transfer/zh-CN-dark-1280.png)、[窄屏授权](output/playwright/settings-transfer/en-light-390.png)。
- `scripts/verify-extension.ps1` 完整通过，退出码 0，包含统一测试、模块语法、三语、导入、资源和安全检查。首次沙盒运行被本机合成 HTTP 连接权限阻止，正常测试环境重跑通过；见 [完整校验](output/playwright/settings-transfer/verification-final.log)。本次未打包或发布。

## 2026-11-20 — 跨设备同步置顶

- 将浏览器设置页的“跨设备同步”完整移至第一分区；后续依次为统一搜索、页面功能、网站访问权限。保留现有控件、文案和行为，复用首分区的无顶部分隔线样式，DOM 与键盘顺序同步调整。
- 隔离 Chromium 完成深浅主题 × 1280×800／390×844 × 展开／收起检查，并确认首屏可见、无横向溢出和键盘顺序，共 10 项通过，无页面或控制台错误。`scripts/verify-extension.ps1` 完整通过，退出码 0。见 [界面结果](output/playwright/sync-section-order/results.json)、[桌面](output/playwright/sync-section-order/dark-1280-collapsed.png)、[窄屏](output/playwright/sync-section-order/light-390-expanded.png) 和 [完整验证](output/playwright/sync-section-order/verification.log)。

## 2026-11-20 — 清空云端配置

- 在上传／下载旁增加“清空云端配置”危险按钮，保持紧凑布局与三语。确认后清空当前扩展的全部浏览器同步记录，包含旧配置、个人内容及密钥副本；本机内容、设置、密钥和缓存保留。密钥同步随副本删除而关闭，个人内容开关保留；其他设备或后续修改仍可能重新上传，确认框明确说明。
- 复用同步预览、一次性令牌和串行队列；清空前复核版本，取消、预览过期或失败不执行后续删除。更新本机同步基线，避免未修改内容在刷新、重启时立即回填；中断恢复只完成本机状态，不再次清空。同步区已空时直接反馈。设置删除事件不再把卡片布局重置为默认，密钥副本删除也不再清理本机简报缓存。
- [同步回归](tests/suites/manual-sync.mjs)、内容同步和凭据同步定向检查通过，覆盖本机保留、旧／损坏记录、失败与恢复、过期确认及后续重新同步。两个未登录的隔离 Chromium 配置完成 12 项界面和模拟同步检查，另完成 1 项本机缓存保留检查；无页面或控制台错误。深浅主题、1280×800／390×844、三语、取消焦点、禁用状态、键盘、重启和空态均检查。见 [浏览器结果](output/playwright/manual-sync-clear/results.json)、[缓存结果](output/playwright/manual-sync-clear/cache-results.json)、[桌面按钮](output/playwright/manual-sync-clear/dark-1280.png) 和 [窄屏确认](output/playwright/manual-sync-clear/light-390-confirm.png)。未清空真实账号。
- 三语隐私及数据删除文档同步更新。清空入口的首页接线预算增加 1 KiB（770 → 771 KiB），控制器仍按需加载；后台为清空规划、保留基线与恢复处理增加 4 KiB 预算（892 → 896 KiB），三个同步模块合计仍限制在 24 KiB 内。这是静态源码大小约束，不是启动耗时测量。`scripts/verify-extension.ps1` 最终完整通过，退出码 0，见 [日志](output/playwright/manual-sync-clear/verification.log)。

## 2026-11-20 — 天气预报滚动条

- 天气预报区域隐藏原生滚动条，继续允许内容溢出时滚动；不改变卡片尺寸、预报行和来源署名，也不影响城市搜索列表的滚动条。
- 隔离 Chrome 合成预览通过深浅主题、1920／1440／1280px 桌面与 390px 窄屏、简繁英、大小卡位检查；长内容滚轮、减少动态效果、键盘城市搜索、加载／错误状态均通过，无横向溢出、来源裁切、页面／控制台错误或外部请求。已查看桌面深浅色与窄屏截图，未操作用户安装实例。见 [浏览器检查](output/playwright/weather-overflow/browser-check.log) 和 [截图](output/playwright/weather-overflow/)。
- `scripts/verify-extension.ps1` 完整通过，退出码 0。首次沙盒运行因本地合成服务连接被限制而停止，在正常环境重跑通过；见 [完整验证](output/playwright/weather-overflow/verification-final.log)。

## 2026-11-20 — 手动上传与下载覆盖

- 「设置 → 浏览器 → 跨设备同步」新增“上传数据”“下载覆盖”两个紧凑按钮，复用既有控件与反馈区。自动同步和已有开关保留；操作范围为普通设置、已勾选个人内容和已开启同步的密钥／AI 配置。覆盖前仅显示项目及新增、更新、移除数量，密钥和个人内容不进入预览。未保存草稿先提示保存；缺少同步副本时保留本机数据。
- 普通设置增加仅存本机的镜像，旧安装从完整同步记录初始化；沿用现有同步键、内容版本和删除标记。手动操作串行执行，使用短期本机恢复记录，并在恢复出厂时清理；恢复记录不复制未参与操作的客户端状态或关闭同步的凭据。上传只反馈提交到浏览器同步区，下载只反馈应用当前可用副本，不声称云端传输完成。
- [定向回归](tests/suites/manual-sync.mjs) 覆盖两个方向、删除与防复活、空副本／损坏分块、过期预览、配额、凭据绑定、并发编辑、失败保留和中断恢复，并注册统一测试。MV3 不支持后台动态导入，后台静态源码预算随新功能从 864 调整到 892 KiB，新增三个规划／恢复模块另限 24 KiB；界面控制器按需加载，首页按钮接线预算增加 1 KiB（769 → 770 KiB）。这些是源码大小约束，不是启动耗时测量。
- 隔离 Chromium 使用全新配置与合成数据完成 10 项检查：深浅主题 × 1280×800／390×844、覆盖确认／取消与焦点返回、键盘及减少动态效果、真实后台上传／下载、无变化和损坏数据反馈、未保存拦截，以及英文和繁体窄屏按钮。无页面或控制台错误，已查看桌面、窄屏和确认弹窗截图。未操作用户安装实例，也未验证真实账号的云端或跨设备传输。见 [浏览器结果](output/playwright/manual-sync/results.json)、[桌面](output/playwright/manual-sync/dark-1280.png)、[窄屏确认](output/playwright/manual-sync/light-390-confirm.png)、[英文窄屏](output/playwright/manual-sync/en-390.png)。
- `scripts/verify-extension.ps1` 最终完整通过，退出码 0，包含统一测试、所有模块语法及资源／本地化／安全约束检查。日志：[完整验证](output/playwright/manual-sync/verification.log)。本次不打包发布。
- 同日补充虚拟双设备验证：两份独立、未登录的 Chromium 配置加载同一扩展，通过合成同步记录传输模拟设备间到达。9 项检查通过，覆盖双向自动同步、延迟到达、界面上传后的跨端覆盖与删除标记、下载覆盖且不反向上传、取消保留、确认过期保护、重启不恢复旧条目，以及空副本保留本机内容；无页面或控制台错误。这是模拟通道验证，不代表真实 Google 账号传输验收。见 [双设备结果](output/playwright/manual-sync-virtual/results.json) 和 [验证脚本](output/playwright/manual-sync-virtual/check.mjs)。
- 缺少副本时的反馈缩短为“暂无可下载的数据，本机内容已保留。”，不再与“内容已一致”拼接或枚举内容名称；部分成功也采用单句反馈，三语同步。已检查 [实际空副本提示](output/playwright/manual-sync-virtual/empty-copy-short-message.png)，本机内容保持不变；本轮完整验证见 [日志](output/playwright/manual-sync-virtual/verification.log)。

## 2026-11-17 — 按语言提供默认股票

- 未保存自选列表时，简体及繁体中文默认显示贵州茅台（600519）、腾讯控股（00700）、比亚迪（002594）；英文默认显示 Apple（AAPL）、Microsoft（MSFT）、NVIDIA（NVDA）。未自定义的列表随语言切换并丢弃旧行情响应，已保存的自选、顺序和主动清空的列表保持不变。默认项不自动写入存储或触发内容同步，行情继续遵守既有授权流程。
- 扩展 [股票回归](tests/suites/stocks.mjs)，覆盖中英文默认项、繁体共用、语言切换及过期响应、自选保存、清空重开和远端同步。定向检查与 `scripts/verify-extension.ps1` 完整通过，退出码 0；首次沙箱运行因合成 MCP 临时文件重命名权限中止，最终在常规环境完成校验。
- 隔离 Chrome 使用真实股票视图、状态与存储模块及合成行情，检查三语切换、Enter 触发精确来源授权、删除后刷新、清空后刷新与语言切换，均通过，无横向溢出或页面／控制台错误。已查看中英文截图；本次未改布局或样式，检查限定为深色 1280×800。授权由夹具模拟，未验证原生权限弹窗或实时行情，未操作用户安装实例。见 [检查脚本](output/playwright/stock-defaults/browser-check.js)、[中文截图](output/playwright/stock-defaults/chinese.png)、[英文截图](output/playwright/stock-defaults/english.png)。

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
| 设置与凭据 | 三语一致、草稿与错误恢复、密钥不回显；显式导出含明文密钥和待申请权限；凭据同步独立且默认关闭；导入后重新授权 | [设置迁移](tests/suites/settings-transfer.mjs)、[设置导航](tests/suites/settings-navigation.mjs)、[客户端语言](tests/suites/client-i18n.mjs) |
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
