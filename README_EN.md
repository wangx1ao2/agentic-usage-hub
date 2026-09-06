# Agentic Usage Hub — Multi-Agent Token Telemetry & Analytics Dashboard

<p align="center">
  <b>Unified token metering, cost estimation, and local workspace attribution for OpenAI Codex · Anthropic Claude · xAI Grok · Zhipu ZCode · Google Antigravity · DeepSeek OpenClaw</b>
</p>

<p align="center">
  <a href="README_EN.md"><b>English</b></a> | <a href="README.md"><b>简体中文</b></a>
</p>

<p align="center">
  <a href="https://github.com/wangx1ao2/agentic-usage-hub/actions/workflows/ci.yml">
    <img src="https://github.com/wangx1ao2/agentic-usage-hub/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-blue.svg" alt="Node Version"></a>
  <a href="https://www.npmjs.com/package/agentic-usage-hub"><img src="https://img.shields.io/badge/npx-agentic--usage--hub-orange.svg" alt="npx ready"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT"></a>
</p>

---

## 📸 Screenshots & UI Preview

<p align="center">
  <b>Panoramic Timeline Dashboard</b><br>
  <i>Dual-dimensional drilldown (by Provider or by Model), logarithmic scale support, and custom range analysis</i><br>
  <img src="docs/images/dashboard-preview.png" alt="Dashboard Preview" width="95%">
</p>

<p align="center">
  <b>Today Live Telemetry & Agent Composition</b><br>
  <i>Cross-provider breakdown of active token throughput, cache hit rates, and image generation counts</i><br>
  <img src="docs/images/today-dashboard-preview.png" alt="Today Live Preview" width="95%">
</p>

<p align="center">
  <b>Interactive Official Pricing Matrix Drawer</b><br>
  <i>Catalog of 6 major AI providers and 20+ frontier models (including Claude Fable 5, Grok 4.6, GPT-5.6) with fuzzy search</i><br>
  <img src="docs/images/pricing-matrix-preview.png" alt="Pricing Matrix Drawer" width="95%">
</p>

---

## 🌟 Key Features

In modern AI-assisted software engineering, developers frequently combine multiple coding assistants (such as OpenAI Codex CLI, Claude Code, xAI Grok CLI, Zhipu AI ZCode, Google Antigravity/Gemini, and DeepSeek OpenClaw/Reasonix). Because each tool uses divergent log formats, cache hierarchies, and pricing rules, developers lack a single unified view of their actual consumption.

**Agentic Usage Hub** is a lightweight, high-performance, zero-heavy-framework local telemetry dashboard:

- **Extensive Frontier Model Coverage**: Built-in official catalog pricing and prompt cache discounts for:
  - **Anthropic Claude**: Claude Fable 5 Agent, Claude 4.5 family, 3.7 Sonnet (Hybrid Reasoning), 3.5 Sonnet/Haiku, Opus
  - **xAI Grok**: Grok 4.6 (Vision / Deep Reasoning), Grok 4, Grok 3, Grok 2
  - **OpenAI**: GPT-5.6 family, o3-mini, o1 series, GPT-4o series
  - **Google DeepMind**: Gemini 3.7 Flash, Gemini 2.5 Pro/Flash
  - **DeepSeek**: DeepSeek V4 Pro/Flash, R1 Reasoner, V3 Chat
  - **Zhipu AI**: GLM-5.3 Flagship/Flash, GLM-5.2
  - **Alibaba Qwen**: Qwen-Max, Qwen-Plus, Qwen-Turbo
- **Today Live Telemetry**: Aggregates real-time active token throughput across all providers alongside `GPT-Image-2` generation metrics;
- **Interactive Panoramic Timeline (Chart.js)**: Switch seamlessly between **Provider View** (🏢) and **Core Model View** (🧬), featuring logarithmic scaling, customizable Y-axis, date presets, and tabular breakdowns;
- **Local Project Attribution**: Automatically extracts and clusters physical directories and Git worktrees associated with each session;
- **Codex Image Studio**: Incrementally indexes locally generated assets, prompts, and timestamps with lightbox preview;
- **Built-in Official Pricing Matrix**: Slide-out drawer with instant fuzzy search to inspect input, cached input, and output tariffs per million tokens;
- **Adaptive Dual Theme**: Automatically synchronizes with system dark/light preferences (`prefers-color-scheme`) with one-click manual override (Auto / Light / Dark).

