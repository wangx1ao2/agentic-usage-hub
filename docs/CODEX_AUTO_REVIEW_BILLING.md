# codex-auto-review 的模型名称与计费

核查日期：2026-10-28。

## 当前结论

`codex-auto-review` 是自动权限审批的路由名称。它对应 guardian 审批请求，不能根据主会话模型直接确定其底层模型，也不应将它显示为 GPT-5.5。

OpenAI 帮助中心目前明确说明：使用 ChatGPT 账号登录时，自动审批安全检查免费，不占套餐使用额度。这项政策不能直接套用于第三方中转的报价。免费也不代表没有产生 token；这些 token 仍应保留在用量统计里。

根据用户指定的估算口径，面板保留原始名称和 token，并按 GPT-6.1 Sol 的参考费率计算：每百万新输入 $2、缓存输入 $0.10、输出 $10。此费率是用户选择的假设，并非实际底层模型或真实扣费的证明。日用量、模型、项目和五小时统计采用同一估算口径。

## 资料与论坛核查

- [OpenAI 帮助中心：Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan#auto-review)：当前免费政策的一手来源，适用条件是 ChatGPT 账号登录。
- [OpenAI 社区：Auto-Review usage is absurd，2026-10-24 回复](https://community.openai.com/t/auto-review-usage-is-absurd/1395145/8)：说明旧的额度投诉发生在免费政策实施之前，不能用早期投诉代表当前规则。
- [OpenAI 社区：Guardian 与 Luna，2026-10-08 回复](https://community.openai.com/t/reset-day-17-of-28-days-of-quality-of-life-improvements-and-or-a-full-reset/1403525/28)：提及 Luna 执行安全约束，但不能据此锁定所有时间、所有接入方式的型号或费率。
- [LINUX DO：codex-auto-review 好像并不免费，2026-10-21](https://linux.do/t/topic/3053720)：发帖者使用 CLIProxyAPI 聚合账号，观察到额度下降，并猜测与 GPT-5.6 Luna 费率相符。这是用户观测，无法证明免费政策普遍未生效，也不能作为统一价格依据。
- [Reddit：What's codex-auto-review?，2026-08-08](https://www.reddit.com/r/codex/comments/1vixf5w/whats_codexautoreview_it_burned_almost_all_my/)：评论混有权限审批、子代理和 GitHub 代码审查的不同解释，且早于 10 月免费政策，不采用其中的价格推测。
- [V2EX：关于模型路由的讨论，2026-09](https://us.v2ex.com/t/1241734)：有评论把自动审批与 Luna 调用关联；不构成经过验证的计费标准。
- [CodexBar issue #4452](https://github.com/steipete/CodexBar/issues/4452)：另一个用量工具也遇到此路由缺乏公开目录价格的问题。讨论提出依据认证信息和时间识别免费请求，同时指出历史认证及政策生效时间的边界需要核实。

## 统计修复

在 ccusage 日汇总与原始请求的普通输入、缓存输入、输出三项完整对齐时，依据原始日志恢复模型分组。真实 GPT-5.5 请求保留；其他来源的统计保留；缺失或不一致的数据不进行猜测性拆分。

`codex-auto-review` 不采纳 ccusage 的回退价格。旧缓存若包含完整原始请求索引，首次加载时会按上述假设重新计价并修复名称，再刷新索引。请求有速度和长上下文记录时，沿用面板对 GPT-6.1 Sol 的逐请求参考价规则；缺少速度记录时按标准速度估算。

官方 ChatGPT 登录免费政策及论坛观测仍见上面的来源；本面板中的金额是用户指定的假设，不作为官方额度扣减的结论。
