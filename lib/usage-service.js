'use strict';
require('./config');
const zcode = require('../zcode-adapter');
const antigravity = require('../antigravity-adapter');
const openclaw = require('../openclaw-adapter');
const qwen = require('../qwen-adapter');
const qoderwork = require('../qoderwork-adapter');
const projectAdapter = require('../project-adapter');
const codexImage = require('../codex-image-adapter');
const codexLoader = require('./codex-loader');
const { getLocalDateStr } = require('./date');
const { isMainThread } = require('node:worker_threads');
let indexClient;
function getIndexClient() {
  return indexClient ||= require('./index-client').createIndexClient({
    snapshotIdentity: require('./persistent-cache').getRuntimeIdentity() });
}
// Codex (ccusage) 数据改由 lib/codex-loader 以「异步 spawn + 后台预热 + stale-while-revalidate」
// 维护，彻底消除请求路径上的同步子进程阻塞（C1）。getCodexData 退化为同步读取器，保留导出名兼容旧调用。
function getCodexData(force = false) {
  return codexLoader.getCodexDataSync(force);
}

let latestRecords = [], latestUnmatched = [], latestCcusageDates = [];
const recordSnapshots = new Map();
function getProjectsCached() { return projectAdapter.projectsFromRecords(latestRecords); }
function invalidateProjectsCache() { /* Projects are derived from the canonical snapshot. */ }

const { COMPANY_CONFIG, MODEL_CATALOG, resolveModelInfo, calculateModelCost, autoReviewCostBasis } = require('../models-pricing');

const { normalizeCcusageDaily, getCcusageBreakdownCost } = require('./ccusage-normalize');
const { normalizeDaily } = require('./usage-record');
const { aggregateRecords } = require('./usage-aggregate');
const { sources } = require('./log-sources');
const { createRequestRecord, recordsToDaily } = require('./request-record');
const { reconcileRequests } = require('./record-reconciliation');
const { getPricingHistory } = require('./pricing-history');
const accountQuota = require('./codex-account-quota').monitor;
const snapshotKey = (tier, options = {}) => JSON.stringify([tier, options.pricingMode || 'recorded', options.pricingVersion || null]);

function collectUsageRecords(tier = 'standard') {
  const codexRaw = getCodexData();
  const standardDaily = zcode.getZCodeDaily('standard');
  const flagshipDaily = zcode.getZCodeDaily('flagship');
  let ccusage = normalizeDaily(normalizeCcusageDaily(codexRaw), 'ccusage', { freshInput: true });
  latestCcusageDates = ccusage.map(row => row.date).sort();
  const claude = sources.claude.getRecords();
  const claudeStatus = sources.claude.getDiagnostics();
  // Direct Claude records provide the same token contract, workspace and request
  // identity; ccusage remains a fallback if a file could not be fully parsed.
  if (claude.length && !claudeStatus.stale) ccusage = [...ccusage.filter(row => row.source !== 'claude'), ...normalizeDaily(recordsToDaily(claude), 'claude')];
  else if (claude.length && !ccusage.some(row => row.source === 'claude')) ccusage.push(...normalizeDaily(recordsToDaily(claude), 'claude'));
  const aggregates = [
    ...ccusage,
    ...normalizeDaily(tier === 'flagship' ? flagshipDaily : standardDaily, 'zcode'),
    ...normalizeDaily(antigravity.getAntigravityDaily(), 'antigravity', { estimated: true }),
    ...normalizeDaily(openclaw.getOpenClawAndReasonixDaily(), 'openclaw'),
    ...normalizeDaily(qwen.getQwenDaily(), 'qwen'),
    ...normalizeDaily(qoderwork.getQoderDaily(), 'qoderwork', { estimated: true })
  ];
  const codexRequests = (codexRaw.requestRecords || []).map(row => createRequestRecord({ source: 'codex',
    id: row.key, rawModel: row.model, model: row.model, timestamp: row.timestamp, sessionId: row.sessionId,
    projectPath: row.cwd, inputTokens: row.inputTokens, cacheReadTokens: row.cacheReadTokens,cacheWriteTokens:row.cacheWriteTokens,
    outputTokens: row.outputTokens, costUSD: row.unpriced ? undefined : row.cost,
    costBasis: row.model === 'codex-auto-review' ? autoReviewCostBasis : 'catalog-estimate',
    pricingContext: row.pricingContext, speedKnown: row.speedKnown, quotaReset: row.quotaReset })).filter(Boolean);
  const reconciled = reconcileRequests(aggregates, [ ...codexRequests, ...claude,
    ...zcode.getUsageRecords(tier), ...antigravity.getUsageRecords(), ...openclaw.getUsageRecords(),
    ...qwen.getUsageRecords(), ...qoderwork.getUsageRecords() ]);
  // Business responses are independent requests, outside the CLI aggregates.
  // Adding them after reconciliation keeps both their identity and workspace.
  const apiRecords = sources.api.getRecords();
  return { ...reconciled, records: [...reconciled.records, ...apiRecords], codexRaw, codexRequests, standardDaily, flagshipDaily };
}