---

## ❓ FAQ

- **Why should I track my AI coding agent token usage?** — Spend is scattered across subscriptions and API keys, so token burn is invisible until the bill arrives. A unified view turns AI spend into a measurable engineering metric.
- **How do I see how much my Claude Code or Codex CLI sessions actually cost?** — Run `npx agentic-usage-hub`. It reads each agent's local session logs read-only, normalizes them against the built-in official pricing catalog (including prompt-cache read pricing), and shows live per-model, per-provider USD cost.
- **Which AI coding agents are supported?** — OpenAI Codex CLI (including GPT-Image-2 assets), Anthropic Claude Code, xAI Grok CLI, Google Antigravity / Gemini, DeepSeek OpenClaw / Reasonix, and Zhipu AI ZCode. The adapter interface makes adding new agents straightforward.
- **How is this different from ccusage?** — ccusage analyzes Claude Code usage from the terminal. Agentic Usage Hub unifies **all** major coding agents in one local dashboard, adding cross-provider live telemetry, per-project attribution, and an interactive pricing matrix.
- **How do I use this with Claude Code, Cursor, or Windsurf as an MCP server?** — Run `npx agentic-usage-hub --mcp` to start a standard Model Context Protocol (MCP) server over stdio. It exposes `get_usage_today`, `get_usage_range`, and `get_project_breakdown` tools so your AI coding assistant can directly answer "What did I spend on AI today?" or "Which project is burning the most tokens?".
- **Does any of my data leave my machine?** — No. The hub is 100% local and offline: no telemetry, no accounts, no API keys. It only reads your existing agent logs.
- **How do I attribute token spend to a specific project?** — Every session carries its working directory; the attribution engine clusters these into your physical projects and workspaces, then rolls up tokens and cost per project.

---

## 🏗️ Architecture & Directory Structure

```text
agentic-usage-hub/
├── .github/workflows/ci.yml # GitHub Actions continuous integration workflow
├── bin/                     # Global CLI executable (npx agentic-usage-hub)
│   └── agentic-usage-hub.js
├── mcp/                     # Model Context Protocol (MCP) server module
│   └── server.js            # Stdio JSON-RPC 2.0 server & tool handlers
├── docs/                    # High-resolution screenshots and documentation
│   └── images/              # Dashboard captures & social preview card
├── unified-server.js        # Core native Node.js HTTP server and router
├── models-pricing.js        # Unified model pricing matrix, fuzzy matching, and provider resolver
├── antigravity-adapter.js   # Google Antigravity / Gemini 3.7 Flash log adapter
├── codex-image-adapter.js   # Codex GPT-Image-2 asset indexing and prompt parser
├── openclaw-adapter.js      # DeepSeek / Claude / Grok (OpenClaw / Reasonix) trajectory parser
├── project-adapter.js       # Local workspace clustering and attribution engine
├── zcode-adapter.js         # Zhipu AI (Z.ai) SQLite reader and dual-pricing estimator
├── .env.example             # Environment variable configuration template
├── .gitignore               # Standard Git ignore rules
├── package.json             # Package metadata and npm scripts
├── public/                  # Frontend SPA (Vanilla JS + Glassmorphism CSS)
│   ├── index.html           # SPA container
│   ├── app.js               # Reactive UI state, charts, and API client
│   ├── styles.css           # Design tokens, CSS variables, and layout
│   └── chart.umd.js         # Vendored Chart.js library
└── tests/                   # Automated integration and unit test suite
    ├── api.test.js          # REST API endpoints, validation, and security test cases
    ├── adapters.test.js     # Provider adapters, pricing calculations, and parsing tests
    └── mcp.test.js          # MCP protocol handshake, tool discovery & execution tests
```

---

## 🚀 Quick Start

### Method 1: Instant Launch with npx (Recommended ⚡)

No need to clone the repository. If you have Node.js (v20+) installed, simply run:

```bash
# Launch dashboard on default port 4242
npx agentic-usage-hub

# Or specify a custom port and automatically open default browser
npx agentic-usage-hub -p 4242 -o

# Optional global installation
npm install -g agentic-usage-hub
agentic-usage-hub -o
```

