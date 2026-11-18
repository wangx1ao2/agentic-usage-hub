const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('./lib/config');
const usageService = require('./lib/usage-service');
const { buildDashboardData, getCachedDashboardData, getCodexData, getCcusageBreakdownCost,
  getProjectsCached, codexLoader } = usageService;
const { getLiveCodexUsage } = require('./lib/codex-live-usage');
const { COMPANY_CONFIG, MODEL_CATALOG } = require('./models-pricing');
const PORT = process.env.PORT || 4242;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Security: allowed image base directories for /api/codex-image
// C3: 仅 env + 用户主目录派生，移除作者个人机器 D:\codex 硬编码。
const customImageDirs = [];
if (process.env.CODEX_IMAGE_DIRS) {
  for (const d of process.env.CODEX_IMAGE_DIRS.split(path.delimiter)) {
    if (d.trim()) customImageDirs.push(d.trim());
  }
}
if (process.env.CODEX_IMAGE_DIR) customImageDirs.push(process.env.CODEX_IMAGE_DIR);

// 预解析 realpath，收敛符号链接 / Windows 8.3 短名，供 C2 越权校验用规范化路径比较
function realOrResolved(p) {
  try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); }
}
const ALLOWED_IMAGE_DIRS = [
  ...customImageDirs,
  path.join(require('./lib/config').codexHome, 'generated_images')
].map(realOrResolved);

// P9: 手动刷新的并发限流标志
let refreshInFlight = false;

// Static file helpers (M5 / P5)
const PUBLIC_DIR_RESOLVED = path.resolve(PUBLIC_DIR);
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