function buildDashboardData(tier = 'standard', agentFilter = 'all', options = {}) {
  const collected = collectUsageRecords(tier);
  const { unmatched, codexRaw, standardDaily, flagshipDaily } = collected;
  const history = getPricingHistory();
  const records = history.apply(collected.records, { ...options, tier });
  const pricedCodex = history.apply(collected.codexRequests, { ...options, tier });
  const subscriptionApi = records.filter(row => row.source === 'api' && row.pricingContext?.billingMode === 'chatgpt-subscription');
  const accountSnapshots = accountQuota.getSnapshots();
  const codexQuota = Array.isArray(codexRaw.quotaSnapshots) || accountSnapshots.length || subscriptionApi.length
    ? require('./codex-quota-history').buildQuotaHistory([...pricedCodex, ...subscriptionApi]
      .map(row => ({ ...row, key: row.id, model: row.canonicalModel, cost: row.costUSD || 0 })),
    [...(codexRaw.quotaSnapshots || []), ...accountSnapshots])
    : codexRaw.codexQuota || null;
  latestRecords = records;
  latestUnmatched = unmatched;
  recordSnapshots.set(snapshotKey(tier, options), records);
  if (recordSnapshots.size > 6) recordSnapshots.delete(recordSnapshots.keys().next().value);
  const todayStr = getLocalDateStr();
  const actualOnly = !!options.actualOnly;
  const visibleRecords = filterRecords(records, { agent: agentFilter, actualOnly });
  const all = aggregateRecords(records, { today: todayStr, actualOnly });
  const selected = agentFilter === 'all' ? all : aggregateRecords(records, { agent: agentFilter, today: todayStr, actualOnly });
  const imageAnalysis = codexImage.getCodexImageAnalysis();
  const imageDay = imageAnalysis.daily?.find(day => day.date === todayStr) || {
    count: imageAnalysis.totals.todayCount || 0, cost: imageAnalysis.totals.todayCost || 0,
    tokens: imageAnalysis.totals.todayTokens || 0
  };
  const todaySummary = { ...all.today, thisMonthCost: all.totals.thisMonthCost,
    codexQuota,
    images: { costBasis: imageAnalysis.costBasis, usageAvailable: false, includedInTotals: false,
      count: imageDay.count || 0, cost: imageDay.cost || 0, tokens: imageDay.tokens || 0 } };
  const modelFamilies = selected.companies.filter(company => company.totalTokens > 0).map(company => {
    const subModels = selected.models.filter(model => model.company === company.name);
    if (company.name === 'OpenAI' && ['all', 'codex'].includes(agentFilter) && imageAnalysis.totals.totalCount > 0) {
      subModels.push({ modelName: `GPT-Image-2 (生图工具 · ${imageAnalysis.totals.totalCount}张原图)`,
        rawModel: 'GPT-Image-2', agent: 'codex', company: 'OpenAI', cacheTokens: 0,
        totalTokens: imageAnalysis.totals.totalTokens, formattedTokens: (imageAnalysis.totals.totalTokens / 1e6).toFixed(1) + 'M',
        totalCost: imageAnalysis.totals.totalCost, formattedCost: '$' + imageAnalysis.totals.totalCost.toFixed(2),
        isImageGen: true, costBasis: imageAnalysis.costBasis, includedInTotals: false, imageCount: imageAnalysis.totals.totalCount });
    }
    return { id: company.name === 'OpenAI' ? 'openai' : company.agentKey, name: company.label,
      company: company.name, color: company.color, badge: company.name,
      totalCost: company.totalCost, formattedCost: company.formattedCost, totalTokens: company.totalTokens,
      formattedTokens: company.formattedTokens, cacheTokens: company.cacheTokens,
      modelCount: subModels.length, subModels };
  });
  const coverage = records.map(record => record.date).sort();
  const loaderStatus = codexLoader.getStatus();
  const sourceStatuses = getSourceStatus();
  const pricing = { ...history.metadata(), mode: options.pricingMode || 'recorded', selectedVersion: options.pricingVersion || null };
  const stale = loaderStatus.stale || !!pricing.error || Object.values(sourceStatuses).some(source => source.stale);
  const reviewRows = records.filter(row => row.canonicalModel === 'codex-auto-review');
  const reviewModels = [...new Set(reviewRows.filter(row => row.costUSD !== null && row.costBasis !== 'reported')
    .map(row => MODEL_CATALOG[row.pricingContext?.assumedRateModel]?.label || '已保存参考模型'))];
  const reviewNotice = !reviewRows.length ? '' : reviewModels.length
    ? ` 自动审批按用户指定的 ${reviewModels.join('、')} 费率估算，并非已核实的实际扣费。${reviewRows.some(row => row.costUSD === null) ? ' 部分自动审批用量金额未知。' : ''}`
    : reviewRows.some(row => row.costUSD !== null) ? ' 自动审批采用日志报告金额，不据此判断底层型号。'
      : ' 自动审批记录金额未知，保留 Token；可配置参考模型并选择当前费率重算。';
  return {
    meta: { generatedAt: new Date().toISOString(), today: todayStr,
      serverTime: new Date().toLocaleTimeString('zh-CN', { hour12: false }), agentFilter, pricingTier: tier,
      totalDays: selected.timeline.length, earliestMilestone: coverage[0] || todayStr,
      earliestDescription: `${coverage[0] || todayStr} 起可追溯的最早消耗记录`,
      recordCoverage: { from: coverage[0] || null, to: coverage.at(-1) || null },
      actualOnly, usageSchemaVersion: 1, sources: sourceStatuses,
      unmatchedRequestDetails: unmatched.length,
      attribution: { tokens: visibleRecords.filter(row => row.projectPath).reduce((sum, row) => sum + row.totalTokens, 0),
        unmatchedTokens: visibleRecords.filter(row => !row.projectPath).reduce((sum, row) => sum + row.totalTokens, 0) },
      capabilities: require('./runtime-capabilities').getRuntimeCapabilities(),
      pricing,
      autoReviewNotice:reviewNotice.trim(),
      stale, refreshing: loaderStatus.refreshing, lastSuccessfulAt: loaderStatus.lastSuccessfulAt,
      sourceSelectionMode: codexRaw._sourceSelectionMode || 'pending',
      subscriptionDefaults: { defaultPlan: process.env.DEFAULT_SUBSCRIPTION_PLAN || 'chatgpt_plus',
        monthlyFee: Number(process.env.DEFAULT_SUBSCRIPTION_FEE) || 20,
        weeklyAllowance: Number(process.env.DEFAULT_WEEKLY_ALLOWANCE) || 130 },
      costNotice: '金额为日志金额或 API 目录价等值，不代表订阅账单。QoderWork 与 Antigravity Token 为估算；生图文件金额和 Token 等值另列，不计入合计。'
        + reviewNotice
        + (sourceStatuses.api?.requests ? ' 业务 API 已计入；缺少缓存拆分的请求按全部新输入估算，可能偏高。ChatGPT 桥接金额为 API 等值，非额外 API 扣款。' : '')
        + (!all.totals.costComplete ? ' 存在未定价、待复核费率或请求/缓存信息缺口，完整费用未知。' : '')
        + (pricing.mode === 'recorded' ? ' 采用日志金额或首次索引时捕获的费率，不推测发生时的官方历史价。' : ' 当前为选定目录费率下的重算值。')
        + (pricing.error ? ' ' + pricing.error : '') },
    totals: selected.totals, timeline: selected.timeline, companies: selected.companies,
    models: selected.models, modelFamilies, agentBreakdown: all.agentBreakdown,
    projects: projectAdapter.projectsFromRecords(records.filter(row => !actualOnly || !row.estimated), todayStr), imageAnalysis, todaySummary,
    codexQuota,
    zcodePricingInfo: { currentTier: tier,
      standardCostTotal: +standardDaily.reduce((sum, day) => sum + day.totalCost, 0).toFixed(6),
      flagshipCostTotal: +flagshipDaily.reduce((sum, day) => sum + day.totalCost, 0).toFixed(6) }
  };
}

