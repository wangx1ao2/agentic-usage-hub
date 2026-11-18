# 前端科技感与全组件动效：实施与验证报告

日期：2026-10-18。依据：[原始 100 项方案](FRONTEND_TECH_MOTION_PLAN.md)。

本页记录上一轮 100 项实施与当时的检查结果。用户随后反馈动效不明显、加载时滚动条抖动，复现确认上一轮静止布局检查遗漏了动画期间的横向溢出。**下面的旧结果不能作为滚动稳定性的证明。** 当前修正和逐帧检查见[滚动条与动效修复记录](FRONTEND_MOTION_SCROLL_FIX.md)。

## 上一轮验证结果（历史记录）

| 检查 | 结果 |
| --- | --- |
| `npm test` | 141 项通过，0 失败；统计、适配器、HTTP / MCP、价格与用量口径回归通过 |
| `npm run test:ui` | 25 / 25 组通过，含额度窗口、图表缺日、灯箱、焦点与请求竞争 |
| `npm run test:motion -- --capture` | 13 / 13 组新增动效场景通过，0 页面脚本异常、0 外部资源请求；另输出关键帧采样和视觉证据 |
| 布局矩阵 | 五视图 × 四宽度 × 明暗主题 = 40 组，均无整页横向溢出；另外通过独立触摸设备检查 |
| 原生中间帧 | 实测半程透明度 0.6、水平位移 3px；关闭动效后回到最终状态 |
| 60 秒动态更新 | 60 次检查、59 次数据变化；运行 60.84 秒；会话区节点始终 89 个，无增长 |
| 长任务与回收 | 该持续更新场景未观测到 >50ms 长任务；稳定后 WAAPI / 数字帧 / 指针帧均为 0 |
| 资源打包 | `npm pack --dry-run` 确认本地 `motion.js`、`motion.css` 和 HTML 入口均进入包 |
| 语法 | 前端 ES Modules 使用 Node 的 module 模式语法检查通过 |
| 效果归档 | 21 张明暗 / 桌面 / 手机截图、1 段 WebM 动效录屏，均使用标注的验证夹具 |

持续更新使用 1440×1600 视口；同一夹具的独立几何复核测得会话行在 y=1125.33–1188.33px，位于视口内，见[几何记录](/F:/token/agentic-usage-hub/output/frontend-motion/final/profile-geometry.json)。测试版本的生产前端文件已记录在 [SHA-256 清单](/F:/token/agentic-usage-hub/output/frontend-motion/final/source-manifest.json)，便于核对后续是否发生修改。

## 实施结果

五个主视图已接入统一的遥测控制台视觉和动效：深蓝黑 / 浅蓝灰双主题、细网格、青蓝光感、卡片聚光、方向切换、指标变化提示、列表重排和图片空间过渡。设置中增加「完整 / 轻量 / 关闭」，并实时遵从系统减少动画偏好。

实时页增加最近两分钟的实际检查轨迹；每一点仍是后端返回的 60 秒窗口平均 Token/s，暂停、断联及不可用来源之间保留缺口，不把它解释为逐 Token 生成速度或可累加的总用量。读取失败时保留上次成功的数值及会话，并标明旧数据。

前端继续使用原生 ES Modules、CSS、Web Animations API 与现有 Chart.js。没有新增运行依赖、运行时 CDN、外部字体或远程装饰资源。本次没有改动日志适配器、服务端统计、价格计算或数据存储。

## 改动位置与实现方式