async function serveStatic(req, res, pathname) {
  try {
    let rel = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
    // path.normalize + 前缀剥离，再与 PUBLIC_DIR 做 path.relative 收敛校验（比 startsWith 更严谨）
    let target = path.resolve(PUBLIC_DIR_RESOLVED, path.normalize(rel));
    const inside = (p) => {
      const r = path.relative(PUBLIC_DIR_RESOLVED, p);
      return r !== '' && !r.startsWith('..') && !path.isAbsolute(r);
    };
    if (!inside(target)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden: Access outside public directory is denied');
      return;
    }

    let stat = null;
    try {
      stat = await fs.promises.stat(target);
      if (stat.isDirectory()) {
        target = path.join(target, 'index.html');
        stat = await fs.promises.stat(target);
      }
    } catch (e) {
      // SPA fallback：未知路径回退到 index.html（前端路由）
      target = path.join(PUBLIC_DIR_RESOLVED, 'index.html');
      try { stat = await fs.promises.stat(target); }
      catch (e2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
    }
    if (!stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
    const lastMod = stat.mtime.toUTCString();
    const inm = req.headers['if-modified-since'];
    const inc = req.headers['if-none-match'];
    if ((inc && inc === etag) || (inm && inm === lastMod)) {
      res.writeHead(304);
      return res.end();
    }

    const base = path.basename(target);
    const isHashed = /\.[0-9a-f]{8,}\./.test(base) || /\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?)$/i.test(base) && /-[0-9a-f]{6,}\./.test(base);
    const ext = path.extname(target).toLowerCase();
    // HTML 不缓存以便发版即时生效；静态资源带 hash 则 immutable，否则短缓存
    const cacheControl = ['.html', '.js', '.css'].includes(ext) && !isHashed
      ? 'no-cache'
      : (isHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=300');

    res.writeHead(200, {
      'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Last-Modified': lastMod,
      'ETag': etag,
      'Cache-Control': cacheControl
    });
    fs.createReadStream(target).pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
  }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  let urlObj;
  try {
    urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Malformed request URL' }));
    return;
  }
  const pathname = urlObj.pathname;

  if (pathname === '/api/capabilities') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(require('./lib/runtime-capabilities').getRuntimeCapabilities()));
    return;
  }

  const origin = req.headers.origin || '';
  // 安全: 仅允许本机来源跨域读取，防止公网网页在用户浏览器内静默抓取本地用量数据
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/api/export') {
    try {
      const format = urlObj.searchParams.get('format') || 'json';
      if (!['json', 'csv'].includes(format)) throw Object.assign(new Error('Invalid export format'), { statusCode: 400 });
      const filters = require('./lib/validation').parseUsageFilters(urlObj.searchParams);
      if (filters.limit !== undefined || filters.offset !== undefined) throw Object.assign(new Error('Exports include the full filter scope; pagination is not supported'), { statusCode: 400 });
      const result = await usageService.queryExport(filters, format);
      res.writeHead(200, { 'Content-Type': result.contentType, 'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(result.body);
    } catch (error) {
      res.writeHead(error.code === -32602 ? 400 : error.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (pathname === '/api/sources' || pathname === '/api/usage-records') {
    try {
      const filters = require('./lib/validation').parseUsageFilters(urlObj.searchParams);
      const data = pathname === '/api/sources' ? await usageService.queryDiagnostics() : await usageService.queryUsageRecords(filters);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(error.code === -32602 ? 400 : error.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // API 1: Codex Generated Image Server (Protected against Path Traversal)
  if (pathname === '/api/codex-live') {
    try {
      const data = await getLiveCodexUsage();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    } catch (_) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Failed to read live Codex usage' }));
    }
    return;
  }

  if (pathname === '/api/codex-image') {
    const rawPath = urlObj.searchParams.get('path');
    if (!rawPath) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing path query parameter' }));
      return;
    }

    try {
      const ext = path.extname(rawPath).toLowerCase();
      const isAllowedExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);

      // C2: 只用 realpath 规范化后的真实路径做「严格位于允许基目录内」判断，
      // 删除旧的 generated_images 目录段兜底（任意路径字面命中该段即放行 = 越权）。
      // realpathSync 会解析符号链接 / Windows 短名，失败(不存在/断链)直接 404。
      let realPath;
      try {
        realPath = fs.realpathSync(path.resolve(rawPath));
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Image not found or access denied' }));
        return;
      }

      const isInsideAllowedDir = ALLOWED_IMAGE_DIRS.some(dir => {
        const rel = path.relative(dir, realPath);
        return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      });

      if (!isAllowedExt || !isInsideAllowedDir) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Image not found or access denied' }));
        return;
      }

      const stat = fs.statSync(realPath);
      if (!stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not a valid file' }));
        return;
      }

      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.writeHead(200, { 
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=86400, immutable',
        'Last-Modified': stat.mtime.toUTCString()
      });
      fs.createReadStream(realPath).pipe(res);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Error reading image', message: err.message }));
      return;
    }
  }

  // The full image index is loaded only when opening Studio, never in the overview.
  if (pathname === '/api/codex-images') {
    try {
      const images = await usageService.queryImages();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ images, totalCount: images.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Failed to load image index', message: err.message }));
    }
    return;
  }

  // API 2: Project Attribution List
  if (pathname === '/api/projects') {
    try {
      const filters = require('./lib/validation').parseUsageFilters(urlObj.searchParams);
      const pList = await usageService.queryProjects(filters);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ projects: pList, totalCount: pList.length }));
    } catch (err) {
      res.writeHead(err.code === -32602 ? 400 : err.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Failed to retrieve project attribution', message: err.message }));
    }
    return;
  }

  // API 3: Comprehensive Dashboard Data
  if (pathname === '/api/dashboard') {
    try {
      let tier = (urlObj.searchParams.get('tier') || 'standard').toLowerCase();
      if (!['standard', 'flagship'].includes(tier)) tier = 'standard';

      let agent = (urlObj.searchParams.get('agent') || 'all').toLowerCase();
      if (!['all', 'codex', 'zcode', 'antigravity', 'openclaw', 'claude', 'grok', 'qwen', 'qoderwork', 'api'].includes(agent)) agent = 'all';

      // 首帧兜底：若无新鲜数据，异步等待一次后台刷新(不阻塞事件循环)，保证冷启动也能拿到完整数据。
      const actualOnly = urlObj.searchParams.get('actualOnly') === 'true';
      const normalizedParams = new URLSearchParams(urlObj.searchParams);
      normalizedParams.set('tier', tier); normalizedParams.set('agent', agent);
      const filters = require('./lib/validation').parseUsageFilters(normalizedParams);
      const data = await usageService.queryDashboard(tier, agent, { actualOnly,
        pricingMode: filters.pricingMode || 'recorded', pricingVersion: filters.pricingVersion });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(err.code === -32602 ? 400 : err.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Failed to load dashboard data', message: err.message }));
    }
    return;
  }

  // API 4: Models & Pricing Catalog
  if (pathname === '/api/models-pricing') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'ok',
        companies: COMPANY_CONFIG,
        models: MODEL_CATALOG,
        timestamp: Date.now()
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Failed to load models pricing', message: err.message }));
    }
    return;
  }

  // API 4: Refresh and Invalidate Caches
  if (pathname === '/api/refresh') {
    // P9: 并发限流——同一时刻只允许一个刷新在跑，避免连点导致多次全量扫描/子进程堆叠
    if (refreshInFlight) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'busy', message: 'refresh already in progress' }));
      return;
    }
    refreshInFlight = true;
    try {
      // Bust dashboard memo + shared projects cache
      const report = await usageService.refreshIndexedSources();
      res.writeHead(report.success ? 200 : report.partial ? 207 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(report));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Failed to refresh data', message: err.message }));
    } finally {
      refreshInFlight = false;
    }
    return;
  }

  // 静态资源：路径收敛 + 协商缓存 + 流式响应 (M5 / P5)，SPA 兜底见 serveStatic
  return serveStatic(req, res, pathname);
});

