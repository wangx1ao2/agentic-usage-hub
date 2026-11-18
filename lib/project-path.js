'use strict';
const path = require('node:path');

function canonicalWorkspacePath(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim().replace(/\\/g, '/').replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\//, '');
  if (/^\/\/[.?]\//.test(value)) return null;
  const windows = /^[A-Za-z]:\//.test(value) || /^\/\/[^/]+\/[^/]+/.test(value);
  if (!windows && !value.startsWith('/')) return null;
  let normalized = windows ? path.win32.normalize(value).replace(/\\/g, '/') : path.posix.normalize(value);
  if (normalized !== '/' && !/^[A-Za-z]:\/$/.test(normalized)) normalized = normalized.replace(/\/$/, '');
  return windows ? normalized.toLowerCase() : normalized;
}

module.exports = { canonicalWorkspacePath };
