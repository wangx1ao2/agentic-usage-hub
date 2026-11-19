# 1.1.0-rc.1 本地候选验收

日期：2026-11-19，Asia/Shanghai。对应原 [更新计划](UPDATE_PLAN_2026-11-18.md) T01–T12。

本次按用户选择先交付本地候选包，暂不登录或发布 npm。源码版本、tarball 与文档均为 `1.1.0-rc.1`，不表示已发布稳定版。功能冻结后如发现阻断问题，修复并生成新的候选版本；不把一个反复变化的包当作同一次观察。

## 本地交付物与安装

在项目根目录生成并验证持久候选包：

```powershell
npm run test:package -- --artifacts output/stable-upgrade/release/1.1.0-rc.1
```

该命令先做干净安装，再打包并实际安装同一个 tarball；另从全新的 npx 缓存验证包入口，执行 CLI、静态资源、HTTP、Worker、MCP、EOF 退出和四来源对账。只有完整通过才生成 `verification.json` 和 `SHA256SUMS.txt`。构建提交、时间、包内文件、体积、完整性摘要和 SHA-256 均保存在记录中。

产物目录为 `output/stable-upgrade/release/1.1.0-rc.1/`，已被 Git 忽略；不把安装包或个人本机数据提交进源码。

首次运行需要下载 npm 依赖，不需要 npm 登录。以下 PowerShell 命令从本地候选包启动，使用独立缓存，便于试用与回退：

```powershell
$candidatePackage = (Resolve-Path '.\output\stable-upgrade\release\1.1.0-rc.1\agentic-usage-hub-1.1.0-rc.1.tgz').Path
Get-FileHash -Algorithm SHA256 -LiteralPath $candidatePackage
$env:AGENTIC_CACHE_DIR = Join-Path $env:LOCALAPPDATA 'agentic-usage-hub-rc1'
npm exec --yes --package "$candidatePackage" -- agentic-usage-hub --port 4243
```

浏览器打开 `http://127.0.0.1:4243`。MCP 使用相同包入口，将最后一行改为：

```powershell
npm exec --yes --package "$candidatePackage" -- agentic-usage-hub --mcp
```

按 Ctrl+C 停止 HTTP；MCP 客户端关闭 stdin 后服务退出。账号额度默认不联网。Qwen 默认北京参考；若需本机原有 Sol 审批估算等个人设置，显式设置对应环境变量，见 [升级说明](UPGRADING.md)。不要删除旧缓存来开始试用。

## 阶段证据与边界