// Fast in-memory cache for dashboard responses (10 seconds)
const dashboardMemCache = {};
const dashboardMemTime = {};
const DASHBOARD_CACHE_TTL = 10 * 1000;

function getCachedDashboardData(tier, agent, force = false, options = {}) {
  const key = `${snapshotKey(tier, options)}_${agent}_${!!options.actualOnly}`;
  const revision = codexLoader.getStatus().lastSuccessfulAt;
  const now = Date.now();
  if (!force && dashboardMemCache[key] && recordSnapshots.has(snapshotKey(tier, options))
    && dashboardMemCache[key].meta.lastSuccessfulAt === revision && (now - (dashboardMemTime[key] || 0) < DASHBOARD_CACHE_TTL)) {
    return dashboardMemCache[key];
  }
  const data = buildDashboardData(tier, agent, options);
  dashboardMemCache[key] = data;
  dashboardMemTime[key] = now;
  if (Object.keys(dashboardMemCache).length > 40) {
    const oldest = Object.keys(dashboardMemCache)[0]; delete dashboardMemCache[oldest]; delete dashboardMemTime[oldest];
  }
  return data;
}

// Every interface uses this bounded initial read and the same cached result.
async function queryDashboard(tier = 'standard', agent = 'all', options = {}) {
  if (isMainThread) return getIndexClient().query('dashboard', { tier, agent, options });
  await codexLoader.ensureFresh();
  // Never publish other agents' subtotal as the complete dashboard while the
  // first Codex history read is still running (or has failed without a backup).
  if (!codexLoader.getStatus().available) {
    throw Object.assign(new Error('Usage history is still loading or unavailable; retry shortly'), { statusCode: 503 });
  }
  return getCachedDashboardData(tier, agent, false, options);
}