| 文件 | 主要职责 |
| --- | --- |
| [motion.js](/F:/token/agentic-usage-hub/public/motion.js)（新增） | 用户 / 系统 / 可见性策略，按用途取消动画，数字过渡、变化光环、指针调度、原生 details、分组首展、检查用诊断接口 |
| [motion.css](/F:/token/agentic-usage-hub/public/motion.css)（新增） | 双主题材质、网格与光晕、滑动选中态、按压与焦点、加载扫描、触摸和减少动画降级 |
| [index.html](/F:/token/agentic-usage-hub/public/index.html) | 本地样式入口、首屏动效偏好、三档设置、实时采样区、Prompt 展开与复制入口 |
| [experience.js](/F:/token/agentic-usage-hub/public/experience.js) | 复用原有交互入口；方向式页面切换、弹层栈、灯箱进入 / 返回、方向切图、按钮缩放与跟手拖动分开处理 |
| [utils.js](/F:/token/agentic-usage-hub/public/utils.js) | 按业务键更新 DOM，保留子节点与已解码图片；批量测量 / FLIP；进入 / 退出；分页焦点；SVG 空状态与小图 |
| [app.js](/F:/token/agentic-usage-hub/public/app.js) | 刷新与部分失败反馈，主导航方向、筛选摘要、来源横向定位、视图离开时清理 |
| [timeline.js](/F:/token/agentic-usage-hub/public/timeline.js) | 保留图表与同口径 dataset；跨单位 / 坐标类型淡化；图例键盘聚焦与光环；稳定模型族和日期行 |
| [codex-live.js](/F:/token/agentic-usage-hub/public/codex-live.js) | 220ms 读数更新、sessionId 行复用、变化单元格提示、真实采样与缺口、旧数据保留 |
| [today.js](/F:/token/agentic-usage-hub/public/today.js) / [subscription.js](/F:/token/agentic-usage-hub/public/subscription.js) | 模型 / 占比 / 图片 / 额度窗口节点复用，模型行与占比联动，订阅局部更新、预算阈值和表单校验 |
| [projects.js](/F:/token/agentic-usage-hub/public/projects.js) / [gallery.js](/F:/token/agentic-usage-hub/public/gallery.js) | 排序与展开连续性，路径复制反馈，图片 decode 后出现、保留加载状态、完整 / 铺满切换 |
| [pricing.js](/F:/token/agentic-usage-hub/public/pricing.js) / [insights.js](/F:/token/agentic-usage-hub/public/insights.js) / [theme.js](/F:/token/agentic-usage-hub/public/theme.js) | 费率骨架、诊断行差异更新、导出忙碌与完成状态、手动主题短过渡 |

数值与 DOM 状态在业务操作成立时立即提交，不以动画结束为条件。用户关闭动效、切换减少动画偏好、离开视图或把页面置于后台时，进行中的数字任务会收敛到最终值。环境 CSS 时间线在后台暂停，恢复时不重播启动扫描。

卡片的 FLIP 使用 `transform`，鼠标上浮使用独立的 `translate`，聚光使用背景层；图片倾斜只作用于图片。详情高度动画让后续内容随高度平滑让位，避免在结束时再次从旧位置重播重排。

## 验证证据索引

| 代号 | 验证依据 |
| --- | --- |
| V | 五个视图 × 320 / 390 / 768 / 1440px × 明暗主题，共 40 组无整页溢出；代表截图与人工视觉检查 |
| M | 三档动效、偏好持久化、打开页面期间变更系统偏好、关闭时零运行动画 |
| N | 35 次连续切视图、20 次排序、30 次数字目标变更；真实 WAAPI 中间帧与关闭后最终状态 |
| D | details 关闭中重开、关闭中禁用动画、项目详情快速开合 |
| P | 工程卡片 / 复制按钮 / 份额填充层 / 抽屉节点保留，焦点与展开状态保留 |
| T | 图表实例及同口径 dataset 保留，跨单位不做数值 morph，反复键盘聚焦图例不污染颜色 |
| Y | 今日模型、占比段、图片节点保留；悬停联动；切订阅仅更新相关部分 |
| L | 实时行与单元格复用、暂停 / 失败保留轨迹缺口、失败保留旧值、未知图像 Token 为 — |
| A | 图片不因 fit / 渲染而重载；灯箱快速重开、焦点返回、缩放、Prompt 操作、延迟图片响应不覆盖新选择 |
| O | 自定义参数验证与恢复、来源诊断行复用、导出结果反馈 |
| B | 可重复的后台信号检查：请求停止、JS 动画 / 数字 / 指针帧清零，恢复后对齐最终数据 |
| H | 独立触摸设备上下文：不启用悬停 / 倾斜，画廊点击和关闭正常，无整页溢出 |
| F | 60 秒持续动态数据更新、60 次手动检查，表格可见；节点数量、长任务与收敛后的任务数 |
| R | 既有 25 组 UI 回归：统计口径、图表日历缺口、额度窗口、请求竞争、弹层、分页、灯箱等 |

这些代号表示对应功能采用的共享验证与视觉复核，不把 100 条实施记录冒充为 100 条独立自动化测试。

## 100 项逐项落实

### 全局与导航

