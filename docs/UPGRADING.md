# 升级到 1.1.0 候选版

当前源码版本为 `1.1.0-rc.1`。正式发布、候选版观察和远程验证状态以 [变更记录](../CHANGELOG.md) 为准；源码中的版本号不表示 npm 已经发布。

## 运行环境

推荐 Node.js 24 或 26 LTS 的最新修订版。Node 22 根据 SQLite 和 Zstandard 的实际能力降级；启动提示和 `/api/capabilities` 会说明不可用的功能。保留 Node 20 的兼容路径，但该系列已经结束上游支持。参见 [Node.js 官方版本状态](https://nodejs.org/en/about/previous-releases)。

## 升级前备份

先退出看板及 MCP 服务，再复制整个派生数据目录。默认目录为 `~/.cache/agentic-usage-hub`，自定义位置以 `AGENTIC_CACHE_DIR` 为准；本机 `.env` 也需单独备份。备份包含本地路径等个人元数据，留在本机即可。

| 数据 | 位置 | 恢复策略 |
| --- | --- | --- |
| ccusage 派生汇总 | `ccusage-cache.json` | 可从尚存的原始日志重建；旧版本不兼容时会失效 |
| 文件/请求/看板索引 | `indexes/` | 带内容校验和运行环境身份，可重建，不修改源日志 |
| 业务 API 已观察请求 | `business-api/*.jsonl` | 应保留；已轮转的业务日志可能无法重新生成这些历史 |
| 账号额度观察与人工确认 | `codex-quota/*.jsonl` | 应保留；无法用 Token 数推算或恢复缺失的额度观察 |
| 首次索引价格和目录快照 | `pricing/history.json` | 应保留；删除会丢失首次捕获的价格依据 |

持久数据 schema 仍为 1。升级会按代码、目录和配置身份失效派生索引，不做破坏性原地迁移。账本损坏会报告错误并保留原文件；不要用“清空整个缓存”处理来源故障。

## 配置变化

### 联网账号额度查询改为显式启用

核心日志统计继续离线运行，无需登录或 API Key。仅配置 `BUSINESS_API_PROJECTS` 不再启动联网查询。希望读取账号额度时设置：

```dotenv
CODEX_ACCOUNT_QUOTA_ENABLED=1
# 可选，默认寻找本机已安装的 Codex CLI：
# CODEX_QUOTA_BIN=
```

需要已登录的 Codex CLI。读取通过官方 `account/rateLimits/read` 完成，不创建模型对话。`CODEX_ACCOUNT_QUOTA_DISABLED=1` 仍然有效，且优先于启用设置。未启用或读取失败时保留已保存的额度历史，业务日志统计独立运行。接口依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。

### 自动审批费率改为显式配置

`codex-auto-review` 是路由名称，不能据此认定实际模型和金额。公开默认值为未定价，Token 仍计入总量。若希望沿用之前选择的 Sol 估算：

```dotenv
CODEX_AUTO_REVIEW_RATE_MODEL=gpt-6.1-sol
```

也可选择目录中的其他已知模型；无效型号保留未定价。此配置只选估算费率，不表示实际扣费。修改配置后重启服务，价格版本按内容区分，已捕获的历史记录不会被静默替换。

“recorded”保留首次捕获金额及当时选择的参考模型，即使后来修改或关闭估算配置；需要比较新费率时切换为“current”重算。已报告的真实日志金额（包括 0）与目录估算分别处理。

### Qwen 默认采用北京参考地域

根据本轮选择，默认使用 `QWEN_PRICING_REGION=cn-beijing`。可显式设置已核对的 `global` 或 `intl-singapore` 条目，未覆盖的组合保持未知。`QWEN_USD_CNY_RATE` 默认 7.15，只是换算假设。来源依据保留原始 CNY 价格和参考地域，单位费率不提前截成三位小数。

缓存和思考模式会影响价格；日志不含模式、命中价只在控制台提供、或服务档位与缓存不能组合时不猜金额。Qwen 日期快照与别名优惠分别处理。修改后重启；“recorded”保留首次金额和缺口，“current”采用所选目录，不跨地域借价。

## 价格目录与历史兼容

新目录快照把计价规则和来源一并纳入内容身份；旧 schema 1 快照仍可读取并沿用旧运算口径，不会就地补写新规则。“recorded”保留首次捕获的金额与依据，包括价格过期后重新索引的记录。“current”按当前日期检查费率适用期限；显式指定某个已保存版本时按该版本捕获日期重算。

旧目录中没有某个型号或独立快照时，重算仍可为未知；不会为了给出金额而套用其他版本的型号或优惠。

价格来源在派生索引中共享保存，持久价格记录可以引用同一版本的快照证据；查询和导出仍提供完整依据。无来源的旧捕获不会补填当前来源；损坏的派生引用可重建，损坏的持久价格引用保留原文件并提示。部分价格未知时返回已知小计、`costComplete=false` 和 `unpricedTokens`。

2026-11-19 已核对的当前参考与官方历史参考分别标识；未能核实的 19 个旧参考停止新估价，保存金额和旧目录不改写。没有具体提供商的开源模型保留未知金额。Claude 缓存写入需日志中的有效期拆分，速度与地域取实际响应字段，显式服务档位需该型号已有依据。缺少请求明细时不把日总量套入长输入档位。目录初轮审查已实施，最终候选验收、观察和发布仍待完成。

### 订阅预设与实际支付

预设使用 2026-11-19 核对的 USD 月付参考。ChatGPT Team 改名为 Business Standard，保留原 `chatgpt_team` 配置键；Claude Team Standard 改为 $25/席位/月付，两个团队方案年付均以 $20/席位/月为参考。Pro $200 选项明确为 Pro 200。各方案展示官方依据、席位和计费周期，不把年付折算价当作月付。

已保存的自定义费用不因预设更新被覆盖。自定义可填写实际月费，年费除以 12；月费 0 时不计算费用比值，周预算 0 时停用预算进度。`DEFAULT_SUBSCRIPTION_FEE` / `DEFAULT_WEEKLY_ALLOWANCE` 仅作为自定义方案的初始值；所有预设周预算仍是示例，不代表官方额度。

## 安装和验证

从源码升级时执行 `npm ci`，然后运行 `npm test`、`npm run test:upstream` 和 `npm run test:package`。浏览器验证另需 Python、Playwright 和其 Chromium，可运行 `npm run test:ui` 与 `npm run test:motion`。

发布到 npm 后才可使用相应版本或 `@next` 标签。安装包验证会在隔离目录实际安装 tarball，检查 CLI 参数、静态资源、后台索引、HTTP、MCP 握手/工具/参数错误及 EOF 退出。

## 回退

退出新版本后切回之前已验证的程序版本，恢复升级前的派生目录备份和本机配置。原始 Agent 日志不需要恢复，因为本项目只读它们。将新版本采集的目录另存，避免覆盖新增的业务请求和额度观察；需要合并时按请求身份去重，不直接拼接或清空账本。

旧程序可能拒绝新目录中的可空价格，即使持久数据仍标为 schema 1。因此回退必须恢复备份，不能仅换回可执行程序；读取失败时应保留新目录以备后续恢复。

源码维护者可执行 `node scripts/check-recovery.cjs 4c2b3c9`，需要包含该检查点的 Git 历史和 tar。脚本只在隔离测试 HOME 内重建升级前源码、账本、价格和额度观察，演练日志轮转后的升级与备份回退，验证金额、历史和源文件哈希。该基线是本轮升级前的本地功能检查点，不是 npm 1.0.0 包；不把此演练扩大为所有旧包格式都已验证。

## English migration notes

Use a current Node 24/26 LTS patch. Stop both dashboard and MCP before backing up the entire configured cache directory and local configuration. Keep `business-api/`, `codex-quota/` and `pricing/history.json`; these contain observations that may not be reconstructible from rotated logs.

Online account reads now require `CODEX_ACCOUNT_QUOTA_ENABLED=1`, independently of API project paths. The existing disable flag takes precedence. Local statistics need no account. Reviewer routing IDs default to unknown cost; explicitly set `CODEX_AUTO_REVIEW_RATE_MODEL=gpt-6.1-sol` to retain the former optional estimate. Restart after changing configuration. Reverting requires the previous application version and the pre-upgrade cache/configuration backup; preserve newly collected observations separately.