function filterRecords(records, filters = {}) {
  return records.filter(row => (!filters.startDate || row.date >= filters.startDate)
    && (!filters.endDate || row.date <= filters.endDate)
    && require('./usage-record').matchesSource(row, filters.agent || 'all')
    && (!filters.actualOnly || !row.estimated)
    && (!filters.projectId || require('./project-records').canonicalizeProject(row.projectPath).key === filters.projectId));
}

async function queryProjects(filters = {}) {
  if (isMainThread) return getIndexClient().query('projects', filters);
  await queryDashboard(filters.tier || 'standard', 'all', filters);
  return projectAdapter.projectsFromRecords(filterRecords(recordSnapshots.get(snapshotKey(filters.tier || 'standard', filters)) || [], filters));
}

async function queryUsageRecords(filters = {}) {
  if (isMainThread) return getIndexClient().query('records', filters);
  const data = await queryDashboard(filters.tier || 'standard', 'all', filters);
  const records = filterRecords(recordSnapshots.get(snapshotKey(filters.tier || 'standard', filters)) || [], filters)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const offset = filters.offset || 0, limit = filters.limit || 100;
  const aggregate = aggregateRecords(records);
  return { schemaVersion: 1, meta: data.meta, filters, totalCount: records.length, offset, limit,
    totals: aggregate.totals, records: records.slice(offset, offset + limit) };
}

async function queryExport(filters = {}, format = 'json') {
  if (isMainThread) return getIndexClient().call('export', { filters, format });
  const data = await queryDashboard(filters.tier || 'standard', 'all', filters);
  const records = filterRecords(recordSnapshots.get(snapshotKey(filters.tier || 'standard', filters)) || [], filters);
  return require('./usage-export').exportUsage(records, data.meta, filters, format);
}

async function queryDiagnostics() {
  if (isMainThread) return getIndexClient().query('diagnostics', {}, { ttlMs: 15_000 });
  const data = await queryDashboard();
  return { meta: data.meta, sources: data.meta.sources, capabilities: data.meta.capabilities };
}

async function queryImages() {
  return isMainThread ? getIndexClient().query('images') : codexImage.getCodexImageCatalog();
}

async function refreshIndexedSources() {
  if (!isMainThread) return refreshSources();
  const client = getIndexClient();
  const result = await client.call('refresh');
  client.invalidate();
  return result;
}