| 编号 | 已落实的行为 | 接入位置 | 证据 |
| --- | --- | --- | --- |
| G01 | 48px 细网格、遮罩、首次显现与单次启动扫描 | motion.css / body 伪元素 | V、M |
| G02 | 两个 22 / 26 秒小范围光晕；轻量静止、后台暂停 | motion.css / applyPolicy | V、M、B |
| G03 | 原 Logo 首次描边，读取成功后短光环 | motion.js setup / setDataStatus | V、N |
| G04 | 品牌、标题、说明与首屏面板分组显现 | revealGroup / animateView | V、N |
| G05 | 按钮按压、主按钮窄高光和明确的键盘焦点 | motion.js click / motion.css | M、N、R |
| G06 | 设置浮层短位移显隐，支持快速关闭重开 | toggleDetails | D、V |
| G07 | 手动主题短过渡，系统自动切换直接更新 | theme.js setThemeMode | V、M、R |
| G08 | 计价选中底板移动，重算提示与响应后的金额更新 | setPricingTier / motion-selection | V、R |
| G09 | 保留数据刷新、不定长活动线、成功按钮确认、部分成功文字 | refreshData / setDataStatus | O、R |
| G10 | 成功状态一次柔和光环；过期、失败有静态明确说明 | setDataStatus / highlightChange | R、N |
| G11 | 导航滑块，按前后方向切换内容，重选当前页不重播 | switchViewMode / animateView | N、R |
| G12 | 数量角标仅变化时淡化，数字宽度稳定 | renderAll / setText | V、R |
| G13 | 原生勾选保留，筛选期间提示，结果统一提交 | insights.js / loadDashboard | O、R |
| G14 | 原生金额口径 / 历史版本选择，依据文字短切换 | renderInsights / setText | O、R |
| G15 | 统计口径说明统一展开，估算标识持续保留 | toggleDetails / cost-disclosure | D、R |
| G16 | JSON / CSV 生成中忙碌态、成功 / 失败反馈，完成后恢复按钮 | exportSelection | O、R |

### 趋势分析

| 编号 | 已落实的行为 | 接入位置 | 证据 |
| --- | --- | --- | --- |
| T01 | 日期底板移动，KPI、来源、排名、主图由同次渲染协调 | setDatePreset / renderAll | T、R |
| T02 | 自定日期浮层短展开，保留浏览器日期控件 | toggleDetails / date-range-panel | D、R |
| T03 | 无效日期说明淡入、边框强调、合法后清除 | applyCustomDateRange | R、D |
| T04 | 来源底板移动，必要时把选中项滚到可见区域 | setAgentFilter / syncSelections | V、R、H |
| T05 | 四张 KPI 首展、旧值到新值、真实变化短光环 | animateNumber / revealGroup | M、N、R |
| T06 | SVG/path 保留，首次描边，区间变化短淡化，未变化时不重播 | renderSparkline / reconcileMarkup | T、R |
| T07 | 来源 / 模型切换短淡化，沿用稳定系列键与显隐记忆 | renderChart signature | T、R |
| T08 | 金额 / Token 即时更换单位，不在不同量纲间补间 | setAxisMode / incompatible | T |
| T09 | 曲线数量变化更新数据集，保留原系列身份，不逐条延迟 | setChartSeriesLimit / renderChart | T、R |
| T10 | 首次曲线揭示，空结果保持真实空状态 | chart-reveal / chart-empty-state | V、T、R |
| T11 | 同口径保留 dataset 并短补间；主题、后台补齐无补间 | renderChart / motionpolicychange | T、B |
| T12 | 切线性 / 对数短淡化，同类型上限正常更新 | chartMotionSignature | T、R |
| T13 | 上限验证淡入，超界提示一次出现，重置后收回 | applyCustomYMax / updateChartContext | R、D |
| T14 | 图例显隐联动，悬停和键盘聚焦使其他系列轻淡 | focusSeries / restoreSeries | T、R |
| T15 | 日期垂线保留，悬停点光环与短 tooltip | dateCrosshair / tooltip | V、T |
| T16 | 图表设置高度短展开，快速开合可中断 | toggleDetails | D、R |
| T17 | 来源行、份额填充层保留；排名 FLIP，真实占比更新 | renderCompanyGrid / reconcileCards | T、R |
| T18 | 未使用来源统一 disclosure，零值不显示运行脉冲 | toggleDetails / inactive-sources | D、R |
| T19 | 模型族、子模型按键复用；排序和展开连续，保留展开状态 | renderModelRanking / animateDisclosure | D、R |
| T20 | 日期键复用明细行，搜索淡化、排序重排、分页方向过渡 | renderTable / renderPagination | N、R |

