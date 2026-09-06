# 🚀 Agentic Usage Hub 曝光推广全套物料与发布执行指南

本文档汇集了 **Agentic Usage Hub** 上线推广所需的全部即用型物料（包括 GitHub 仓库配置、npm 发布命令、海外社区帖子、国内技术长文、awesome-lists PR 文案与 Product Hunt 资产）。

> 💡 **所有对外文案已严格遵循「红线清单」**：无敏感 API Key、数据与代码实现 100% 对齐、格式符合各社区规则。

---

## 目录
1. [Phase 1: GitHub 仓库网页端 2 分钟配置指南](#一phase-1-github-仓库网页端-2-分钟配置)
2. [Phase 1.3: GitHub Release v1.0.0 页面发布文案](#二phase-13-github-release-v100-发布文案)
3. [Phase 2: npm 一键发布与验证指令](#三phase-2-npm-一键发布与验证指令)
4. [Phase 4: Awesome Lists 收录 PR 文案包](#四phase-4-awesome-lists-收录-pr-文案包)
5. [Phase 5.1 & 5.2: 海外社区发帖物料 (HN / Reddit)](#五phase-51--52-海外社区发帖物料-hn--reddit)
6. [Phase 5.3: 国内社区长文与精炼帖 (掘金/知乎/V2EX/即刻)](#六phase-53-国内社区长文与精炼帖)
7. [Phase 5.4 & 5.5: Product Hunt 与 X (Twitter) 推文物料](#七phase-54--55-product-hunt-与-x-推文物料)

---

## 一、Phase 1: GitHub 仓库网页端 2 分钟配置

请打开仓库主页：👉 [https://github.com/wangx1ao2/agentic-usage-hub](https://github.com/wangx1ao2/agentic-usage-hub)

### 1. 填写 Description & Website (点击右侧 About ⚙️ 图标)
- **Description** (直接复制粘贴)：
  ```text
  Local-first token usage, cost dashboard & MCP server for AI coding agents — Codex CLI, Claude Code, Gemini/Antigravity, Grok, DeepSeek, ZCode. One npx command, zero config, 100% offline.
  ```
- **Website**: 留空，或填 `https://www.npmjs.com/package/agentic-usage-hub`
- **Include in home page**: 勾选 Releases, Packages, Environments

### 2. 添加 Topics 标签 (在 About 对话框中粘贴添加，共 20 个上限)
```text
ai-agent, llm, token-usage, usage-analytics, cost-tracking, llm-observability, dashboard, developer-tools, nodejs, self-hosted, claude-code, codex-cli, openai, gemini, antigravity, grok, deepseek, zhipu, model-context-protocol, mit-license
```

### 3. 上传 Social Preview 社交分享大图
- 打开仓库 **Settings** → **General**
- 向下滚动找到 **Social preview** 区域
- 点击 **Edit** → **Upload an image**
- 选择已在本地生成的现成高质量大图：
  👉 `F:\token\agentic-usage-hub\docs\images\social-preview.png` (1280×640 像素，包含六大厂商徽标与大屏预览，完全符合 GitHub 规范)

### 4. 开启 Discussions 讨论区 (低门槛反馈渠道)
- 在 **Settings** → **General** 的 Features 区域
- 勾选 **Discussions**

---

## 二、Phase 1.3: GitHub Release v1.0.0 发布文案

Git 标签 `v1.0.0` 已在远程仓库打好并推送。请在浏览器打开：  
👉 [https://github.com/wangx1ao2/agentic-usage-hub/releases/new?tag=v1.0.0](https://github.com/wangx1ao2/agentic-usage-hub/releases/new?tag=v1.0.0)

- **Release title**:
  ```text
  v1.0.0 — Multi-Agent Token Telemetry, Cost Attribution & MCP Server
  ```
- **Release notes** (直接复制粘贴)：
  ```markdown
  ### 🚀 What's New in v1.0.0

  We are excited to announce the first official release of **Agentic Usage Hub**!

  Agentic Usage Hub is a lightweight, local-first telemetry dashboard and Model Context Protocol (MCP) server designed for developers using AI coding assistants.

  #### ✨ Key Highlights
  - **Six-Agent Unified Analytics**: Seamlessly aggregates tokens, prompt-cache hits, and USD costs across **OpenAI Codex CLI**, **Anthropic Claude Code**, **Google Gemini / Antigravity**, **xAI Grok CLI**, **DeepSeek OpenClaw / Reasonix**, and **智谱 AI ZCode**.
  - **Zero-Config Launch**: Run instantly anywhere via `npx agentic-usage-hub` (Node.js ≥ 20).
  - **Native MCP Server**: Launch with `npx agentic-usage-hub --mcp` to expose telemetry tools (`get_usage_today`, `get_usage_range`, `get_project_breakdown`) directly to Claude Code, Cursor, and Windsurf.
  - **Interactive Panoramic Timeline**: Drilldown by vendor/company or by individual core model with logarithmic scales and date presets.
  - **Live Today Summary**: Real-time cross-vendor token throughput and GPT-Image-2 generation tracking.
  - **Local Workspace Attribution**: Automatically clusters physical directories and Git worktrees to attribute token burn to concrete projects.
  - **100% Local & Privacy-Preserving**: Runs purely offline, zero telemetry sent upstream, zero external API keys needed.
  - **Automated Test Suite**: 31 unit & integration test cases verified across Node.js 20.x, 22.x, and 24.x.

  #### 📦 Quick Start
  ```bash
  npx agentic-usage-hub
  ```
  ```

---

## 三、Phase 2: npm 一键发布与验证指令

> ⚠️ **说明**：包名 `agentic-usage-hub` 已核实 100% 可用且未被占用。打包内容已预先执行 `npm pack --dry-run` 校验（仅包含 bin、mcp、public、核心适配器与文档，排除任何私有敏感数据，解包仅 1.6MB）。

在终端中执行以下两行完成发布：

```bash
# 1. 登录你的 npm 账号（若未登录）
npm login

# 2. 正式公开发布
npm publish --access public
```

### 发布后自动验证命令：
```bash
# 查看远端 npm 元数据
npm view agentic-usage-hub

# 验证通过 npx 拉取运行
npx agentic-usage-hub@latest --help
```

---

## 四、Phase 4: Awesome Lists 收录 PR 文案包

### 1. `hesreallyhim/awesome-claude-code` (⭐ 50k+)
- **分支建议**: `add-agentic-usage-hub`
- **插入位置**: Developer Tools / Observability 区块
- **条目内容**:
  ```markdown
  * [agentic-usage-hub](https://github.com/wangx1ao2/agentic-usage-hub) - Local-first token telemetry and USD cost dashboard for Claude Code and 5 other AI coding agents with built-in MCP server support.
  ```
- **PR 标题**: `Add agentic-usage-hub to developer tools`
- **PR 说明**:
  ```markdown
  ### What does this tool do?
  Agentic Usage Hub provides an offline, zero-config local dashboard and MCP server that tracks Claude Code (and other AI coding agents) token consumption, prompt-cache hits, and estimated USD costs with project attribution.

  ### Why is this useful for Claude Code users?
  Developers using Claude Code can now visualize their session spend alongside other tools they run, and use it as an MCP server (`npx agentic-usage-hub --mcp`) so Claude can directly answer "What did I spend on AI today?".
  ```

### 2. `e2b-dev/awesome-ai-agents` (⭐ 29k+)
- **分支建议**: `add-agentic-usage-hub`
- **插入位置**: Developer Tools / Agent Monitoring
- **条目内容**:
  ```markdown
  * [Agentic Usage Hub](https://github.com/wangx1ao2/agentic-usage-hub) - Local-first token usage, cost attribution dashboard and MCP server for AI coding agents.
  ```
- **PR 标题**: `Add Agentic Usage Hub to Agent Developer Tools`
- **PR 说明**:
  ```markdown
  Hi maintainers! Agentic Usage Hub is an open-source (MIT), local-first telemetry dashboard for tracking token throughput, cache hit rates, and USD costs across multiple AI coding agents (Codex, Claude, Grok, Gemini, DeepSeek, ZCode). Completely offline with zero external network dependencies.
  ```

### 3. `ccusage` GitHub 讨论区发帖 (Show & Tell)
- **URL**: `https://github.com/ccusage/ccusage/discussions`
- **标题**: `Agentic Usage Hub: Built a multi-agent visual dashboard & MCP server powered by ccusage`
- **内容**:
  ```markdown
  Huge thanks to the ccusage team for building such a clean CLI for Claude Code token tracking!

  We love ccusage and wanted a unified, local visual dashboard that brings together ccusage data alongside other coding agents we use (OpenAI Codex, Grok, Gemini/Antigravity, DeepSeek, ZCode).

  We built **Agentic Usage Hub** (MIT):
  - ⚡ `npx agentic-usage-hub` — launches an offline local web dashboard on localhost:4242
  - 🤖 `npx agentic-usage-hub --mcp` — exposes `get_usage_today`, `get_usage_range`, and `get_project_breakdown` tools as a native MCP server
  - 📈 Timeline with logarithmic scaling, live today metrics, and local project workspace attribution.

  Check it out here: https://github.com/wangx1ao2/agentic-usage-hub
  Feedback and ideas are warmly welcome!
  ```

---

## 五、Phase 5.1 & 5.2: 海外社区发帖物料 (HN / Reddit)

### 1. Hacker News (Show HN)
- **Title**: `Show HN: Agentic Usage Hub – Local token and cost dashboard for AI coding agents`
- **URL**: `https://github.com/wangx1ao2/agentic-usage-hub`
- **First Comment (自己坐楼主位跟帖)**:
  ```markdown
  Hi HN! Over the past few months, our development workflow shifted to combining multiple AI coding assistants: OpenAI Codex CLI, Claude Code, Grok, Gemini/Antigravity, DeepSeek, and ZCode.

  While ccusage is fantastic for Claude Code in the terminal, every tool logs usage in a completely different location, with different schema and inconsistent prompt-cache discount accounting. We found ourselves constantly wondering: "How much did AI actually cost me across all these agents this week, and which projects burned the most tokens?"

  So we built **Agentic Usage Hub**:
  - **Local-First & Zero Config**: `npx agentic-usage-hub` parses existing session logs read-only and opens a lightweight dashboard on localhost:4242.
  - **100% Offline**: No accounts, no credentials, zero telemetry sent to any remote server.
  - **Multi-Agent Normalization**: Standardizes token volume, prompt cache reads/writes, and USD pricing using official catalog tariffs.
  - **Native MCP Server**: Run `npx agentic-usage-hub --mcp` to let Claude Code or Cursor answer usage and cost questions right in chat via Model Context Protocol.
  - **Zero Heavy Frameworks**: Native Node.js HTTP server, vanillajs SPA, Glassmorphism CSS, and local Chart.js.

  Repo: https://github.com/wangx1ao2/agentic-usage-hub
  npm: https://www.npmjs.com/package/agentic-usage-hub

  We would love your thoughts on log-parsing corner cases or other AI coding agents you'd like to see supported!
  ```

### 2. Reddit (r/ClaudeAI & r/ChatGPTCoding)
- **Title**: `I was burning tokens across Claude Code and Codex with zero visibility, so I built an offline multi-agent cost dashboard (open source)`
- **Body**:
  ```markdown
  Like many here, I use multiple AI coding tools depending on the task — Claude Code for complex refactors, Codex CLI for fast patches, and DeepSeek / Gemini when experimenting.

  The problem: each tool has its own proprietary pricing, caching discounts, and isolated log directories. Token burn was basically invisible until the credit card statement arrived.

  I built a local-first dashboard called **Agentic Usage Hub**:
  - One command to run: `npx agentic-usage-hub` (no git clone needed)
  - Aggregates Claude Code, Codex, Grok, Gemini, DeepSeek, and ZCode into a single local dashboard
  - Shows real-time "Today Live" metrics, cost per model, cache hit savings, and workspace project attribution
  - Also works as an MCP server (`npx agentic-usage-hub --mcp`), so you can ask Claude in terminal: *"How many tokens did I use today?"*
  - Completely offline: no API keys required, reads logs read-only, zero phone-home telemetry.

  Open source (MIT): https://github.com/wangx1ao2/agentic-usage-hub

  Hope it helps anyone else keeping an eye on their agent token spend!
  ```

### 3. Reddit (r/LocalLLaMA)
- **Title**: `Agentic Usage Hub: Local-first telemetry parser & dashboard for AI coding agents (Node.js, 100% offline, zero telemetry)`
- **Body**:
  ```markdown
  Hey r/LocalLLaMA,

  Sharing an open-source utility for developers monitoring token throughput and API costs across coding agents: **Agentic Usage Hub**.

  Key technical details:
  - **Reverse-Engineered Log Parsers**: Parses local SQLite databases (ZCode), session JSONL files (Codex), trajectory traces (DeepSeek / OpenClaw), and Antigravity logs in read-only mode with timestamp-based mtime caching.
  - **Official Rate Normalization**: Standardizes prompt caching read/write discounts per model.
  - **Heuristic Workspace Clustering**: Automatically clusters physical Git worktree paths to attribute token volume and USD cost per project.
  - **Zero Cloud Footprint**: Runs completely on localhost, no credentials or keys needed, strict path-traversal prevention.
  - **MCP Stdio Server**: Built-in JSON-RPC 2.0 stdio server (`--mcp`) exposing `get_usage_today`, `get_usage_range`, and `get_project_breakdown`.

  GitHub: https://github.com/wangx1ao2/agentic-usage-hub
  ```

---

## 六、Phase 5.3: 国内社区长文与精炼帖

### 1. 掘金 / 知乎 3000 字深度技术长文（完整可发布）

> **文章标题**：一行命令看清 AI 账单：我用 Node.js 写了一款多 Agent 本地 Token 计量看板与 MCP 引擎  
> **标签**：`人工智能` `Node.js` `前端` `Claude` `开源项目`

#### 引言：多 Agent 编程时代的「隐形开销」痛点
在当前的日常研发工作中，相信很多开发者和我一样，已经习惯了“组合拳”式的 AI 编程流：
- 用 **Claude Code** 做复杂的架构重构与跨模块编写；
- 用 **OpenAI Codex CLI** 处理单文件快速补全与生图；
- 配合 **DeepSeek** 做深思与算法推演；
- 在团队内部环境跑 **智谱 ZCode** 或 **Google Antigravity**。

然而，爽快的背后却隐藏着一个巨大的烦恼——**Token 消耗与成本完全失控**。
各家工具的订阅制、按量计费、Prompt 缓存折扣、日志存放位置以及时间戳格式完全不同。月底收到扣费通知时，根本无从得知究竟是哪个 Agent 占了大头，哪次迭代消耗了最多 Token，哪个工程最“烧钱”。

为了解决这个痛点，我开发了 **Agentic Usage Hub** —— 一款零外部依赖、100% 纯本地运行的多智能体 Token 计量与成本归因面板，并原生集成了 Model Context Protocol (MCP) 服务。

---

#### 核心设计与技术解密

##### 1. 多厂商异构日志的只读逆向适配
市面上的 AI 编程工具存放会话与 Token 的形式五花八门：
- **OpenAI Codex / ccusage**：按天汇总的 JSON 数据与 JSONL 会话流；
- **智谱 ZCode**：本地 SQLite 数据库存储（包含 Prompt/Completion Token 与状态）；
- **DeepSeek (OpenClaw / Reasonix)**：历史会话轨迹及按模型记录的 Token 字段；
- **Google Antigravity / Gemini**：本地特定目录的 JSON 追踪文件。

我们在服务端实现了一组完全解耦的**只读适配器架构**（Adapters）。各适配器以只读模式（Read-only）直读本地用户目录，绝不修改原始文件；同时采用文件的 `mtime` 修改时间戳配合内存 10 秒削峰缓存，即使存在几百兆的开发日志，也不会对系统造成磁盘 I/O 负担。

##### 2. 精确到 Prompt 缓存的官方定价折算引擎
现代大模型（如 Claude 3.7 Sonnet、GPT-4o、DeepSeek V3）普遍引入了 **Prompt Caching**（上下文缓存读取只需常规价格的 10%~25%）。如果仅按总 Token 粗暴计算，折算金额会产生巨大偏差。
我们在 `models-pricing.js` 中维护了涵盖 6 大厂商、数十款主流前沿模型的官方阶梯费率，并实现模糊匹配（Fuzzy Matching）。无论日志中记录的是 `claude-3-7-sonnet-20250219`、`gpt-5.6-sol` 还是 `glm-5.3`，引擎都能精准归因，按缓存读写差异精确折算出真实美元花费。

##### 3. 本地工程路径的启发式聚类归因 (Project Attribution)
开发者往往更关心：“我在 A 商业项目上花了多少钱？B 个人博客项目用了多少 Token？”
各 Agent 会话日志在记录时往往带有不同的工作目录绝对路径（包含单文件路径、子工程目录等）。归因引擎对这些路径执行启发式目录聚类与 Git 根目录识别，将零散的会话汇聚为有意义的“物理工程”，并自动按电商、商业化、博客、工具库等业务标签分类，计算各工程的消耗排行与占比。

##### 4. 原生支持 MCP Server：让 AI 自报账单
除开浏览器可视大屏外，我们还原生实现了遵循标准协议的 **Model Context Protocol (MCP)** Stdio 服务。
只需在 Claude Code、Cursor 或 Windsurf 中添加一条配置：
```json
{
  "mcpServers": {
    "agentic-usage-hub": {
      "command": "npx",
      "args": ["-y", "agentic-usage-hub", "--mcp"]
    }
  }
}
```
配置好后，你在终端与 AI 对话时就能直接提问：
> “我今天写代码消耗了多少 Token？”  
> “最近一周哪个项目成本最高？”

AI 助手会直接调用内置的 `get_usage_today` 或 `get_project_breakdown` 工具，给出准确详实的数据。

---

#### 极简体验：一行命令免安装拉起
项目不依赖任何第三方重量级 Web 框架，由 Node.js 原生 HTTP 模块与极简 SPA 构建，包体积精简。电脑只需安装了 Node.js 20+，终端执行：

```bash
# 一键拉起面板（默认 4242 端口）
npx agentic-usage-hub

# 或指定端口并在准备好后自动打开浏览器
npx agentic-usage-hub -p 4242 -o
```

打开浏览器即可看到：
- **今日实时面板**：跨厂商活跃吞吐与 GPT-Image-2 生图资产；
- **全景时间走势**：支持按厂商、按模型双维度下钻，支持对数标尺；
- **官方价目速查矩阵**：随时核对官方最新费率。

#### 开源与安全承诺
本项目采用 MIT 协议完全开源：
- **100% 本地离线**：不设服务端上报，不上传任何代码、会话或路径数据；
- **无需任何 API Key**：启动无需填入任何私密 Token 或密码；
- **完整自动化测试**：内置 31 项测试用例，覆盖安全路径穿越防御与多平台兼容性。

- **GitHub**：[https://github.com/wangx1ao2/agentic-usage-hub](https://github.com/wangx1ao2/agentic-usage-hub)
- **npm**：[https://www.npmjs.com/package/agentic-usage-hub](https://www.npmjs.com/package/agentic-usage-hub)

欢迎大家 Star 收藏、试用拍砖与提交 Issue！

---

### 2. V2EX / 即刻精炼短帖（直接发布）
- **标题**：写了个多 AI 编程助手 Token 消耗与成本看板，支持 npx 直接跑和 MCP 接入
- **正文**：
  ```text
  平时写代码同时在用 Codex、Claude Code、DeepSeek 和智谱 ZCode，各家的日志和计费方式各不相同，月底算账很头疼。

  于是搓了个纯本地的轻量看板 Agentic Usage Hub：
  - 一键启动：npx agentic-usage-hub 打开本地 4242 端口大屏
  - 支持多 Agent：统一聚合 Codex、Claude、Gemini、Grok、DeepSeek、ZCode
  - 成本精确折算：支持 Prompt 缓存读取折扣与模型模糊匹配
  - 本地工程归因：按物理项目归因 Token 与开销
  - 支持 MCP Server：npx agentic-usage-hub --mcp，可在 Claude Code / Cursor 里直接让 AI 查今天花了多少钱
  - 纯本地运行：无数据上报、无需 API Key，MIT 开源

  GitHub: https://github.com/wangx1ao2/agentic-usage-hub
  大家有常用其他 Agent 的也欢迎提 Issue/PR 扩充适配器！
  ```

---

## 七、Phase 5.4 & 5.5: Product Hunt 与 X (Twitter) 推文物料

### 1. Product Hunt 提交包
- **Name**: Agentic Usage Hub
- **Tagline** (≤60 chars): `One dashboard & MCP for every AI coding agent's token spend`
- **Pricing**: Free / Open Source (MIT)
- **Topics**: Developer Tools, Artificial Intelligence, Open Source, Analytics
- **Short Description**:
  ```text
  A local-first telemetry dashboard and Model Context Protocol (MCP) server that aggregates token throughput, prompt-cache savings, and USD costs across Claude Code, Codex, Grok, Gemini, DeepSeek, and ZCode. 100% offline via a single npx command.
  ```

### 2. X (Twitter) Build in Public 推文（中英双语）
```text
🚀 Just released Agentic Usage Hub v1.0.0!

If you use multiple AI coding agents (Claude Code, Codex CLI, Grok, Gemini, DeepSeek, ZCode), your token spend is probably scattered and invisible.

Now you can get a unified dashboard + native MCP server in one command:
$ npx agentic-usage-hub

✨ 100% Local & Offline
✨ Real-time Today Live metrics
✨ Prompt-cache read discounts included
✨ Project workspace cost attribution
✨ Use as MCP server in Claude Code / Cursor

GitHub: https://github.com/wangx1ao2/agentic-usage-hub

#AI #ClaudeCode #OpenAI #DeveloperTools #BuildInPublic #MCP
```
