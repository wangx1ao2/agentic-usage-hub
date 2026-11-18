'use strict';

const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');

// Read a fixed file generation without allocating its entire contents. Large
// unrelated tool/image payload lines can be discarded before JSON parsing.
function readJsonLines(filename, consume, { io = fs, size = io.statSync(filename).size,
  accept = () => true, discard = () => false, chunkSize = 256 * 1024, ignoredLineLimit = 1024 * 1024 } = {}) {
  const fd = io.openSync(filename, 'r'), decoder = new StringDecoder('utf8');
  const buffer = Buffer.alloc(chunkSize);
  let offset = 0, tail = '', dropping = false, parseErrors = 0, pendingLines = 0;
  function line(value, complete) {
    if (!value.trim() || !accept(value)) return;
    let row;
    try { row = JSON.parse(value); }
    catch (_) { if (complete) parseErrors++; else pendingLines++; return; }
    try { consume(row); } catch (_) { parseErrors++; }
  }
  function chunk(value) {
    let start = 0, newline;
    while ((newline = value.indexOf('\n', start)) !== -1) {
      if (!dropping) line(tail + value.slice(start, newline), true);
      tail = ''; dropping = false; start = newline + 1;
    }
    if (!dropping) {
      tail += value.slice(start);
      if (tail.length > ignoredLineLimit && !accept(tail) && discard(tail)) { tail = ''; dropping = true; }
    }
  }
  try {
    while (offset < size) {
      const count = io.readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!count) break;
      offset += count; chunk(decoder.write(buffer.subarray(0, count)));
    }
    chunk(decoder.end());
    if (!dropping) line(tail, false);
  } finally { io.closeSync(fd); }
  return { parseErrors, pendingLines };
}

module.exports = { readJsonLines };