### 今日、额度与订阅

| 编号 | 已落实的行为 | 接入位置 | 证据 |
| --- | --- | --- | --- |
| D01 | 今日 Hero 侧边光线描出，标题与面板分组显现 | heroLine / revealGroup | V、N |
| D02 | 四类今日指标更新，整数图片数量，未知值不变为零 | animateNumber | Y、R |
| D03 | 按模型身份保留分段，占比宽度从旧值更新 | today-proportional-bar / reconcileMarkup | Y、R |
| D04 | 今日模型行复用和排序；hover / focus 联动占比段 | today-models-list | Y |
| D05 | 更多模型统一开合，只对首展的少量可见项错峰 | toggleDetails / revealGroup | D、Y |
| D06 | 活跃工程短入场，单个工程可点击，跳转后目标短强调 | showTodayProjects / workspace-card | Y、R |
| D07 | 图片 decode 后出现，新增到预览的文件标记，进入画廊保留今日日期上下文 | handleThumbnailLoad / showTodayGallery | A、Y、R |
| D08 | 额度日期变化时摘要文字淡化，保留 ≥ / ≈ / 未记录等符号 | renderQuotaHistory / setText | R、V |
| D09 | 选中日期行有静态位置标识，摘要和窗口表同步变化 | quota-selected-day | R、V |
| D10 | 窗口键、填充层复用；仅从其他依据转为用满时一次强调 | quota-window-rows | R、V |
| D11 | 额度范围选择反馈、稳定日期行与整组短淡化 | setQuotaHistoryRange | D、R |
| D12 | 切订阅只重绘订阅部分，核算范围短强调 | onSubscriptionPlanChange | Y、R |
| D13 | 日 / 月比值数字过渡，首次跨阈值短强调，维持 API 等值语义 | renderSubscriptionROI | Y、R |
| D14 | 自定预算条真实更新，超额显示真实百分比，阈值短强调 | today-quota-bar-fill | Y、R |

### 实时监控

| 编号 | 已落实的行为 | 接入位置 | 证据 |
| --- | --- | --- | --- |
| L01 | 检查、近期用量、空闲、暂停、部分失败分开；新用量才触发事件提示 | render / controls | L、R |
| L02 | 暂停开关即时响应，取消当前动效与采样请求，保留画面 | stop / sync | B、L、R |
| L03 | 原生频率选择保留，检查活动与间隔文字真实显示 | controls / setBusy | R、L |
| L04 | 手动刷新忙碌与成功确认，不对每次自动响应播放按钮确认 | poll manual | L、F |
| L05 | 四类速率 220ms 收敛；相同数值不动，首次和恢复直接显示 | animateNumber | L、F、N |
| L06 | 两分钟内实际 generatedAt 采样，暂停 / 断联留缺口、限定容量 | recordSample | L、F |
| L07 | sessionId 行与单元格复用；仅变化数值短提示 | reconcileCards / highlightChange | L、F |
| L08 | 新会话短入场，退出可见行短淡出；保留已有会话相对顺序 | reconcileCards / rank | L、F |
| L09 | 图片目录检查和新增写入分开，计数更新及新写入短强调 | renderImages | L、R |
| L10 | 图像 Token 保持未知，不生成等待进度或假波形 | image-metrics / resource-note | L、R |
| L11 | 空闲静态说明，失败保留旧数据，恢复短过渡 | poll catch / delay | L、R |
| L12 | 固定数字宽度；后台、离页、恢复后不补播历史变化 | stop / resumePending | B、F |

### 工程归因

