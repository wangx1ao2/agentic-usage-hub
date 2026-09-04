# Agentic Usage Hub — 多智能体统一计量与可视化看板

<p align="center">
  <b>面向 OpenAI Codex · 智谱 ZCode · Google Antigravity · DeepSeek 全生态 AI 编程智能体的统一 Token 计量、成本折算与本地工程归因看板</b>
</p>

---

## 🌟 项目简介

在现代 AI 辅助研发工作中，开发者通常组合使用多种 Agent 编程助手（如 OpenAI Codex CLI、智谱 AI ZCode、Google Antigravity/Gemini、DeepSeek OpenClaw/Reasonix 以及 Codex 原生生图工具）。由于各工具的计费机制、缓存策略、日志存放路径及数据格式高度异构，传统工具往往难以提供全生命周期的统一视图。

**Agentic Usage Hub** 是一套轻量、高性能、零第三方重框架依赖的本地全景监控面板：
- **统一 Token 吞吐与成本折算**：聚合输入 Tokens、输出 Tokens、Prompt 缓存命中，按照官方标准目录价与旗舰阶梯折算为统一 USD 美元口径；
- **今日实时看板 (Today Live)**：独立跨厂商聚合今日大模型（如 `gpt-5.6-sol`、`Gemini 3.7 Flash`）与生图工具（`GPT-Image-2`）的实时吞吐与阵营构成；
- **全景时间走势图 (Timeline & Chart.js)**：提供 4 大厂商多维折线走势，支持对数坐标、自定义 Y 轴缩放、区间预设与明细表格检索；
- **本地工程归因 (Projects Attribution)**：自动提取各 Agent 会话所绑定的本地物理工作区与工程目录，按业务主题聚类归因（商业化、小说、电商、技术博客等）；
- **生图资产 Studio 画廊**：增量检索 Codex 自动化生成的图片资产与 Prompt，支持灯箱大图预览；
- **双主题自适应**：支持跟随系统（`prefers-color-scheme`）自适应切换，并提供一键手动控制（自动 / 浅色 / 深色）。

---

## 🏗️ 架构与目录结构

```text
agentic-usage-hub/
├── unified-server.js        # 核心 Node.js 原生 HTTP 服务与路由调度
├── antigravity-adapter.js   # Google Antigravity / Gemini 3.7 Flash 本地日志解析适配器
├── codex-image-adapter.js   # Codex GPT-Image-2 生图资产增量索引与 Prompt 提取
├── openclaw-adapter.js      # DeepSeek (OpenClaw / Reasonix) 历史轨迹调用解析
├── project-adapter.js       # 本地物理工程与工作区智能聚类归因
├── zcode-adapter.js         # 智谱 AI (Z.ai) SQLite 数据库直读与双计费定价计算
├── .env.example             # 环境变量配置模板
├── .gitignore               # Git 忽略规则 (node_modules, 敏感文件, 缓存)
├── package.json             # 项目元数据与 npm 脚本 (start, test, daily, monthly)
├── public/                  # 静态前端 SPA 应用
│   ├── index.html           # 前端 SPA 骨架与面板容器
│   ├── app.js               # 前端状态流转、API 请求、图表交互与渲染逻辑
│   ├── styles.css           # 双主题 Design Tokens、Glassmorphism 布局与响应式样式
│   └── chart.umd.js         # 本地化 Chart.js 库
└── tests/                   # 自动化集成与单元测试套件
    ├── api.test.js          # REST API 端点、边界条件、错误处理与安全防御测试
    └── adapters.test.js     # 各厂商适配器解析、计费公式与数据结构测试
```

---

## 🚀 快速启动

### 1. 前置条件
- **Node.js**: v20+ (推荐 v22 或 v24，原生支持 `node:sqlite` 和 `node:test`)
- 本地环境中已安装或运行相关 Agent CLI（如 `ccusage`、`zcode` 等）

### 2. 环境变量配置（可选）
项目开箱即用，无需配置即可自动读取用户目录下的默认 Agent 日志。如需自定义端口或日志路径：
```bash
cp .env.example .env
```
支持配置项：
- `PORT`: HTTP 监听端口（默认 `4242`）
- `CODEX_IMAGE_DIRS`: 自定义 Codex 生图目录路径（可选）
- `OPENCLAW_SESSIONS_DIR`: 自定义 OpenClaw 会话目录（可选）
- `REASONIX_USAGE_FILE`: 自定义 Reasonix 计量日志路径（可选）

### 3. 依赖安装与启动
```bash
# 进入项目根目录
cd agentic-usage-hub

# 安装基础依赖
npm install

# 启动统一看板服务 (默认监听 4242 端口)
npm start
```
启动成功后，浏览器访问：  
👉 **`http://localhost:4242`**

### 4. 运行自动化测试套件
本项目包含覆盖核心 API、适配器计算、参数校验和路径安全防御的完整测试：
```bash
npm test
```

---

## 📡 API 端点规范

| 路径 | 方法 | 说明 | 关键参数 |
| :--- | :--- | :--- | :--- |
| `/api/dashboard` | `GET` | 获取看板全量聚合数据 | `tier`: `standard` \| `flagship`<br>`agent`: `all` \| `codex` \| `zcode` \| `antigravity` \| `openclaw` |
| `/api/projects` | `GET` | 获取归因分析后的本地工程列表 | 无 |
| `/api/refresh` | `GET` | 强制穿透刷新并清除服务端缓存 | 无 |
| `/api/codex-image` | `GET` | 安全读取 Codex 本地生成的图片 | `path`: 本地图片绝对路径（已做安全目录与扩展名强校验） |

---

## 🛡️ 安全与健壮性设计

1. **路径遍历防御 (Path Traversal Protection)**：
   - `/api/codex-image` 仅允许读取合法生图目录（如 `.codex/generated_images`）下的图片文件，严禁通过 `../` 越界访问；
   - 静态资源服务器强制限制在 `public/` 目录范围内，越界请求直接返回 `403 Forbidden`。
2. **全局错误边界与兜底**：
   - 服务端所有路由封装统一的 `try...catch`，避免任何单点异常使服务挂起；
   - 前端集成断网/服务异常全局提示条与“点击重试”机制；
   - 图像资源加载失败时自动应用轻量 SVG 占位图兜底。
3. **多级高性能缓存**：
   - 磁盘级增量时间戳比对缓存（避免重复全量读取数 GB 日志）；
   - 服务端 10s 内存响应缓存（削峰填谷，降低高频请求压力）。

---

## 📄 许可说明
本项目基于 [MIT License](LICENSE) 开源。
