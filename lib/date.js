'use strict';

/**
 * 共享日期工具（消除 5+ 处重复的 getLocalDateStr 定义 / N1）。
 * 所有适配器统一按本地时区归属自然日，避免 UTC 跨日偏移。
 */

function getLocalDateStr(dateObj = new Date()) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 时间戳(ms / 秒 / ISO 字符串) → 本地 YYYY-MM-DD；无法解析返回 null */
function toDateStr(ts) {
  if (ts === null || ts === undefined || ts === '') return null;
  const numeric = typeof ts === 'number' || (typeof ts === 'string' && /^\d+$/.test(ts));
  let input = numeric ? Number(ts) : ts;
  if (typeof input === 'number' && input < 1e11) input *= 1000; // 秒 → 毫秒
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return getLocalDateStr(d);
}

module.exports = { getLocalDateStr, toDateStr };