| 编号 | 已落实的行为 | 接入位置 | 证据 |
| --- | --- | --- | --- |
| P01 | 工程汇总与筛选同次提交，真实值短过渡 | renderProjects | P、R |
| P02 | 主要工程名称短淡化，支持键盘 / 点击跨分页定位对应卡片并移交焦点 | proj-stat-focus | P、V |
| P03 | 搜索焦点光感、debounce 和复用结果重排 | filterProjects | P、R |
| P04 | 今日活跃筛选、退出与重排、空结果恢复入口 | toggleProjectTodayOnly | P、R |
| P05 | Agent 底板与可见结果变化 | setProjectAgentFilter | P、V |
| P06 | 连续排序从当前视觉位置衔接，保留卡片与子节点 | reconcileCards / cancelAnimation | N、P |
| P07 | FLIP、上浮、聚光分离，路径仍可选中，文字不倾斜 | motion.css / patchElement | P、H、V |
| P08 | 稳定份额与厂商段，真实宽度更新 | patchElement / company-seg | P、V |
| P09 | 详情高度连续开合，箭头、aria、inert 和状态同步 | toggleProjectDrawer / animateDisclosure | D、P |
| P10 | 复制成功后确认，失败说明与固定按钮宽度 | copyProjectPath | O、R |
| P11 | 请求下钻弹层、日期切换保留旧表、局部忙碌、稳定记录行和分页方向过渡 | openProjectUsage / loadProjectUsage | O、R |
| P12 | 分页方向短过渡，分页按钮保留，避免整页回顶 | renderPagination | P、R |

### 画廊与灯箱

| 编号 | 已落实的行为 | 接入位置 | 证据 |
| --- | --- | --- | --- |
| A01 | 图像计数整数过渡，参考金额与 Token 等值独立标明 | renderStudioGallery | A、R |
| A02 | 搜索焦点反馈、debounce、复用结果与短重排 | filterGalleryView | A、R |
| A03 | 日期按钮稳定键、数量变更反馈与滑动选中底板 | gallery-date-chips | A、V |
| A04 | 完整 / 铺满短淡化，保留 img 和 src | setGalleryFit | A、R |
| A05 | 可见卡片进入 / 退出与 FLIP；首展错峰上限 | reconcileCards | A、N |
| A06 | 完整模式、细指针下仅图片层最多 1.5° 倾斜和局部光感 | pointermove / motion.css | M、H、V |
| A07 | 固定画幅占位扫描，decode 完成淡入，真实尺寸后显 | handleThumbnailLoad | A、R |
| A08 | 当前图片失败 / 重试反馈，不影响其他图片 | handleThumbnailError | A、R |
| A09 | 完整索引局部活动条、完成短确认；按文件身份合入，保留筛选 | loadGalleryCatalog | A、R |
| A10 | 主 / 快捷画廊共用灯箱；打开从原图，关闭回可见目标，否则淡出 | openLightbox / hideOverlay | A、R |
| A11 | 按方向切图；未就绪保留旧图；请求序号阻止晚响应覆盖 | renderLightboxImage / stepImage | A |
| A12 | 缩放按钮短过渡、拖动即时跟手、换图清理旧动画 | updateZoom | A、R |
| A13 | Prompt 随图变化、展开与复制；元信息保持真实 | lightbox-prompt-tools | A |
| A14 | 原图 / 下载反馈，下载仅提示已发起；错误可重试 | lightbox-action-status | A、R |

### 费率、诊断与配置

| 编号 | 已落实的行为 | 接入位置 | 证据 |
| --- | --- | --- | --- |
| O01 | 费率面板保留右侧方向、边缘高光与响应式尺寸 | animateOverlay / pricing-modal-card | R、V |
| O02 | 费率表骨架、整组淡入、失败保留重试 | loadPricingMatrix | R、V |
| O03 | 模糊搜索保留行身份，结果短淡化，焦点留在输入框 | filterPricingTable | R |
| O04 | 来源面板先显示已知状态，再局部更新，不模拟逐行扫描 | openSources | O、R |
| O05 | 来源 key 复用行，真实状态变化才提示，路径和错误信息可读 | sourceRows / reconcileMarkup | O、R |
| O06 | 订阅弹层进出和可见字段组显现，常驻标签 | showOverlay / revealGroup | O、R |
| O07 | 有效金额 / 预算检查，说明关联、首错焦点、保存后局部更新 | saveCustomSubscription | O |
| O08 | Esc、遮罩、嵌套弹层与快速重开保留焦点栈和 inert | showOverlay / hideOverlay | A、D、R |

### 跨页面与设备

