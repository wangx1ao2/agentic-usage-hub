import { requestJSON } from './api.js';
import { animateNumber, disposeMotion, feedbackButton, highlightChange, replaceAnimation, setBusy, setText } from './motion.js';
import { reconcileCards } from './utils.js';
(() => {
  let timer = null, request = null, epoch = 0, failures = 0;
  let automatic = true, interval = 2000, lastData = null;
  const samples = [];
  let gapPending = true, resumePending = true;
  try {
    automatic = localStorage.getItem('codex_live_auto') !== 'false';
    const saved = Number(localStorage.getItem('codex_live_interval'));
    if ([1000, 2000, 5000].includes(saved)) interval = saved;
  } catch (_) {}
  const rates = { 'codex-live-total': 'tokensPerSecond', 'codex-live-input': 'inputTokensPerSecond',
    'codex-live-cache': 'cacheReadTokensPerSecond', 'codex-live-output': 'outputTokensPerSecond' };
  const format = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  const text = (id, value) => setText(id, value);
  const visible = () => {
    const view = document.getElementById('view-live');
    return !!view && view.style.display !== 'none' && !document.hidden;
  };

  function save() {
    try {
      localStorage.setItem('codex_live_auto', String(automatic));
      localStorage.setItem('codex_live_interval', String(interval));
    } catch (_) {}
  }

  function controls(message) {
    const toggle = document.getElementById('codex-live-toggle');
    toggle.setAttribute('aria-checked', String(automatic));
    toggle.textContent = automatic ? '暂停自动更新' : '开启自动更新';
    document.getElementById('codex-live-interval').value = String(interval);
    if (message) text('codex-live-refresh-state', message);
  }

  function empty(message) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = 7;
    cell.textContent = message;
    row.appendChild(cell);
    document.getElementById('codex-live-sessions').replaceChildren(row);
  }

  function unavailable(message) {
    for (const id of Object.keys(rates)) animateNumber(id, NaN, format, { duration: 0 });
    text('codex-live-count', '近期活跃会话 —');
    empty(message);
  }

  function renderImages(image) {
    if (!image) { text('codex-live-image-status', '图像统计暂不可用'); return; }
    text('codex-live-image-status', image.readErrors ? '部分图片目录读取失败' : !image.sourceAvailable ? '未找到图片目录'
      : image.filesLastFiveMinutes ? '近期有图片写入 · 图像 Token 未记录' : '等待新的图片写入 · 图像 Token 未记录');
    animateNumber('codex-live-image-count', image.sourceAvailable ? image.filesLastFiveMinutes : NaN, format, { duration: 220 });
    const previousImage = lastData?.imageActivity;
    if (previousImage?.latestImageAt && image.latestImageAt > previousImage.latestImageAt && !resumePending) highlightChange('codex-live-image-latest', 350);
    text('codex-live-image-minute', '最近 60 秒 ' + (image.sourceAvailable ? format(image.filesLastMinute) + ' 个新图文件' : '—'));
    text('codex-live-image-latest', image.latestImageAt ? new Date(image.latestImageAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—');
    text('codex-live-image-checked', image.scannedAt ? '目录检查于 ' + new Date(image.scannedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '图片目录每 15 秒检查');
  }

  function render(data) {
    if (!data.totals || !Array.isArray(data.sessions) || !Number.isFinite(data.generatedAt)) throw new Error('Invalid live usage');
    const status = document.getElementById('codex-live-status');
    status.dataset.state = data.readErrors ? 'partial' : !data.sourceAvailable ? 'unavailable' : data.activeSessionCount ? 'active' : 'idle';
    status.textContent = data.readErrors ? '部分日志读取失败' : !data.sourceAvailable ? '未找到会话日志'
      : data.activeSessionCount ? '近期有对话用量' : '最近 60 秒无对话用量';
    text('codex-live-updated', '本次检查 ' + new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour12: false }));
    renderImages(data.imageActivity);
    if (!data.sourceAvailable) { gapPending = true; unavailable('未找到 Codex 会话日志；使用 Codex 后会自动读取。'); return; }
    for (const [id, field] of Object.entries(rates)) animateNumber(id, data.totals[field], format, { duration: resumePending ? 0 : 220, reason: resumePending ? 'resume' : 'poll' });
    const newUsage = lastData && !resumePending && data.sessions.some(session => session.lastUsageAt > (lastData.sessions.find(old => old.sessionId === session.sessionId)?.lastUsageAt || 0));
    if (newUsage) highlightChange(status, 350);
    recordSample(data);
    resumePending = false;
    text('codex-live-count', '近期活跃 ' + data.activeSessionCount + ' 个会话 · 窗口内 ' + data.totals.requests + ' 次请求');
    if (!data.sessions.length) {
      empty(data.readErrors ? '日志读取不完整，请检查 Codex 日志目录的读取权限。' : '最近 5 分钟没有对话用量记录；生图产出在上方单独显示。');
      return;
    }
    const rows = data.sessions.map(session => {
      const row = document.createElement('tr'), identity = document.createElement('td');
      row.dataset.key = String(session.sessionId);
      row.dataset.active = String(!!session.active);
      const id = document.createElement('strong');
      id.textContent = (session.active ? '近期活跃' : '最近 60 秒无用量') + ' · ' + String(session.sessionId).slice(0, 8);
      id.title = session.sessionId;
      const cwd = document.createElement('small');
      cwd.textContent = session.cwd || '未记录工作目录';
      identity.append(id, cwd);
      row.appendChild(identity);
      const values = [session.model, format(session.inputTokensPerSecond), format(session.cacheReadTokensPerSecond),
        format(session.outputTokensPerSecond), format(session.tokensPerSecond),
        new Date(session.lastUsageAt).toLocaleTimeString('zh-CN', { hour12: false })];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }
      return row;
    });
    const body = document.getElementById('codex-live-sessions');
    const rank = new Map([...body.children].map((row, index) => [row.dataset.key, index]));
    rows.sort((a, b) => (rank.get(a.dataset.key) ?? Infinity) - (rank.get(b.dataset.key) ?? Infinity));
    const before = new Map([...body.children].map(row => [row.dataset.key, [...row.cells].map(cell => cell.textContent)]));
    reconcileCards(body, rows);
    for (const row of body.rows) {
      const old = before.get(row.dataset.key);
      if (!old) continue;
      for (let index = 2; index < 6; index++) if (old[index] !== row.cells[index]?.textContent) highlightChange(row.cells[index], 600);
    }
  }

  function recordSample(data) {
    const at = data.generatedAt, rate = Number(data.totals.tokensPerSecond);
    if (!Number.isFinite(rate) || samples.at(-1)?.at === at) return;
    const previous = samples.at(-1);
    if (previous && at <= previous.at) return;
    samples.push({ at, rate, gap: gapPending || !!previous && at - previous.at > Math.max(10000, interval * 2.5) });
    gapPending = false;
    while (samples.length && (samples[0].at < at - 120000 || samples.length > 240)) samples.shift();
    const start = at - 120000, max = Math.max(1, ...samples.map(point => point.rate));
    const svg = document.getElementById('codex-live-history');
    let path = '', last = null;
    for (const point of samples) {
      const x = (point.at - start) / 120000 * 600, y = 62 - point.rate / max * 54;
      path += `${!last || point.gap ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `;
      last = { x, y };
    }
    const ns = 'http://www.w3.org/2000/svg';
    let line = svg.querySelector('path'), dot = svg.querySelector('circle');
    if (!line) {
      line = document.createElementNS(ns, 'path');
      line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1.8'); line.setAttribute('vector-effect', 'non-scaling-stroke');
      dot = document.createElementNS(ns, 'circle'); dot.setAttribute('r', '3'); dot.setAttribute('fill', 'currentColor');
      svg.append(line, dot);
    }
    line.setAttribute('d', path);
    dot.setAttribute('cx', last.x); dot.setAttribute('cy', last.y);
    svg.dataset.samples = String(samples.length);
    svg.setAttribute('aria-label', `${samples.length} 个实际检查采样，最近速率 ${format(rate)} Token/s，60 秒窗口均值`);
    const time = value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
    text('live-history-start', time(start)); text('live-history-end', time(at));
    text('live-history-note', `仅保留本次页面会话的检查记录 · 当前 ${format(rate)} Token/s · 缺口表示暂停或中断`);
    replaceAnimation(dot, 'sample', [{ opacity: .3 }, { opacity: 1 }], { duration: 160 });
  }

  function stop(message) {
    epoch++;
    gapPending = true; resumePending = true;
    disposeMotion(document.getElementById('view-live'));
    clearTimeout(timer);
    timer = null;
    request?.abort();
    request = null;
    document.getElementById('codex-live-refresh').disabled = false;
    setBusy('codex-live-refresh', false);
    const status = document.getElementById('codex-live-status');
    if (!automatic || !visible()) { status.dataset.state = 'paused'; status.textContent = '更新已暂停'; }
    controls(message);
  }

  function delay() {
    if (failures) return Math.min(30000, interval * 2 ** Math.min(failures - 1, 5));
    if (!lastData?.sourceAvailable) return Math.max(interval, 10000);
    return lastData.activeSessionCount ? interval : Math.max(interval, 5000);
  }

  async function poll(version, manual = false) {
    if (!visible() || version !== epoch || request) return;
    timer = null;
    const controller = new AbortController();
    request = controller;
    document.getElementById('codex-live-refresh').disabled = true;
    controls('正在检查本地日志…');
    setBusy('codex-live-refresh', true);
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const data = await requestJSON('/api/codex-live', { signal: controller.signal, timeoutMs: 10000 });
      if (version !== epoch || !visible()) return;
      render(data);
      lastData = data;
      failures = 0;
      if (manual) feedbackButton(document.getElementById('codex-live-refresh'));
    } catch (_) {
      if (version === epoch && visible()) {
        failures++;
        gapPending = true;
        text('codex-live-status', '更新失败');
        document.getElementById('codex-live-status').dataset.state = 'error';
        if (!lastData) unavailable(automatic ? '暂时无法获取实时用量，将自动重试。' : '暂时无法获取实时用量，可点击刷新一次重试。');
        else text('codex-live-refresh-state', '更新失败 · 显示上次成功数据');
      }
    } finally {
      clearTimeout(timeout);
      if (version === epoch) {
        request = null;
        document.getElementById('codex-live-refresh').disabled = false;
        setBusy('codex-live-refresh', false);
        if (visible() && automatic) {
          const wait = delay();
          controls(failures ? (lastData ? '显示上次成功数据 · ' : '') + '自动更新 · ' + wait / 1000 + ' 秒后重试'
            : lastData?.activeSessionCount ? '自动更新 · 每 ' + wait / 1000 + ' 秒'
            : '自动更新 · 无近期对话用量，每 ' + wait / 1000 + ' 秒检查');
          timer = setTimeout(() => poll(version), wait);
        } else {
          controls('自动更新已关闭 · 显示上次数据');
        }
      }
    }
  }

  function sync() {
    if (!visible()) {
      stop(document.hidden ? '浏览器在后台 · 已暂停' : '离开实时页 · 已暂停');
    } else if (!automatic) {
      stop('自动更新已关闭 · 可点击刷新一次');
    } else if (!request && timer === null) {
      controls('正在读取');
      poll(epoch);
    }
  }

  window.codexLive = { sync };
  document.addEventListener('DOMContentLoaded', () => {
    controls();
    document.getElementById('codex-live-toggle').addEventListener('click', () => {
      automatic = !automatic;
      save();
      stop(automatic ? '自动更新已开启' : '自动更新已关闭 · 显示上次数据');
      sync();
    });
    document.getElementById('codex-live-interval').addEventListener('change', event => {
      const selected = Number(event.target.value);
      interval = [1000, 2000, 5000].includes(selected) ? selected : 2000;
      save();
      stop();
      sync();
    });
    document.getElementById('codex-live-refresh').addEventListener('click', () => {
      if (!visible() || request) return;
      clearTimeout(timer);
      timer = null;
      failures = 0;
      poll(epoch, true);
    });
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => stop('刷新已暂停'));
  window.addEventListener('pageshow', sync);
})();
