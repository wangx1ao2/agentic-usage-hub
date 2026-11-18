'use strict';

const { parentPort } = require('node:worker_threads');
// Reserve stdout for MCP JSON-RPC even when an adapter logs diagnostics.
console.log = (...args) => console.error(...args);
const service = require('./usage-service');
const images = require('../codex-image-adapter');
const businessApi = require('./log-sources').sources.api;
const accountQuota = require('./codex-account-quota').monitor;
// Capture application responses even when the dashboard page is closed.
// The worker owns file I/O; its unref'd timer ends with the service.
const businessApiTimer = require('./business-api-usage').configuredProjects().length
  ? setInterval(() => {
    try { businessApi.getRecords(true); }
    catch (error) { console.error('[business-api]', error.message); }
  }, 10_000) : null;
businessApiTimer?.unref();
// The account monitor has its own explicit opt-in and works without API projects.
const accountQuotaTimer = require('./codex-account-quota').accountQuotaEnabled()
  ? setInterval(() => { accountQuota.capture().catch(() => {}); }, 30_000) : null;
accountQuotaTimer?.unref();
if (accountQuotaTimer) accountQuota.capture().catch(() => {});

parentPort.on('message', async ({ id, operation, args }) => {
  try {
    let result;
    switch (operation) {
      case 'dashboard': result = await service.queryDashboard(args.tier, args.agent, args.options); break;
      case 'projects': result = await service.queryProjects(args); break;
      case 'records': result = await service.queryUsageRecords(args); break;
      case 'diagnostics': result = await service.queryDiagnostics(); break;
      case 'export': result = await service.queryExport(args.filters, args.format); break;
      case 'images': result = images.getCodexImageCatalog(); break;
      case 'refresh': result = await service.refreshSources(); break;
      case 'shutdown': clearInterval(businessApiTimer); clearInterval(accountQuotaTimer); await Promise.all([accountQuota.dispose(), service.codexLoader.stopAndFlush()]); result = { stopped: true }; break;
      default: throw new Error('Unknown indexing operation');
    }
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: { message: error.message, statusCode: error.statusCode, code: error.code } }); }
});
