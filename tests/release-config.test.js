'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

test('public default and invalid reviewer configuration stay unpriced through request, aggregate and price history', () => {
  const source = `
    const { priceRequest } = require('./lib/codex-request-usage');
    const { getCcusageBreakdownCost } = require('./lib/ccusage-normalize');
    const { createRequestRecord } = require('./lib/request-record');
    const { createPricingHistory } = require('./lib/pricing-history');
    const quote = priceRequest('codex-auto-review', {input_tokens: 300000, cached_input_tokens: 200000, output_tokens: 10000}, 'fast');
    const row = createRequestRecord({source:'codex',id:'review',model:'codex-auto-review',timestamp:'2026-11-17T04:00:00Z',inputTokens:100000,cacheReadTokens:200000,outputTokens:10000,pricingContext:quote.pricingContext});
    const reported = createRequestRecord({...row,id:'reported',costUSD:0,costBasis:'reported'});
    const history = createPricingHistory();
    const result = history.apply([row],{pricingMode:'current'})[0];
    console.log(JSON.stringify({quote,amount:getCcusageBreakdownCost('codex-auto-review',{cost:99,inputTokens:100000}),row,result,reported}));
  `;
  for (const configured of ['', 'missing-model']) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', source], { encoding: 'utf8',
      env: { ...process.env, AGENTIC_DISABLE_DOTENV: '1', CODEX_AUTO_REVIEW_RATE_MODEL: configured } }));
    assert.equal(result.quote.unpriced, true);
    assert.equal(result.quote.pricingContext.assumedRateModel, null);
    assert.equal(result.amount.unpriced, true, 'Native fallback amounts are not verified reviewer costs');
    assert.equal(result.row.costUSD, null);
    assert.equal(result.result.costUSD, null, 'Current price snapshots cannot turn unknown into free');
    assert.equal(result.result.costComplete, false);
    assert.equal(result.reported.costUSD, 0, 'An explicitly reported zero amount is valid');
    assert.equal(result.reported.costBasis, 'reported');
  }
});

test('an alternate reviewer model is disclosed and does not inherit GPT context multipliers', () => {
  const source = `const {priceRequest}=require('./lib/codex-request-usage');
    const {autoReviewCostBasis}=require('./models-pricing');
    console.log(JSON.stringify({quote:priceRequest('codex-auto-review',{input_tokens:300000,output_tokens:10000}),basis:autoReviewCostBasis}));`;
  const result = JSON.parse(execFileSync(process.execPath, ['-e', source], { encoding: 'utf8',
    env: { ...process.env, AGENTIC_DISABLE_DOTENV: '1', CODEX_AUTO_REVIEW_RATE_MODEL: 'claude-sonnet-4-6' } }));
  assert.equal(result.quote.unpriced, false);
  assert.equal(result.quote.longContext, false);
  assert.equal(result.quote.pricingContext.assumedRateModel, 'claude-sonnet-4-6');
  assert.equal(result.basis, 'user-assumed-model-rate');
});
