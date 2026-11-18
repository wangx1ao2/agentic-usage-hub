# 业务 API 用量监控

配置项目根目录即可读取业务响应的 token 用量，无需修改正在运行的 boss 服务。

在本地 `.env` 中设置：

```dotenv
BUSINESS_API_PROJECTS=E:\boss
```

多项目在 Windows 上以分号分隔，在 Linux/macOS 上以冒号分隔。该设置属于本机配置，不应把个人项目路径写入公共默认配置。

## 纳入范围

- 读取所配置项目 `.local/` 与 `logs/` 下的 `.log` 文件，解析 `AiService - AI响应: id=..., time=..., model=..., promptTokens=..., completionTokens=..., totalTokens=...`。
- 支持这些目录里的 `ai-usage.jsonl`，用于读取带缓存明细或实际金额的结构化记录。
- 不读取 API 密钥，不保留请求内容或模型回复；派生账本仅记录请求标识、时间、模型、项目和用量等元数据。
- 排除备份、测试及 `model-comparison` 目录。同一项目、同一请求 ID 在多份日志中只计一次。
- 使用独立的 `api` 来源，模型显示为 `模型名 (业务 API)`；计入总量、今日、项目、模型、厂商、请求明细以及 JSON/CSV 导出。
- `boss` 业务请求归属配置的 boss 根目录，不归属监控面板工程，也不与开发 Codex 会话混算成同一条请求。

面板提供“业务 API”来源筛选。HTTP 请求可使用 `agent=api`，例如 `/api/dashboard?agent=api` 和 `/api/usage-records?agent=api`。MCP 范围及项目查询同样支持此来源。

## 金额口径

1. 日志包含 `costUSD` 时保留其报告金额。
2. 只有 token 时采用项目已有模型目录费率，标为费用估算。
3. 旧日志缺少缓存拆分时，把全部输入视为新输入。此估算可能偏高，不能视为服务商实际账单；token 总量仍是日志实测值。
4. ChatGPT 本地桥接记录为订阅使用的 API 目录价等值，不代表额外支付了 API 费用。
5. 未知型号保留实测 token，费用维持未知，避免套用另一个模型的价格。

结构化记录示例：

```json
{"requestId":"chatcmpl-example","timestamp":"2026-10-28T19:00:00+08:00","model":"gpt-6.1-terra","billingMode":"api","usage":{"prompt_tokens":1000,"completion_tokens":100,"total_tokens":1100,"prompt_tokens_details":{"cached_tokens":800}}}
```

如果另有实际金额，可添加数值型 `costUSD`。结构化缓存明细会补充同一个请求 ID 的旧日志记录，不会再加一次用量。输出 token 已包含推理 token，不重复相加。

## 持续更新和历史保留

只要面板服务运行，后台每 10 秒采集一次，即使关闭面板页面也会保留后续业务请求。面板打开时约每 60 秒自动更新显示；手动刷新立即重新检查。新增行按文件指纹识别，不依赖文件修改时间单独判断增长。

已观察到的记录写入本机缓存目录下 `business-api/` 的追加式元数据账本，日志轮转、截断或面板重启后继续保留。日志末尾未完成的行暂不统计，写完后再读取；损坏或不可写的账本会明确报告来源异常，不覆盖原文件。

缓存目录默认是 `~/.cache/agentic-usage-hub`，可通过 `AGENTIC_CACHE_DIR` 修改。更换缓存目录或更改整个项目配置集合时，需要保留原账本以保留已轮转日志的历史。原始项目日志不会被修改。

## 五小时额度与订阅桥接

`billingMode: "chatgpt-subscription"` 的请求也计入 Codex 额度页的当日金额、所在五小时窗口及每 100% 额度的 API 等值；独立付费 API 不计入此页。没有会话 `quotaReset` 的临时请求按已知账号窗口的起止时间归属；没有可对应窗口时保留在当日金额中，显示为未归属金额，不推算额度百分比。

账号联网查询默认关闭，与业务 API 项目配置独立。设置 `CODEX_ACCOUNT_QUOTA_ENABLED=1` 后，服务后台每 30 秒通过 Codex App Server 的 `account/rateLimits/read` 读取一次账号真实额度，手动刷新会立即读取。此操作只查询账号，不启动对话、不调用模型。自动寻找 PATH 或项目 `.runtime/codex-cli` 中已安装的 CLI，也可用 `CODEX_QUOTA_BIN` 指定可执行文件。采集结果保存在缓存目录 `codex-quota/`，面板重启后继续合并；读取失败保留旧快照并在来源诊断中报告异常。设置 `CODEX_ACCOUNT_QUOTA_DISABLED=1` 可禁用联网额度读取。

空闲期间的账号查询可能返回 `0%`，并将重置时间持续更新为查询时间加五小时。这是待启用额度的占位快照，不代表产生调用或启动了一个使用窗口。窗口以非零额度记录或带明确额度标记的实际请求为依据；零用量查询仅补充已有真实窗口的基线，不得创建空闲窗口、改变真实窗口起点或重复累计后续用量。历史数据在每次重算时执行同一规则，原始快照保留。

桥接程序应在发送响应前将 `requestId`、带时区的 `timestamp`、`model`、`billingMode` 与原始 `usage` 写入 `.local/codex-bridge/ai-usage.jsonl`。这样直接调用桥接 API 也有记录，且保留精确缓存命中数据；与业务日志中的同一请求合并计一次。无需开启会话日志，也不记录提示词、回复或密钥。

若旧的临时调用未保存额度快照，可用 `createAccountQuotaMonitor().confirmWindow({ resetsAt, usedPercent, note })` 保存用户明确确认的历史校正。此记录单独标注“用户确认用满”，保留确认时间和说明，不伪装成实时观测，也不声称知道首次达到 100% 的时间。旧日志没有缓存明细时仍按全部新输入估算费用，无法事后恢复精确缓存费用。

协议参考：[OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server)。