| 编号 | 已落实的行为 | 接入位置 | 证据 |
| --- | --- | --- | --- |
| C01 | 静态骨架先出现，150ms 后扫描；刷新保留数据 | motion.css / loadDashboard | R、V |
| C02 | 首次错误横幅展开、静态错误 / 旧数据语义、SVG 空状态和恢复操作 | showErrorBanner / emptyState | O、R、V |
| C03 | 分页方向、手机滚动边缘提示、触摸禁用跟随与倾斜 | renderPagination / motion.css | H、V、R |
| C04 | 统一动效策略；减少动画即时生效；后台 / 离屏清理，恢复对齐 | applyPolicy / disposeMotion | M、B、F |

## 效果文件

最终图像均使用明确标注的测试夹具；其中图像资产为本地 SVG 验证图。用来检查布局、图片生命周期和动效，不是用户真实用量或作品。

- [深色趋势截图](/F:/token/agentic-usage-hub/output/frontend-motion/final/screenshots/timeline-dark-desktop.png)
- [浅色今日截图](/F:/token/agentic-usage-hub/output/frontend-motion/final/screenshots/today-light-desktop.png)
- [深色实时截图](/F:/token/agentic-usage-hub/output/frontend-motion/final/screenshots/live-dark-desktop.png)
- [项目归因截图](/F:/token/agentic-usage-hub/output/frontend-motion/final/screenshots/projects-dark-desktop.png)
- [画廊与灯箱截图](/F:/token/agentic-usage-hub/output/frontend-motion/final/screenshots/gallery-lightbox-desktop.png)
- [今日额度截图](/F:/token/agentic-usage-hub/output/frontend-motion/final/screenshots/today-quota-desktop.png)
- [三档动效设置截图](/F:/token/agentic-usage-hub/output/frontend-motion/final/screenshots/settings-motion-desktop.png)
- [390px 手机趋势截图](/F:/token/agentic-usage-hub/output/frontend-motion/final/screenshots/timeline-dark-mobile.png)
- [动效录屏 WebM](/F:/token/agentic-usage-hub/output/frontend-motion/final/motion-demo.webm)
- [原始动效结果 JSON](/F:/token/agentic-usage-hub/output/frontend-motion/final/motion-results.json)
- [真实关键帧采样结果](/F:/token/agentic-usage-hub/output/frontend-motion/final/native/motion-results.json)
- [跨分页定位、来源恢复等定向复核](/F:/token/agentic-usage-hub/output/frontend-motion/final/regressions/motion-results.json)

## 验证方法、限制与重现

运行环境：Windows、Node.js 24、Python Playwright / Chromium headless，浏览器上下文时区 Asia/Shanghai。自动化使用隔离的服务与 API 夹具，不扫描个人日志，不向外部服务写入。截图中的日期明确设置为 2026-10-18。

```powershell
npm test
npm run test:ui -- --artifacts output/frontend-motion/final/ui
npm run test:motion -- --artifacts output/frontend-motion/final --capture
# 单独复核真实中间帧及中断
npm run test:motion -- --check 'rapid interruption and numeric correctness' --artifacts output/frontend-motion/final/native
```

持续更新检测通过 PerformanceObserver 记录长任务，并追踪会话区节点数量、对象身份以及收敛后的动效任务数。它证明该夹具与当前 headless 环境下的行为；没有把结果外推为所有设备的帧率或完整真实日志的性能。后台检查使用可重复的 visibilitychange 信号；触摸检查另开 coarse pointer / hasTouch 的浏览器上下文。

## 实施中的修正

- 回归发现额度摘要局部 helper 与动效文字 helper 同名，已修复，并通过原有金额口径与额度窗口检查。
- 触摸验证发现 sticky hover 可能遗留卡片上浮，已将上浮明确限制到 `hover: hover` 且 `pointer: fine`。
- 关闭详情时保留当前高度，取消旧动画后接续；不再在高度变化结束后重复播放邻卡重排。
- 图例聚焦使用不可变的原始颜色列表，避免反复悬停 / 键盘聚焦不断叠加透明度。
- 实时读取失败保留上次成功数据是本轮有意的行为变化，旧测试的“失败清空数值”断言已替换为旧值与旧数据标签同时保留。
- 不可用来源恢复到相同速率时，数字缓存仍能正确恢复；额外测试覆盖了未知值 → 原数值的情况。
- 逐项核对补齐了今日画廊日期上下文、请求明细分页方向、小趋势图未变时静止，以及主要工程的跨分页键盘定位。

本报告的改动范围依据本轮开始时的工作区快照核对。仓库原有大量未提交修改没有回退，也不计入本轮实施成果。
