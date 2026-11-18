'use strict';

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Log-derived model/path strings can start spreadsheet formulas. Prefix only
  // text cells; numeric token/cost values remain numeric when imported.
  if (typeof value === 'string' && /^(?:\s*[=+\-@]|[\t\r])/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function exportUsage(records, meta, filters, format = 'json') {
  const metadata = { exportedAt: new Date().toISOString(), schemaVersion: 1,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, timestampUnit: 'milliseconds-since-epoch', filters,
    pricing: meta.pricing, sources: meta.sources, recordCoverage: meta.recordCoverage,
    costNotice: meta.costNotice, stale: meta.stale,
    basis: 'canonical-usage-ledger; costUSD=null means unpriced; day-model rows are not individual requests' };
  if (format === 'json') return { contentType: 'application/json; charset=utf-8',
    filename: 'agentic-usage.json', body: JSON.stringify({ metadata, records }, null, 2) };
  const columns = ['id', 'date', 'dateBasis', 'timestamp', 'source', 'canonicalModel', 'model', 'sessionId', 'projectPath',
    'granularity', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens',
    'costUSD', 'recordedCostUSD', 'currency', 'tokenBasis', 'costBasis', 'costComplete', 'pricingVersion', 'priceCapturedAt',
    'estimated', 'costEstimated', 'estimation', 'pricingContext', 'pricingHistoryUnavailable', 'attributionReason'];
  const rows = [['metadata', JSON.stringify(metadata)], columns,
    ...records.map(row => columns.map(column => row[column]))];
  return { contentType: 'text/csv; charset=utf-8', filename: 'agentic-usage.csv',
    body: '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n' };
}

module.exports = { exportUsage, csvCell };
