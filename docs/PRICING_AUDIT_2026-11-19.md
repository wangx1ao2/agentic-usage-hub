# 价格目录复核记录（进行中）

日期：2026-11-19。对应更新计划 T05。这是核对记录，尚未表示目录更新已全部实施或通过验收。目录单位为 USD / 百万 Token，费用为参考估算；本轮不推测真实订阅扣费。

## 已核对的活跃 OpenAI 型号

现有基础费率与下列官方型号页一致。表格顺序为新输入、缓存读、输出。

| 型号 | 费率 | 一手依据 |
| --- | --- | --- |
| GPT-6 Astra | 10 / 1 / 50 | [官方价格页](https://developers.openai.com/api/docs/pricing) |
| GPT-6.1 Sol | 2 / 0.1 / 10 | [型号页](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| GPT-6.1 Terra | 1 / 0.05 / 5 | [型号页](https://developers.openai.com/api/docs/models/gpt-6.1-terra) |
| GPT-6 Sol | 2 / 0.2 / 10 | [型号页](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| GPT-6 Luna | 0.1 / 0.01 / 0.5 | [型号页](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| GPT-5.6 Sol | 4 / 0.4 / 20 | [型号页](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| GPT-5.6 Terra | 2 / 0.2 / 12 | [型号页](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| GPT-5.6 Luna | 0.2 / 0.02 / 1.2 | [型号页](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| GPT-5.5 | 5 / 0.5 / 30 | [型号页](https://developers.openai.com/api/docs/models/gpt-5.5) |
| GPT-5.4 | 2.5 / 0.25 / 15 | [型号页](https://developers.openai.com/api/docs/models/gpt-5.4) |

已实施：逐请求长上下文覆盖上表 GPT-5.4、5.5、5.6 与 GPT-6 型号，并由请求计价和历史重算共享。速度档位按型号列出，不再给所有模型统一套 2/6 倍。缓存写入规则可在规范化记录具有可靠有效期拆分时使用；来源日志未提供拆分则保留缺口。

GPT-5.6 Sol 的优惠期限在官方页标为 2026-11-30。后续维护需要复核到期行为，不自动猜测到期后的新价。

## 已核对的较早 OpenAI 型号

下表基础价已逐一打开官方型号页核对，均与目录标准价一致；来源页面中的生命周期另记入证据。停售或弃用状态不表示日志中的历史金额可由当前价反推。

| 型号 | 新输入 / 缓存读 / 输出 | 一手依据 |
| --- | --- | --- |
| GPT-5.3 Codex | 1.75 / 0.175 / 14 | [型号页](https://developers.openai.com/api/docs/models/gpt-5.3-codex) |
| GPT-5.4 Mini | 0.75 / 0.075 / 4.5 | [型号页](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |
| o3-mini | 1.1 / 0.55 / 4.4 | [型号页](https://developers.openai.com/api/docs/models/o3-mini) |
| o1 | 15 / 7.5 / 60 | [型号页](https://developers.openai.com/api/docs/models/o1) |
| o1-mini | 1.1 / 0.55 / 4.4 | [型号页](https://developers.openai.com/api/docs/models/o1-mini) |
| GPT-4o | 2.5 / 1.25 / 10 | [型号页](https://developers.openai.com/api/docs/models/gpt-4o) |
| GPT-4o Mini | 0.15 / 0.075 / 0.6 | [型号页](https://developers.openai.com/api/docs/models/gpt-4o-mini) |

GPT-5.3 Codex 和 GPT-5.4 Mini 官方最大输入为 272K，超出时不套用 GPT-5.4 的长输入加价。GPT-5.4 Mini 的 Batch 输入、输出和缓存价另由 [官方完整价目表](https://developers.openai.com/api/docs/pricing) 核对。其余未验证的显式服务档位仍返回未知。

## 已发现的 Gemini 基础费率差异

依据：[Google 官方价格页](https://aistudio.google.com/docs/pricing)。

| 型号 | 升级前（新输入 / 缓存读 / 输出） | 已核对标准价 | 状态 |
| --- | --- | --- | --- |
| Gemini 2.5 Flash | 0.15 / 0.0375 / 0.60 | 0.30 / 0.03 / 2.50 | 已修正，有回归 |
| Gemini 2.5 Pro，输入 ≤200K | 1.25 / 0.3125 / 5.00 | 1.25 / 0.125 / 10.00 | 已修正，有回归 |
| Gemini 2.5 Pro，输入 >200K | 无独立请求档位 | 2.50 / 0.25 / 15.00 | 已按请求实施；日汇总保留上下文缺口 |

官方页还说明 2026-12-01 起两个旧型号会路由到后继型号并改变费用。已为当前旧路由参考价标记到期，未猜测后继路由价格。“current”在过期后返回未知，“recorded”保留首次金额，显式选择旧目录版本按其捕获日期重算。Batch/Flex 折扣仅应用输入/输出，缓存读保持表列价格。

## 其他厂商

- [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)：当前已打开完整官方价目页；现有 Fable 5.1、Opus/Sonnet/Haiku 5.5 和部分旧型号的基础价对应。需要完成逐条来源记录、缓存写入及 Haiku 长输入档位审查；新增 Fable 5.2 不应通过旧型号模糊匹配借价。
- [xAI](https://docs.x.ai/developers/pricing)：已确认 Grok 4.7/4.6/4.5/4.3 及 4.20 系列、Build 0.1 的短上下文价目。官方有 200K 长上下文界限、地区和产品专用速度规则；旧型号需要单独检查，不用当前近似价冒充已核实费率。
- [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/)：Flash 与 V4 Pro 的现有峰时基础价对应；非峰时、旧别名和日期边界仍需记录。
- [Z.AI](https://docs.z.ai/guides/overview/pricing)：GLM-5.3、5.2、5.1、5、4.7/4.6、Flash/FlashX 价目已打开核对；旧 GLM-4-Plus 和档位差异仍需复核。
- [阿里云百炼](https://help.aliyun.com/zh/model-studio/model-pricing)：已打开官方人民币/地域价目。需逐条核对 Qwen 型号、部署地域、缓存费率与配置汇率，不能把旧 USD 常量直接当作当前全球价。
- 其他开源/托管模型：缺具体提供商时不能据模型名认定统一 API 单价。需核查现有 Kimi/Mistral/Codestral/Llama 参考值的来源与展示边界。

## 已实施的兼容与展示

- 新快照包含基础价、逐请求规则和来源元数据，任一变化均产生不同版本。旧快照不补写新规则，继续原有运算。参考价过期、暂未定价或估算配置变更不会改变原记录的捕获身份。
- 53 条基础参考价标记本轮已核对，38 条旧参考值仍明确标为 `legacy-reference`，4 条缺具体提供商的模型标为 `provider-required`；审批路由单独标为 `user-assumption`。这些状态没有把未复核工作改写为完成。
- Haiku 5.5 长输入、Grok 已核对新型号的 200K 边界、Claude 缓存写入有效期拆分已接入共享规则。未知服务档位不能借其他型号倍率。
- 价目抽屉显示状态、核对日期、来源和有效期限；中英文 README 与迁移说明同步。`pricingContext` 随导出保留来源和缺口。

## 尚需完成

1. 继续逐条复核 38 条旧参考价，尤其是 Qwen 的地域、人民币、缓存、长输入和汇率精度；不把加状态标签视为已完成价格审查。
2. 核对其他来源日志的服务档位和缓存写入字段是否有足够依据进入新规则；未支持字段保持缺口。
3. 在最终目录上复验保存版本重算、首次捕获金额、边界与各接口一致性。
4. 完成真实候选包和远程矩阵验证，随后才进入原计划的候选观察与发布。

已完成的审批费率配置及跨进程历史保护见 [执行进度](STABLE_UPGRADE_PROGRESS.md)。本文件列出的待办仍属于原升级目标。