Once running, open: 👉 **`http://localhost:4242`**

---

### Method 2: Connect as an MCP Server (Claude Code, Cursor, Windsurf) 🤖

Agentic Usage Hub provides a native Model Context Protocol (MCP) server over stdio. Configure it directly in your AI assistant:

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

Available tools exposed to your AI:
- `get_usage_today`: Real-time cross-agent token throughput, prompt cache hit rate, and USD cost breakdown for today;
- `get_usage_range`: Historical consumption aggregated by provider (OpenAI, Anthropic, Google, etc.) or by model for any date range;
- `get_project_breakdown`: Local workspace project rankings sorted by token volume and USD cost.

---

### Method 3: Git Clone & Source Run

```bash
# 1. Clone repository
git clone https://github.com/wangx1ao2/agentic-usage-hub.git
cd agentic-usage-hub

# 2. Install dependencies
npm install

# 3. Start unified dashboard server
npm start
```

---

### CLI Flags & Options

| Option | Shorthand | Default | Description |
| :--- | :--- | :--- | :--- |
| `--port <port>` | `-p` | `4242` or `$PORT` | Custom HTTP server listening port |
| `--open` | `-o` | `false` | Automatically launch default browser upon server ready |
| `--mcp` | - | `false` | Start Model Context Protocol (MCP) stdio server |
| `--version` | `-v` | - | Print current version number |
| `--help` | `-h` | - | Display CLI usage manual and options list |

---

### Environment Configuration (Optional)

The dashboard works out-of-the-box with default user directory log paths. To customize paths or ports:

```bash
cp .env.example .env
```

Available variables:
- `PORT`: HTTP server port (default: `4242`)
- `CODEX_IMAGE_DIRS`: Comma-separated list of custom Codex image directories (optional)
- `OPENCLAW_SESSIONS_DIR`: Custom OpenClaw session storage directory (optional)
- `REASONIX_USAGE_FILE`: Custom Reasonix telemetry log path (optional)

---

### Running Automated Tests

The repository includes an automated test suite covering all REST endpoints, adapter computations, input validation, MCP tool calls, and path traversal security guards (31/31 passing):

```bash
npm test
```

---

## 📡 REST API Reference

| Endpoint | Method | Description | Parameters |
| :--- | :--- | :--- | :--- |
| `/api/dashboard` | `GET` | Retrieve complete aggregated telemetry data | `tier`: `standard` \| `flagship`<br>`agent`: `all` \| `codex` \| `claude` \| `grok` \| `zcode` \| `antigravity` \| `openclaw` |
| `/api/models-pricing` | `GET` | Retrieve built-in model catalog, price rates, and brand colors | None |
| `/api/projects` | `GET` | Retrieve workspace directory clustering and attribution | None |
| `/api/refresh` | `GET` | Invalidate server cache and re-read logs immediately | None |
| `/api/codex-image` | `GET` | Securely stream a local image generated by Codex | `path`: Absolute image file path (safeguarded against traversal) |

---

## 🛡️ Security & Privacy Principles

1. **100% Local & Offline First**:
   - Agentic Usage Hub runs entirely on your local machine.
   - It never transmits your prompts, code, project names, or telemetry data to any remote third-party service.
   - Zero API keys, passwords, or cloud credentials are required.
2. **Path Traversal Protection**:
   - The `/api/codex-image` endpoint restricts file access strictly to validated image directories; paths containing `..` or non-whitelisted extensions are blocked with `403 Forbidden`.
   - Static assets are locked to the `public/` directory.
3. **Robust Error Boundaries**:
   - Server endpoints wrap all file I/O and JSON parsing in try-catch guards to prevent unhandled process crashes.
   - The frontend includes offline/network failure banners with one-click retry.
   - Missing or corrupted image files automatically fallback to an inline SVG placeholder.
4. **High-Performance Caching**:
   - Disk mtime timestamp checks skip re-parsing unmutated multi-megabyte log files.
   - An in-memory 10-second response cache eliminates CPU spikes during frequent dashboard reloads.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

<a href="llms.txt">🤖 llms.txt — machine-readable project summary for LLM / AI crawlers</a>