const refreshStatus = new Map();
async function refreshSources() {
  const tasks = [
    ['ccusage', async () => { if (!await codexLoader.forceRefresh() || codexLoader.getStatus().readErrors) throw new Error(codexLoader.getStatus().error || 'Usage loader refresh failed'); }],
    ['zcode', () => { zcode.getZCodeDaily('standard', true); zcode.getZCodeDaily('flagship'); }],
    ['openclaw', () => sources.openclaw.getRecords(true)],
    ['reasonix', () => sources.reasonix.getRecords(true)],
    ['api', () => sources.api.getRecords(true)],
    ['codexAccount', async () => { await accountQuota.capture(true); if (accountQuota.getDiagnostics().stale) throw new Error(accountQuota.getDiagnostics().error); }],
    ['antigravity', () => antigravity.getAntigravityDaily(true)],
    ['images', () => codexImage.getCodexImageAnalysis(true)],
    ['qwen', () => qwen.getQwenDaily(true)],
    ['claude', () => sources.claude.getRecords(true)],
    ['qoderwork', () => qoderwork.getQoderDaily(true)]
  ];
  invalidateDashboardCache();
  invalidateProjectsCache();
  const results = await Promise.all(tasks.map(async ([source, run]) => {
    const previous = refreshStatus.get(source);
    const diagnosticsForSource = () => source === 'ccusage' ? codexLoader.getStatus()
      : source === 'zcode' ? zcode.getDiagnostics() : source === 'images' ? codexImage.getDiagnostics()
        : source === 'codexAccount' ? accountQuota.getDiagnostics()
        : sources[source]?.getDiagnostics();
    const before = diagnosticsForSource();
    refreshStatus.set(source, { ...previous, source, refreshing: true });
    try {
      await run();
      const diagnostics = diagnosticsForSource();
      if (diagnostics?.readErrors || diagnostics?.parseErrors || diagnostics?.undatedRecords) {
        throw new Error(diagnostics.error || 'Some source records could not be indexed');
      }
      const status = { source, success: true, stale: false, refreshing: false, error: null,
        attemptedAt: new Date().toISOString(), lastSuccessfulAt: diagnostics?.lastSuccessfulAt || new Date().toISOString() };
      refreshStatus.set(source, status);
      return status;
    } catch (error) {
      const status = { source, success: false, stale: true, refreshing: false, error: error.message,
        attemptedAt: new Date().toISOString(), lastSuccessfulAt: diagnosticsForSource()?.lastSuccessfulAt
          || previous?.lastSuccessfulAt || before?.lastSuccessfulAt || null };
      refreshStatus.set(source, status);
      return status;
    }
  }));
  // A request during refresh may have populated the previous snapshot.
  invalidateDashboardCache();
  invalidateProjectsCache();
  if (!getPricingHistory().metadata().readable) require('./pricing-history').reloadPricingHistory();
  return { success: results.every(source => source.success), partial: results.some(source => source.success) && results.some(source => !source.success),
    sources: results, timestamp: Date.now() };
}

function invalidateDashboardCache() {
  for (const key of Object.keys(dashboardMemCache)) delete dashboardMemCache[key];
  recordSnapshots.clear();
}

function getSourceStatus() {
  const inventory = Object.fromEntries(Object.entries(sources).map(([source, index]) => [source, index.getDiagnostics()]));
  inventory.zcode = zcode.getDiagnostics();
  inventory.images = codexImage.getDiagnostics();
  inventory.codexAccount = accountQuota.getDiagnostics();
  for (const [source, refresh] of refreshStatus) {
    const current = inventory[source];
    inventory[source] = { ...current, lastRefreshError: refresh.error, lastRefreshAt: refresh.attemptedAt,
      refreshing: !!refresh.refreshing,
      ...(!current || !current.checkedAt || current.checkedAt <= refresh.attemptedAt ? refresh : {}) };
  }
  const loader = codexLoader.getStatus();
  inventory.ccusage = { ...refreshStatus.get('ccusage'), ...loader, source: 'ccusage',
    status: loader.stale ? 'partial' : !loader.available ? 'unavailable' : latestCcusageDates.length ? 'ready' : 'empty',
    paths: [require('./config').codexHome],
    pathNotice: '此目录为 Codex 输入；Claude 路径另列，ccusage 未返回的其他来源路径未知。',
    coverage: { from: latestCcusageDates[0] || null, to: latestCcusageDates.at(-1) || null } };
  return inventory;
}

module.exports = { buildDashboardData, getCachedDashboardData, getCodexData,
  getCcusageBreakdownCost, getProjectsCached, invalidateProjectsCache,
  invalidateDashboardCache, refreshSources, queryDashboard,
  queryProjects, queryImages, queryUsageRecords, queryDiagnostics, queryExport, refreshIndexedSources,
  startWarmup: () => queryDashboard().catch(error => console.error('[usage-index]', error.message)),
  dispose: () => indexClient?.dispose(),
  getSourceStatus, collectUsageRecords, getUsageRecords: () => latestRecords,
  getUnmatchedDetails: () => latestUnmatched,
  codexLoader };