// M7: error 监听器只在模块加载时注册一次，避免测试反复 startServer 叠加监听器
let _listenPort = process.env.PORT || PORT || 4242;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[agentic-usage-hub] 端口 ${_listenPort} 已被占用，请关闭占用进程或设置 PORT 环境变量`);
    process.exit(1);
  }
  console.error('[agentic-usage-hub] server error:', err.message);
});

function startServer(port = (process.env.PORT || PORT || 4242)) {
  installSignalHandlers();
  const capabilities = require('./lib/runtime-capabilities').getRuntimeCapabilities();
  for (const limitation of capabilities.limitations) console.error('[agentic-usage-hub]', limitation);
  // 安全: 默认仅绑定本机回环地址，避免局域网内其他主机读取本地消耗数据。
  // 确需对外提供服务时显式设置环境变量 HOST=0.0.0.0
  const host = process.env.HOST || '127.0.0.1';
  _listenPort = port;

  // 后台预热：启动即异步拉起 ccusage，并跑一遍各文件型适配器，令首帧数据尽量就绪且不阻塞
  try {
    usageService.startWarmup();
  } catch (e) { /* noop */ }

  return server.listen(port, host, () => {
    console.log(`Unified Agentic Dashboard running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  });
}

// M8: 优雅退出——先落盘关键缓存，再关闭服务器，最后退出；5s 超时强制退出防挂死
let _shuttingDown = false;
async function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`\n[agentic-usage-hub] 收到 ${signal}，正在优雅退出…`);
  const force = setTimeout(() => {
    console.error('[agentic-usage-hub] 退出超时，强制结束');
    process.exit(0);
  }, 5000);
  if (typeof force.unref === 'function') force.unref();
  try {
    await Promise.all([usageService.dispose(), new Promise(resolve => server.close(resolve))]);
    clearTimeout(force); process.exit(0);
  } catch (e) {
    process.exit(0);
  }
}
let signalHandlersInstalled = false;
function installSignalHandlers() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

if (require.main === module) {
  startServer(process.env.PORT || PORT);
}

module.exports = {
  server,
  startServer,
  buildDashboardData,
  getCachedDashboardData,
  getCodexData,
  getCcusageBreakdownCost,
  getProjectsCached,
  codexLoader,
  PORT,
  PUBLIC_DIR
};