| 原计划项目 | 已有证据 | 边界 / 后续门槛 |
| --- | --- | --- |
| T01 源码与产物 | 分支 `codex/stable-release-prep`；基线 `4c2b3c9`；原工作区备份、哈希和 diff 留在本机 | `output/` 与制作资料不进入 npm 包；必要源码均已版本化 |
| T02 包与运行时 | manifest / lock 同名同版本同许可证；真实 npm ci、tarball 安装；Linux/Windows 22/24/26、macOS 24 | Node 22/20 按实际能力降级；Node 20 仅兼容路径，不延续上游安全支持 |
| T03 依赖契约 | ccusage 20.0.20 → 20.0.51 固定样本 Token 一致，Codex 1,100 + Claude 185；Chart.js 4.6.1 与静态文件同步 | 不扩大为所有上游来源都由 ccusage 纳入；只选 Codex/Claude/Grok |
| T04 统计与来源 | 统一请求账本、重复快照、缓存写入、轮转和筛选回归；真实 Codex 元数据与原生合计相同；业务抽样 599 条、0 解析错误 | Claude 网关样本与上游身份规则有已解释差异，其他来源无实样的继续标为夹具验证；见 [来源支持表](SOURCE_SUPPORT.md) |
| T05 价格 | 72 条当前参考、5 条官方历史参考；19 条不可核实、4 条需提供商均未知；审批假设独立；地域/模式/档位/期限、历史重算和订阅计费依据 | 未公开组件、缺模式、音频/图像/工具/存储等不由文本参考补造；见 [价格审查](PRICING_AUDIT_2026-11-19.md) |
| T06 本地与联网 | 默认禁用、业务日志与账号查询解耦、错误保留历史；手动真实额度 RPC 成功，不创建模型对话 | 日常启用需已登录 CLI 和显式配置；不把 RPC 检查变成模型调用 |
| T07 恢复 | 旧检查点源码 → 当前代码 → 恢复旧备份演练通过，保留轮转后 2 条业务请求、2 条额度、首次金额和旧目录重算；备份字节一致 | 此基线是升级前本地功能检查点，不是 npm 1.0.0；旧程序可能无法读取新可空价格，必须恢复备份 |
| T08 界面 | 211 项 Node、28 组 UI、15 组动效的阶段检查；三张当前界面预览由隔离合成日志生成并标注 | 合成截图不作为真实用户费用或来源版本证明；最终候选检查以对应提交为准 |
| T09 安装与断网 | [42725ed 全部 9 作业通过](https://github.com/wangx1ao2/agentic-usage-hub/actions/runs/44452252080)；Linux namespace 中外网 ENETUNREACH，四来源 1,465 Token、HTTP/MCP 相同，退出与清理正常 | Windows/macOS 是实际包与夹具检查，不声称这两者做过系统级断网；本次文档/入口收尾后再验证对应提交 |
| T10 文档 | 中英文 README、来源表、迁移/回退、变更记录同步；包内入口经 npm exec、CLI/HTTP/MCP 验证；截图可重建 | 正式版发布时还需统一正式版本号及截图标记 |
| T11 候选与发布 | 本地候选准备中；本页及产物校验记录用于评审 | npm 登录、next 发布、3–5 天实际观察、正式发布未完成 |
| T12 发布后 | 回退步骤及后续维护列表已准备 | 正式发布后 24–48 小时复查尚未发生 |

`d3b4f0c` 的[第十一轮 CI](https://github.com/wangx1ao2/agentic-usage-hub/actions/runs/44471359314) 全部 9 作业通过，包含首次 npx 缓存安装入口。本机还通过实际 `npm exec --package 本地 tarball -- --mcp` 完成初始化、工具调用、参数拒绝和 EOF 退出。未引用的 v1.0.0 社交预览已原样移入历史归档，排除在本次产品包外，当前三张截图保留。

本机 `npm audit --omit=dev` 在本次检查报告 0 个已知漏洞；这是当时审计库的结果。完整本地记录和逐轮 CI 修正见 [执行记录](STABLE_UPGRADE_PROGRESS.md)。打包文件和最终候选的精确摘要以 `verification.json` 为准。

性能基准使用同机 Node 24、24,000 行 / 26.48 MiB 隔离 Qwen 夹具。冻结代码测量为冷读 1,842.57 ms、追加 1,084.45 ms、静态 P95 3.71 ms、事件循环 P99 29.10 ms，达到原计划建议目标。这些值不是所有机器或真实全量日志的承诺。

## 实际观察记录

自动化重启、日期样本和短时资源测试已执行，但不替代原计划的 3–5 个日历日候选观察。

| 事项 | 状态 |
| --- | --- |
| 试用开始时间 / 候选 SHA-256 | 等实际启动后记录 |
| 多次刷新后 Token 与请求数不增长 | 待实际观察 |
| 重启后首次金额、业务账本与额度观察保留 | 待实际观察 |
| 至少跨过一次真实日期切换 | 待实际观察 |
| 日志轮转、额度重置或未知金额显示 | 待实际观察，不补造未发生事件 |
| 候选观察满 3–5 天且无 P0 | 待开始；当前未达成 |

阻断包括重复计数、历史丢失、安装包无法启动或 MCP 不可用。发现后记录触发条件、受影响范围和恢复结果，修复后生成新候选包，重新观察受影响流程。

## 后续发布与回退

用户决定恢复 npm 登录后，重新检查账号、包权限和 registry 中已有版本，保存原 `latest` 指向。以验证过的候选 tarball 发布 `next`，核对 registry 完整性摘要并重新从 registry 安装；不因源码标了版本号而视为发布成功。

候选观察通过后再生成 `1.1.0`，同步 manifest/lock、变更记录、界面预览与发布说明，重做版本相关安装检查。正式发布后验证 npm 版本、Git 标签和发布说明一致，并在 24–48 小时后复查 npx/HTTP/MCP 与关键数据。

若发生阻断回归，将 `latest` 恢复为发布前记录的已验证版本，保留问题包及诊断；持久数据按升级前备份恢复，另存新采集记录。此处是操作预案，尚未改变任何 dist-tag。

## 后续维护列表

- 兼容修复：补充目前仅夹具验证来源的真实脱敏样本及客户端版本；继续保留网关身份、日志缺字段与 Node 能力限制。
- 价格维护：2026-11-30 复核 GPT-5.6 Sol / Gemini 2.5 旧路由，2026-12-31 前更新 Gemini 3.8/3.6 新年价格；Qwen 别名优惠无公开结束日，定期复核。新目录继续生成新快照。
- 后续功能：预算提醒、更多 Agent、云端或团队协作、视觉或框架重做按下一版需求另行评估，不混入当前候选修复。
- 维护节奏：每周查 CI、安装与来源异常；每月核对活跃模型费率和上游变动，先做固定样本对照。
