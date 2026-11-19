'use strict';

const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const has = (object, key) => Object.hasOwn(object || {}, key);
const rateKnown = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

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
  let cacheReadByMode = policy.cacheReadByMode;
  let outputByReasoningMode = policy.outputByReasoningMode;
  const missingComponents = new Set();
  let missingTokens = 0;
  let cost = null;
  const asOf = options.asOf || new Date().toISOString();
  if (policy.validThrough && String(asOf).slice(0,10) > policy.validThrough) issues.push('reference-rate-expired');
  if (request && policy.maxInputTokens !== undefined && inputTotal > policy.maxInputTokens) issues.push('input-exceeds-model-limit');
  if (request && price) {
    for (const band of policy.inputBands || []) {
      if (inputTotal > band.above) {
        effectivePrice = { ...effectivePrice, ...band.rates }; longContext = true;
        cacheReadByMode = band.cacheReadByMode || cacheReadByMode;
        outputByReasoningMode = band.outputByReasoningMode || outputByReasoningMode;
      }
    }
    const context = policy.context;
    const contextInput = policy.version ? inputTotal : fresh + cached;
    if (context && (context.inclusive ? contextInput >= context.above : contextInput > context.above)) {
      effectivePrice = { ...effectivePrice, in: rateKnown(effectivePrice.in) ? effectivePrice.in * context.input : null,
        cache: rateKnown(effectivePrice.cache) ? effectivePrice.cache * context.cache : null,
        out: rateKnown(effectivePrice.out) ? effectivePrice.out * context.output : null };
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
  if (policy.version && options.inferenceGeo) {
    if (has(policy.inferenceGeos,options.inferenceGeo)) {
      const geoMultiplier = policy.inferenceGeos[options.inferenceGeo];
      serviceMultipliers = Object.fromEntries(Object.entries(serviceMultipliers).map(([part,multiplier])=>[part,multiplier*geoMultiplier]));
    } else issues.push('inference-geo-unverified');
  }
  if (row?.pricingEvidence?.status === 'legacy-reference'
    || row?.pricingEvidence?.referenceStatus === 'legacy-reference') issues.push('legacy-rate-unverified');
  const expired = issues.includes('reference-rate-expired');
  if (cached && policy.cacheUnavailableTiers?.includes(serviceTier)) issues.push('cache-not-supported-for-service-tier');
  if (row && !row.unpriced && effectivePrice && !expired
    && !issues.includes('input-exceeds-model-limit') && !issues.includes('cache-not-supported-for-service-tier') && !issues.includes('inference-geo-unverified')
    && (!policy.version || !issues.includes('service-tier-unverified'))) {
    const cachePrice = cacheReadByMode && options.cacheMode
      ? has(cacheReadByMode,options.cacheMode) ? cacheReadByMode[options.cacheMode] : null : effectivePrice.cache;
    const outputPrice = outputByReasoningMode && options.reasoningMode
      ? has(outputByReasoningMode,options.reasoningMode) ? outputByReasoningMode[options.reasoningMode] : null : effectivePrice.out;
    cost = 0;
    let knownTokens = 0;
    function add(tokens, rate, multiplier, component, issue) {
      if (!tokens) return;
      if (rateKnown(rate)) { cost += tokens * rate * multiplier; knownTokens += tokens; }
      else { missingComponents.add(component); missingTokens += tokens; issues.push(issue); }
    }
    add(fresh,effectivePrice.in,serviceMultipliers.input,'inputTokens','input-rate-unavailable');
    add(cached,cachePrice,serviceMultipliers.cache,'cacheReadTokens','cache-read-rate-unavailable');
    add(output,outputPrice,serviceMultipliers.output,'outputTokens','output-rate-unavailable');
    if (written) {
      const split = options.cacheWrite;
      const splitCount = count(split?.shortTokens) + count(split?.longTokens);
      const multipliers = policy.cacheWriteMultipliers;
      if (multipliers && split && splitCount === written) {
        add(count(split.shortTokens),rateKnown(effectivePrice.in) && rateKnown(multipliers.short)
          ? effectivePrice.in * multipliers.short : null,serviceMultipliers.cacheWrite,'cacheWriteTokens','cache-write-rate-unavailable');
        add(count(split.longTokens),rateKnown(effectivePrice.in) && rateKnown(multipliers.long)
          ? effectivePrice.in * multipliers.long : null,serviceMultipliers.cacheWrite,'cacheWriteTokens','cache-write-rate-unavailable');
      } else { issues.push('cache-write-rate-unavailable'); missingComponents.add('cacheWriteTokens'); missingTokens += written; }
    }
    if (!knownTokens && missingTokens) cost = null;
    else cost /= 1e6;
    if (cost !== null && !Number.isFinite(cost)) { cost = null; issues.push('invalid-price-result'); }
  }
  const allUnknown = cost === null || issues.includes('legacy-rate-unverified') || issues.includes('request-context-unavailable');
  return { cost, costComplete: cost !== null && issues.length === 0, unpriced: cost === null,
    unpricedTokens:allUnknown ? inputTotal + output : missingTokens,missingComponents:[...missingComponents],
    longContext, speedMultiplier, speedKnown: !!options.serviceTier && has(tiers, serviceTier),
    inputTotal, issues, serviceMultipliers, policyVersion: policy.version || 0,
    evidence: row?.pricingEvidence || null };
}

module.exports = { quoteCatalogUsage, legacyPolicy };
