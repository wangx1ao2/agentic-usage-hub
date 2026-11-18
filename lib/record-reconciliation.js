'use strict';

// Join complete request groups to the exact aggregate snapshot. A mismatch is
// retained as an explicit unassigned aggregate, never split with token ratios.
function reconcileRequests(aggregates, requests) {
  const key = row => JSON.stringify([row.source, row.date, row.canonicalModel]);
  const groups = new Map(), details = new Map();
  for (const row of aggregates) {
    if (!groups.has(key(row))) groups.set(key(row), []);
    groups.get(key(row)).push(row);
  }
  for (const row of new Map(requests.map(record => [record.id, record])).values()) {
    if (!details.has(key(row))) details.set(key(row), []);
    details.get(key(row)).push(row);
  }
  const records = [], unmatched = [];
  for (const [group, rows] of groups) {
    const candidates = details.get(group) || [];
    const sum = (list, field) => list.reduce((total, row) => total + (row[field] || 0), 0);
    const matches = candidates.length > 0 && ['totalTokens', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']
      .every(field => sum(rows, field) === sum(candidates, field))
      && !(candidates.every(row => row.costUSD === null) && sum(rows, 'costUSD') > 0);
    if (matches) records.push(...candidates.map(row => ({ ...row, model: rows.length === 1 ? rows[0].model : row.model })));
    else {
      records.push(...rows.map(row => ({ ...row, attributionReason: candidates.length ? 'request-snapshot-mismatch' : 'request-details-unavailable' })));
      unmatched.push(...candidates.map(row => ({ ...row, includedInTotals: false, attributionReason: 'request-snapshot-mismatch' })));
    }
    details.delete(group);
  }
  for (const rows of details.values()) unmatched.push(...rows.map(row => ({ ...row, includedInTotals: false, attributionReason: 'outside-aggregate-snapshot' })));
  return { records, unmatched };
}

module.exports = { reconcileRequests };
