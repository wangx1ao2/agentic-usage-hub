'use strict';

const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const has = (object, key) => Object.hasOwn(object || {}, key);

// Snapshots saved before pricingPolicy existed must retain their old arithmetic.
// New catalogs carry their own rules, so changing code cannot change saved rates.
function legacyPolicy(model, source) {
  const context = ['codex', 'api'].includes(source)
    && (/^gpt-6(?:\.1)?-(?:astra|sol|luna)$/.test(model) || model === 'gpt-6.1-terra');
  return { version: 0, ...(context ? { context: { above: 272000, input: 2, cache: 2, output: 1.5 } } : {}),
    serviceTiers: { default: 1, standard: 1, fast: 2, priority: 2, ultrafast: 6 } };
}

function quoteCatalogUsage(row, model, usage, options = {}) {
  const fresh = count(usage.inputTokens), cached = count(usage.cacheReadTokens);
  const written = count(usage.cacheWriteTokens), output = count(usage.outputTokens);
  const inputTotal = fresh + cached + written;
  const policy = row?.pricingPolicy || legacyPolicy(model, options.source);
  const request = options.granularity !== 'day-model';
  const serviceTier = options.serviceTier || 'default';
  const issues = [];
  if (!row || row.unpriced) issues.push('model-rate-unavailable');
  let price = options.tier === 'flagship' ? row?.flagship || row?.standard : row?.standard;
  let longContext = false;
  let speedMultiplier = 1;
  let effectivePrice = price;
  let cost = null;
  const asOf = options.asOf || new Date().toISOString();
  if (policy.validThrough && String(asOf).slice(0,10) > policy.validThrough) issues.push('reference-rate-expired');
  if (request && price) {
    for (const band of policy.inputBands || []) {
      if (inputTotal > band.above) { effectivePrice = { ...effectivePrice, ...band.rates }; longContext = true; }
    }
    const context = policy.context;
    const contextInput = policy.version ? inputTotal : fresh + cached;
    if (context && (context.inclusive ? contextInput >= context.above : contextInput > context.above)) {
      effectivePrice = { ...effectivePrice, in: effectivePrice.in * context.input,
        cache: effectivePrice.cache * context.cache, out: effectivePrice.out * context.output };
      longContext = true;
    }
  } else if (!request && (policy.context || policy.inputBands?.length)) {
    issues.push('request-context-unavailable');
  }
  const tiers = policy.serviceTiers || { default: 1, standard: 1 };
  let serviceMultipliers = { input: 1, cache: 1, output: 1, cacheWrite: 1 };
  if (has(tiers, serviceTier)) {
    const tier = tiers[serviceTier];
    serviceMultipliers = typeof tier === 'number'
      ? { input: tier, cache: tier, output: tier, cacheWrite: tier } : tier;
    speedMultiplier = serviceMultipliers.input;
  }
  else issues.push('service-tier-unverified');
  if (row?.pricingEvidence?.status === 'legacy-reference'
    || row?.pricingEvidence?.referenceStatus === 'legacy-reference') issues.push('legacy-rate-unverified');
  const expired = issues.includes('reference-rate-expired');
  if (row && !row.unpriced && effectivePrice && !expired
    && (!policy.version || !issues.includes('service-tier-unverified'))) {
    cost = (fresh * effectivePrice.in * serviceMultipliers.input
      + cached * effectivePrice.cache * serviceMultipliers.cache
      + output * effectivePrice.out * serviceMultipliers.output) / 1e6;
    if (written) {
      const split = options.cacheWrite;
      const splitCount = count(split?.shortTokens) + count(split?.longTokens);
      const multipliers = policy.cacheWriteMultipliers;
      if (multipliers && split && splitCount === written) {
        cost += effectivePrice.in * serviceMultipliers.cacheWrite * (count(split.shortTokens) * multipliers.short
          + count(split.longTokens) * multipliers.long) / 1e6;
      } else issues.push('cache-write-rate-unavailable');
    }
    if (!Number.isFinite(cost)) { cost = null; issues.push('invalid-price-result'); }
  }
  return { cost, costComplete: cost !== null && issues.length === 0, unpriced: cost === null,
    longContext, speedMultiplier, speedKnown: !!options.serviceTier && has(tiers, serviceTier),
    inputTotal, issues, serviceMultipliers, policyVersion: policy.version || 0,
    evidence: row?.pricingEvidence || null };
}

module.exports = { quoteCatalogUsage, legacyPolicy };
