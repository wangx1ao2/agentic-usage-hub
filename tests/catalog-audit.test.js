'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {MODEL_CATALOG,quoteModelUsage} = require('../models-pricing');
const {createRequestRecord} = require('../lib/request-record');
const {createPricingHistory} = require('../lib/pricing-history');
const {parseUsageLog} = require('../lib/log-parsers');
const options = {source:'api',asOf:'2026-11-19T04:00:00Z'};
const usage = {inputTokens:10000,cacheReadTokens:5000,outputTokens:1000};
const close = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('every bundled reference has either checked evidence or an explicit reason for unavailable pricing', () => {
  const accepted = new Set(['verified','verified-historical','reference-unavailable','provider-required','user-assumption']);
  for (const [id,row] of Object.entries(MODEL_CATALOG)) {
    assert.ok(accepted.has(row.pricingEvidence?.status),id);
    if (!row.unpriced) {
      assert.match(row.pricingEvidence.source,/^https:\/\//,id);
      assert.equal(row.pricingEvidence.checkedAt,'2026-11-19',id);
    } else assert.ok(row.pricingEvidence.note,id);
  }
});

test('retired Claude references use their public historical prices with a model limit and lifecycle evidence', () => {
  close(quoteModelUsage('claude-3-7-sonnet',usage,options).cost,0.0465);
  close(quoteModelUsage('claude-3-haiku',usage,options).cost,0.003875);
  for (const id of ['claude-3-7-sonnet','claude-3-5-sonnet','claude-3-5-haiku','claude-3-opus','claude-3-haiku']) {
    const row = MODEL_CATALOG[id];
    assert.equal(row.pricingEvidence.status,'verified-historical');
    assert.equal(row.pricingEvidence.availability,'retired');
    assert.match(row.pricingEvidence.lifecycleSource,/model-deprecations/);
    assert.equal(quoteModelUsage(id,{inputTokens:200001},options).cost,null);
  }
});

test('Gemini 3.x discounted cache prices do not leak to the 2.5 tiers or survive their documented expiry', () => {
  const normal = quoteModelUsage('gemini-3.8-flash',usage,options);
  for (const serviceTier of ['batch','flex']) {
    close(quoteModelUsage('gemini-3.8-flash',usage,{...options,serviceTier}).cost,normal.cost/2);
    close(quoteModelUsage('gemini-2.5-flash-lite',usage,{...options,serviceTier}).cost,0.00075);
  }
  assert.equal(quoteModelUsage('gemini-3.8-flash',usage,{...options,asOf:'2027-01-01T00:00:00Z'}).cost,null);
  assert.equal(quoteModelUsage('gemini-2.5-flash-lite',usage,{...options,asOf:'2027-01-01T00:00:00Z'}).costComplete,true);
  const routed = quoteModelUsage('gemini-3.7-flash',usage,options);
  assert.equal(routed.cost,normal.cost);
  assert.equal(routed.evidence.routedTo,'gemini-3.8-flash');
});

test('a checked missing reference remains unknown while logged zero and old captured amounts survive', () => {
  const missing = Object.entries(MODEL_CATALOG).filter(([,row])=>row.pricingEvidence.status==='reference-unavailable');
  assert.equal(missing.length,19);
  for (const [id] of missing) {
    const row = createRequestRecord({source:'api',id,model:id,timestamp:'2026-11-19T04:00:00Z',...usage});
    assert.equal(row.costUSD,null,id);
    assert.equal(row.costComplete,false,id);
    assert.equal(row.unpricedTokens,16000,id);
    assert.equal(createRequestRecord({source:'api',id,model:id,timestamp:'2026-11-19T04:00:00Z',costUSD:0,...usage}).costUSD,0,id);
  }
  const directory = fs.mkdtempSync(path.join(process.env.HOME,'retired-history-'));
  const model = 'qwen3-max';
  const originalCatalog = {[model]:{standard:{in:1.2,cache:0.3,out:6}}};
  const original = {...createRequestRecord({source:'qwen',id:'old',model,timestamp:'2026-11-19T04:00:00Z',...usage}),
    costUSD:0.0195,unpriced:false,costComplete:true,costBasis:'catalog-estimate'};
  const first = createPricingHistory({directory,catalog:originalCatalog}).apply([original])[0];
  const restarted = createPricingHistory({directory});
  const currentRecord = {...original,costUSD:null,costComplete:false,unpriced:true,costBasis:'unpriced'};
  assert.equal(restarted.apply([currentRecord])[0].costUSD,0.0195);
  assert.equal(restarted.apply([currentRecord],{pricingMode:'current'})[0].costUSD,null);
  assert.equal(restarted.apply([currentRecord],{pricingMode:'current',pricingVersion:first.pricingVersion})[0].costUSD,0.0195);
});

test('actual Claude response speed and geography govern pricing, and survive captured replay', () => {
  const parse = (usageFields,extra={}) => parseUsageLog('claude',JSON.stringify({timestamp:'2026-11-19T04:00:00Z',
    id:'response',...extra,message:{model:'claude-opus-5-5',usage:{input_tokens:10000,cache_read_input_tokens:5000,
      output_tokens:1000,...usageFields}}})+'\n','fixture.jsonl').records[0];
  const normal = parse({speed:'standard',inference_geo:'global'},{speed:'fast'});
  close(normal.costUSD,0.061);
  const fast = parse({speed:'fast',inference_geo:'us',service_tier:'standard'});
  close(fast.costUSD,0.1342);
  assert.equal(fast.pricingContext.serviceTier,'fast');
  assert.equal(fast.pricingContext.reportedSpeed,'fast');
  assert.equal(fast.pricingContext.inferenceGeo,'us');
  assert.equal(parse({speed:'fast',service_tier:'batch'}).costUSD,null);
  assert.equal(parse({speed:'future'}).costUSD,null);
  assert.equal(parse({inference_geo:'unknown'}).costUSD,null);
  const directory = fs.mkdtempSync(path.join(process.env.HOME,'claude-speed-history-'));
  const first = createPricingHistory({directory});
  const captured = first.apply([fast])[0];
  const restarted = createPricingHistory({directory});
  assert.equal(restarted.apply([fast])[0].costUSD,0.1342);
  assert.equal(restarted.apply([fast],{pricingMode:'current',pricingVersion:captured.pricingVersion})[0].costUSD,0.1342);
  const old = quoteModelUsage('claude-3-7-sonnet',usage,{...options,inferenceGeo:'us'});
  assert.equal(old.cost,null,'Older models do not support the geography parameter');
  const standardGrok = quoteModelUsage('grok-4.7',usage,options).cost;
  close(quoteModelUsage('grok-4.7',usage,{...options,serviceTier:'batch'}).cost,standardGrok*0.8);
  close(quoteModelUsage('grok-4.7',usage,{...options,serviceTier:'priority'}).cost,standardGrok*2);
  assert.equal(quoteModelUsage('grok-build-0.1',usage,{...options,serviceTier:'batch'}).cost,null);
});
