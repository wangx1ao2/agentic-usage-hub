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

test('changing or disabling a reviewer estimate after restart preserves its first price and assumption context', () => {
  const source = `
    const path=require('node:path');
    const {priceRequest}=require('./lib/codex-request-usage');
    const {createRequestRecord}=require('./lib/request-record');
    const {createPricingHistory}=require('./lib/pricing-history');
    const {autoReviewCostBasis}=require('./models-pricing');
    const quote=priceRequest('codex-auto-review',{input_tokens:300,cached_input_tokens:200,output_tokens:10});
    const row=createRequestRecord({source:'codex',id:'persisted-review',rawModel:'codex-auto-review',
      timestamp:'2026-11-19T04:00:00Z',inputTokens:100,cacheReadTokens:200,outputTokens:10,
      costUSD:quote.unpriced?undefined:quote.cost,costBasis:autoReviewCostBasis,pricingContext:quote.pricingContext});
    const history=createPricingHistory({directory:path.join(process.env.HOME,'review-config-restart')});
    const original=history.metadata().versions.sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt))[0].id;
    console.log(JSON.stringify({recorded:history.apply([row])[0],current:history.apply([row],{pricingMode:'current'})[0],
      original:history.apply([row],{pricingMode:'current',pricingVersion:original})[0]}));
  `;
  const run = model => JSON.parse(execFileSync(process.execPath, ['-e',source], {encoding:'utf8',
    env:{...process.env,AGENTIC_DISABLE_DOTENV:'1',CODEX_AUTO_REVIEW_RATE_MODEL:model}}));
  const first=run('gpt-6.1-sol');
  assert.equal(first.recorded.costUSD,0.00032);
  const changed=run('gpt-6.1-terra');
  assert.equal(changed.recorded.costUSD,first.recorded.costUSD);
  assert.equal(changed.recorded.pricingContext.assumedRateModel,'gpt-6.1-sol');
  assert.equal(changed.current.costUSD,0.00016);
  assert.equal(changed.current.pricingContext.assumedRateModel,'gpt-6.1-terra');
  assert.equal(changed.original.costUSD,first.recorded.costUSD);
  assert.equal(changed.original.pricingContext.assumedRateModel,'gpt-6.1-sol');
  const disabled=run('');
  assert.equal(disabled.recorded.costUSD,first.recorded.costUSD);
  assert.equal(disabled.recorded.pricingContext.assumedRateModel,'gpt-6.1-sol');
  assert.equal(disabled.current.costUSD,null);
});
