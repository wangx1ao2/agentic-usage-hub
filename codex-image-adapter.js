'use strict';
const { getLocalDateStr } = require('./lib/date');
const index = require('./lib/image-index');
const IMAGE_PRICING = {
  model: 'GPT-Image-2',
  costPerImage: 0.053,
  equivalentTokensPerImage: 20000 // Display-only conversion, not measured usage or quota.
};

// File counts are not API requests. Keep these hypothetical estimates out of
// logged model totals; Codex logs do not establish complete image billing.
const IMAGE_COST_BASIS = Object.freeze({
  costBasis: 'file-count-reference', tokenBasis: 'file-count-equivalent',
  usageAvailable: false, includedInTotals: false,
  referenceCostPerImage: IMAGE_PRICING.costPerImage,
  referenceQuality: 'medium', referenceSize: '1024x1024'
});


function getCodexImageAnalysis(force = false) {
  const catalog = index.getCatalog(force), today = getLocalDateStr(), days = new Map();
  for (const image of catalog) {
    let day = days.get(image.date);
    if (!day) { day = { date: image.date, count: 0, cost: 0, tokens: 0, images: [] }; days.set(image.date, day); }
    day.count++; day.cost += IMAGE_PRICING.costPerImage; day.tokens += IMAGE_PRICING.equivalentTokensPerImage;
    if (day.images.length < 5) day.images.push(image);
  }
  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const current = days.get(today);
  const count = catalog.length, cost = count * IMAGE_PRICING.costPerImage, tokens = count * IMAGE_PRICING.equivalentTokensPerImage;
  return { model: IMAGE_PRICING.model, ...IMAGE_COST_BASIS,
    totals: { totalCount: count, totalCost: +cost.toFixed(2), totalTokens: tokens,
      formattedCost: '$' + cost.toFixed(2), formattedTokens: (tokens / 1e6).toFixed(1) + 'M', activeDays: days.size,
      todayDate: today, todayCount: current?.count || 0, todayCost: +(current?.cost || 0).toFixed(2), todayTokens: current?.tokens || 0 },
    daily, recentImages: catalog.slice(0, 100) };
}
module.exports = { getCodexImageAnalysis, getCodexImageCatalog: () => index.getCatalog(), getDiagnostics: index.getDiagnostics };
