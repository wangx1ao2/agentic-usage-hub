# 价格目录复核记录

日期：2026-11-19。对应更新计划 T05。初轮目录审查及 rc.2 自动化候选验证已完成，真实日历观察与发布待完成。目录单位为 USD / 百万 Token，费用为参考估算；本轮不推测真实订阅扣费。

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

## Qwen 地域、模式与缓存缺口

本轮用户选择中国内地／北京作为默认参考地域；配置键为 `QWEN_PRICING_REGION`。同时逐条核对已实现的全球与新加坡条目，未覆盖组合不跨地域借价。依据：[模型价目](https://help.aliyun.com/zh/model-studio/model-pricing)及[上下文缓存](https://help.aliyun.com/zh/model-studio/context-cache)。

下列为北京短输入 CNY / 百万 Token，均保留原币值并用配置汇率换算，单位费率不提前舍入。输入阶梯作用于整次请求，日总量不充当一次请求。

| 型号 | 输入 / 输出参考 | 已核对的限制 |
| --- | --- | --- |
| qwen-max | 2.4 / 9.6 | 仅隐式缓存命中价按输入 20% |
| qwen-plus | 0.8 / 非思考 2、思考 8 | 128K、256K 分档；思考模式缺失时输出金额未知 |
| qwen3-coder-flash | 1 / 4 | 32K、128K、256K 分档 |
| qwen3.8-max | 12 / 36 | 命中价需控制台核对；显式 5m 创建倍率 1.25 已公开 |
| qwen3.8-flash | 0.8 / 2.7 | 创建和命中价均需控制台核对，当前未知 |
| qwen3.8-27b | 3 / 12 | 显式/隐式缓存模式分别处理 |
| qwen3.7-max | 12 / 36 | 显式/隐式缓存模式分别处理 |
| qwen3.7-plus | 1.6 / 6.4 | 当前别名限时八折，256K 分档；日期快照 2 / 8，不套别名优惠 |
| qwen3.7-flash | 0.2 / 0.8 | 32K、256K 分档 |

非例外的已支持型号，显式命中按输入的 10%、隐式命中按 20%；模式未知时不任选一种。缓存与 Batch 折扣不可组合，矛盾组合保留未知。Qwen3.8 的例外不得套通用比例。已实现 5 个有官方依据的快照 ID；未核对的版本或日期 ID 不模糊借价。

来源与报价缺口保存在 `pricingContext`，受影响 Token 由 `unpricedTokens` 表示。只剩未知组件时金额为 null；有可计价部分时保留小计并标记 `costComplete=false`。新测试覆盖已知 0 与未知、输入分档、缓存写入守恒、重启、汇率、地域、模式和快照优惠。

旧 Qwen 项的逐项处理见下表。当前官方主价目已不含这些条目，Qwen2.5 被明确列为下线、不可查询价格。部分历史型号页重定向至总目录，搜索缓存仍保留旧价格；不以搜索摘要、控制台 API 示例或其他产品的停售公告作为当前百炼费率依据。已停止使用这些常量产生新金额，旧记录及其快照保留。

## 29 个旧参考项的处理

5 个 Gemini 参考已核对 [当前价目](https://aistudio.google.com/docs/pricing)和[生命周期](https://aistudio.google.com/docs/deprecations)：3.8/3.6 Flash 为 0.75 / 0.075 / 3.75（截至 2026-12-31）；3.1 Flash-Lite 为 0.25 / 0.025 / 1.50；2.5 Flash-Lite 为 0.10 / 0.01 / 0.40。3.7 Flash 端点已路由到 3.8，采用带说明的当前路由参考，不推定历史请求使用了 3.8。3.x 的 Batch/Flex 缓存读半价；2.5 保持缓存读单价。Priority 使用官方列价。

5 个 Claude 历史参考由官方发布文章核对，表格为新输入 / 缓存读 / 输出；缓存读采用 [官方缓存倍率](https://platform.claude.com/docs/en/about-claude/pricing)，并保存[下线依据](https://platform.claude.com/docs/en/about-claude/model-deprecations)。标记为 `verified-historical`，不表示仍可调用，也不还原用户当时账单。

| 型号 | 历史参考价 | 依据 / 退役日期 |
| --- | --- | --- |
| Claude 3.7 Sonnet | 3 / 0.3 / 15 | [发布文章](https://www.anthropic.com/news/claude-3-7-sonnet)；2026-02-19 |
| Claude 3.5 Sonnet | 3 / 0.3 / 15 | [发布文章](https://www.anthropic.com/news/claude-3-5-sonnet)；2025-10-28 |
| Claude 3.5 Haiku | 0.8 / 0.08 / 4 | [官方更新](https://www.anthropic.com/news/3-5-models-and-computer-use)；2026-02-19 |
| Claude 3 Opus | 15 / 1.5 / 75 | [官方型号表](https://www.anthropic.com/news/claude-3-family)；2026-01-05 |
| Claude 3 Haiku | 0.25 / 0.025 / 1.25 | 同上；2026-04-20 |

其余 19 项标记 `reference-unavailable`，保留逐项原因及检查日期。这里的“无法核实”不等于一律认定正式下线：

| 项目 | 结果与依据 |
| --- | --- |
| claude-4-haiku | 官方目录未找到这个正式型号，不借 Haiku 4.5 / 3.5 价格 |
| grok-4 | 通用旧名无法唯一确定版本；官方只明确 grok-4-0709 的改路由，不推及所有别名 |
| grok-3 | [2026-05-15 改路由](https://docs.x.ai/developers/migration/may-15-retirement)到 4.3；后继价不作为原型号历史价 |
| grok-3-mini | 当前价格表不含；型号页重定向到目录。管理 API 示例 JSON 不作为当前在售价 |
| grok-2 | 当前价目不含，旧常量未找到可验证依据 |
| grok-2-vision | 当前价目不含，不套文本或后继视觉价 |
| grok-beta | 当前价目不含，预览名缺确定版本 |
| deepseek-chat | [官方下线公告](https://api-docs.deepseek.com/news/news260424/)：2026-07-24 15:59 UTC 后不可调用；不套 Flash 价 |
| deepseek-reasoner | 同上；该别名曾改路由，不认定所有记录都为最初 R1 |
| GLM-4-Plus | [Z.AI USD 价目](https://docs.z.ai/guides/overview/pricing)未列出；不跨站点、地域或提供商借价 |
| gemini-2.0-flash | 官方列为 2026-06-01 停服；当前价格表移除 |
| qwen3-max | 百炼当前价目移除，型号页重定向到目录，所选地域价格未核实 |
| qwen-turbo | 当前价目未列；地域及思考模式价未核实 |
| qwen3-coder-plus | 当前价目未列，不套 Coder Flash 价格或旧搜索摘要 |
| qwen3-235b-a22b | 未带版本的开源型号缺当前参考，不混用不同版本与托管商 |
| qwen-vl-max | 当前价目未列；不套 VL-OCR 或其他视觉型号 |
| qwq-32b | 当前价目未列；旧 USD 常量缺所选地域依据 |
| qwen-2.5-coder-32b | 百炼明确 Qwen2.5 已下线、不可查询价格 |
| qwen-2.5-72b | 同上；保留已捕获金额，不补造历史价格 |

Qwen 另参阅[下线机制](https://help.aliyun.com/zh/model-studio/model-depreciation)。部分公告正文未能读出型号 ID，未据此给全部缺失条目补上具体退役日期。

## 其他厂商

- [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)：现有活跃型号已核对；Opus 5.5 / 5 / 4.8 的 Fast 为 2 倍，支持型号美国地域为 1.1 倍，包含缓存分项；采用实际响应 `usage.speed` / `usage.inference_geo`，不取请求愿望值。Fast 与 Batch 矛盾时未知。Fable 5.2 不模糊借 5.1 的价。
- [xAI](https://docs.x.ai/developers/pricing)：已核对新型号 200K 边界、7 个型号 Batch 八折、Priority 2 倍。Cursor/Build 专用 Fast 不借作通用 API 档位；未提供美国端点信息时只按全局参考，不宣称含地域附加费。
- [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/)：Flash 与 V4 Pro 采用峰时参考。官方有工作日 UTC 01–04、06–10 峰时，排除中国节假日，其余半价。没有完整节假日依据时不自动推算非峰时折扣；日志有报告金额时优先保留。
- [Z.AI](https://docs.z.ai/guides/overview/pricing)：活跃目录已核对；未给出处的显式服务档位保持未知。旧 GLM-4-Plus 按上表处理。
- [阿里云百炼](https://help.aliyun.com/zh/model-studio/model-pricing)：地域、模式、快照及旧型号处理见上节。
- Kimi/Mistral/Codestral/Llama：模型名不能确定托管商；当前为 `provider-required`，不沿用无来源的原参考价。

## 订阅预设

官方入口：[Plus](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)、[Pro](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)、[Business](https://help.openai.com/en/articles/8792828-chatgpt-business-overview)、[Claude](https://claude.com/pricing)。预设只代表 USD 月付参考，地区、税费、席位数和实际支付可能不同。

| 兼容键 | 显示名称 | 月付参考 |
| --- | --- | --- |
| chatgpt_plus | ChatGPT Plus | $20/月 |
| chatgpt_pro | ChatGPT Pro 200 | $200/月；其他 Pro 档位使用自定义 |
| chatgpt_team | ChatGPT Business Standard | $25/席位/月；年付 $20/席位/月 |
| claude_pro | Claude Pro | $20/月；年付 $200/年 |
| claude_team | Claude Team Standard | $25/席位/月；年付 $20/席位/月 |

旧 Team 键及已存自定义金额兼容；默认周预算均为示例，不由订阅售价推算官方额度。自定义月费/预算允许 0，分别停用费用比值/预算进度；不改写为 $20/$130，也不把非零用量显示成零进度。年费由用户按实际支付除以 12。

## 已实施的兼容与展示

- 新快照包含基础价、逐请求规则和来源元数据，任一变化均产生不同版本。旧快照不补写新规则，继续原有运算。参考价过期、暂未定价或估算配置变更不会改变原记录的捕获身份。
- 72 条目录项为 `verified`，5 条为 `verified-historical`，19 条为 `reference-unavailable`，4 条为 `provider-required`；审批路由单独为 `user-assumption`。没有待审查的 `legacy-reference`，但核对状态不表示全组件都有价格，未公开或缺模式的金额继续未知。
- Haiku 5.5 长输入、Grok 已核对新型号的 200K 边界、Claude 缓存写入有效期拆分已接入共享规则。未知服务档位不能借其他型号倍率。
- 价目抽屉显示状态、核对日期、来源和有效期限；中英文 README 与迁移说明同步。`pricingContext` 随导出保留来源和缺口。
- rc.2 修正 Claude 家族的旧兜底匹配：`claude-4.1-opus`、`claude-4-opus`、`claude-mystery` 等缺确切参考时保留原名和未知金额，不改配其他 Sonnet 型号。旧捕获金额不改写，当前重算使用新规则；明确报告的 0 美元仍保留。此修正来自发布前复核现有问题 #2，原 rc.1 在观察开始前被替代。

## 验证与后续

1. rc.2 本机 212 项 Node、28 组 UI、15 组动效通过，包含保存版本重算、首次捕获金额、边界、实际速度/地域、零金额、未知型号及接口一致性；旧程序升级/回退演练通过。
2. 同一候选的实际包及完整远程 9 作业通过，详见 [候选验收](RELEASE_CANDIDATE_1.1.0-rc.2.md)。原计划的 3–5 天实际观察、npm 发布和发布后 24–48 小时复查尚未完成。
3. 后续更新时复核 2026-11-30 和 2026-12-31 的期限，新增费率继续形成独立目录快照；缺少组件仍保持缺口。

已完成的审批费率配置及跨进程历史保护见 [执行进度](STABLE_UPGRADE_PROGRESS.md)。本文件列出的待办仍属于原升级目标。
