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

待实施：现有逐请求长上下文逻辑主要覆盖 GPT-6，官方 GPT-5.4、5.5、5.6 型号页也有超过 272K 的输入/输出调整规则，需要按型号补齐，并同步历史费率重算。速度、缓存、适用范围和优惠到期必须逐项处理，不能把所有厂商套同一个倍率。

GPT-5.6 Sol 的优惠期限在官方页标为 2026-11-30。后续维护需要复核到期行为，不自动猜测到期后的新价。

## 已发现的 Gemini 基础费率差异

依据：[Google 官方价格页](https://aistudio.google.com/docs/pricing)。

| 型号 | 当前代码（新输入 / 缓存读 / 输出） | 已核对标准价 | 状态 |
| --- | --- | --- | --- |
| Gemini 2.5 Flash | 0.15 / 0.0375 / 0.60 | 0.30 / 0.03 / 2.50 | 待修正并加回归 |
| Gemini 2.5 Pro，输入 ≤200K | 1.25 / 0.3125 / 5.00 | 1.25 / 0.125 / 10.00 | 待修正并加回归 |
| Gemini 2.5 Pro，输入 >200K | 无独立请求档位 | 2.50 / 0.25 / 15.00 | 需区分逐请求计价与日汇总参考 |

官方页还说明 2026-12-01 起两个旧型号会路由到后继型号并改变费用。后续实现需要明确目录适用日期及保存快照的语义，不能把将来路由费率当作所有历史请求的官方价格。

## 其他厂商

- [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)：当前已打开完整官方价目页；现有 Fable 5.1、Opus/Sonnet/Haiku 5.5 和部分旧型号的基础价对应。需要完成逐条来源记录、缓存写入及 Haiku 长输入档位审查；新增 Fable 5.2 不应通过旧型号模糊匹配借价。
- [xAI](https://docs.x.ai/developers/pricing)：已确认 Grok 4.7/4.6/4.5/4.3 及 4.20 系列、Build 0.1 的短上下文价目。官方有 200K 长上下文界限、地区和产品专用速度规则；旧型号需要单独检查，不用当前近似价冒充已核实费率。
- [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/)：Flash 与 V4 Pro 的现有峰时基础价对应；非峰时、旧别名和日期边界仍需记录。
- [Z.AI](https://docs.z.ai/guides/overview/pricing)：GLM-5.3、5.2、5.1、5、4.7/4.6、Flash/FlashX 价目已打开核对；旧 GLM-4-Plus 和档位差异仍需复核。
- [阿里云百炼](https://help.aliyun.com/zh/model-studio/model-pricing)：已打开官方人民币/地域价目。需逐条核对 Qwen 型号、部署地域、缓存费率与配置汇率，不能把旧 USD 常量直接当作当前全球价。
- 其他开源/托管模型：缺具体提供商时不能据模型名认定统一 API 单价。需核查现有 Kimi/Mistral/Codestral/Llama 参考值的来源与展示边界。

## 尚需完成

1. 实施已证实的费率修正及逐请求规则，给每条有效费率保存来源、核对时间、币种/地域与限制。
2. 对未知型号、个人假设和已过期/未核实参考值分别明确标识，保留未知金额。
3. 验证当前/保存版本重算、首次捕获金额及模型依据保持一致。
4. 更新价目抽屉、中英文 README 和发布说明，运行受影响回归与最终候选验证。

已完成的审批费率配置及跨进程历史保护见 [执行进度](STABLE_UPGRADE_PROGRESS.md)。本文件列出的待办仍属于原升级目标。
