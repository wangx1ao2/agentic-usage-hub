'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {MODEL_CATALOG,resolveModelInfo,quoteModelUsage} = require('../models-pricing');
const {quoteCatalogUsage} = require('../lib/pricing-rules');
const {parseUsageLog} = require('../lib/log-parsers');
const {apiRecord} = require('../lib/business-api-usage');
const {createPricingHistory} = require('../lib/pricing-history');
const {aggregateRecords} = require('../lib/usage-aggregate');
const {recordsToDaily} = require('../lib/request-record');
const {normalizeDaily} = require('../lib/usage-record');
const quote = (model,fresh,cached,output,options={}) => quoteModelUsage(model,
  {inputTokens:fresh,cacheReadTokens:cached,outputTokens:output},
  {source:'qwen',granularity:'request',...options});
const closeCny = (actual,cny) => assert.ok(Math.abs(actual - cny / 7.15) < 1e-12,`${actual} != CNY ${cny} / 7.15`);

test('Qwen request bands and cache modes use the selected Beijing reference without rounding unit prices', () => {
  assert.equal(MODEL_CATALOG['qwen3.8-max'].standard.in,12 / 7.15);
  assert.equal(MODEL_CATALOG['qwen3.8-max'].pricingEvidence.originalCurrency,'CNY');
  assert.equal(MODEL_CATALOG['qwen3.8-max'].pricingEvidence.region,'cn-beijing');
  closeCny(quote('qwen3.7-flash',32000,0,1000).cost,0.0072);
  closeCny(quote('qwen3.7-flash',32001,0,1000).cost,0.0216006);
  closeCny(quote('qwen3.7-flash',20000,20000,1000,{cacheMode:'implicit'}).cost,0.0168);
  closeCny(quote('qwen3.7-flash',20000,20000,1000,{cacheMode:'explicit'}).cost,0.0156);
  const missing = quote('qwen3.7-flash',20000,20000,1000);
  closeCny(missing.cost,0.0144);
  assert.equal(missing.unpricedTokens,20000);
  assert.equal(missing.costComplete,false);
  const day = quote('qwen3.7-flash',32001,0,1000,{granularity:'day-model'});
  closeCny(day.cost,0.0072002);
  assert.equal(day.costComplete,false);
  assert.equal(day.longContext,false);
});

test('Qwen reasoning mode gaps and mutually exclusive Batch/cache discounts remain explicit', () => {
  closeCny(quote('qwen-plus',80000,20000,50000,{cacheMode:'implicit',reasoningMode:'non-thinking'}).cost,0.1672);
  closeCny(quote('qwen-plus',80000,20000,50000,{cacheMode:'implicit',reasoningMode:'thinking'}).cost,0.4672);
  const missing = quote('qwen-plus',80000,20000,50000,{cacheMode:'implicit'});
  closeCny(missing.cost,0.0672);
  assert.equal(missing.unpricedTokens,50000);
  assert.deepEqual(missing.missingComponents,['outputTokens']);
  assert.equal(quote('qwen-plus',80000,20000,50000,{cacheMode:'implicit',reasoningMode:'thinking',serviceTier:'batch'}).cost,null);
  closeCny(quote('qwen-plus',100000,0,50000,{reasoningMode:'non-thinking',serviceTier:'batch'}).cost,0.09);
});

test('a dated Qwen model does not inherit an alias promotion or accept undocumented snapshot names', () => {
  closeCny(quote('qwen3.7-plus',100000,0,10000).cost,0.224);
  closeCny(quote('qwen3.7-plus-2026-05-26',100000,0,10000).cost,0.28);
  assert.equal(resolveModelInfo('qwen3.7-plus-20260526').canonicalName,'qwen3.7-plus-2026-05-26');
  const dated = parseUsageLog('qwen',JSON.stringify({timestamp:'2026-11-19T04:00:00Z',
    model:'qwen3.7-plus-2026-05-26',usageMetadata:{promptTokenCount:100000,candidatesTokenCount:10000}})+'\n','dated.jsonl').records;
  const daily = normalizeDaily(recordsToDaily(dated),'qwen');
  assert.equal(daily[0].canonicalModel,'qwen3.7-plus-2026-05-26');
  const reconciled = require('../lib/record-reconciliation').reconcileRequests(daily,dated);
  assert.equal(reconciled.records[0].granularity,'request');
  assert.equal(reconciled.unmatched.length,0);
  for (const model of ['qwen3.7-plus-2026-11-19','qwen3.8-max-20270101','qwen3.9-max','qwen3-coder-flash-2507']) {
    assert.equal(resolveModelInfo(model).unpriced,true,model);
    assert.equal(quote(model,100,0,10).cost,null,model);
  }
});

test('Qwen console-only cache prices stay unknown while parsed API cache writes conserve all token components', () => {
  const row = {requestId:'qwen-cache',timestamp:'2026-11-19T04:00:00Z',model:'qwen3.8-max',
    usage:{prompt_tokens:350,completion_tokens:10,total_tokens:360,
      prompt_tokens_details:{cached_tokens:200,cache_creation_input_tokens:50}}};
  const direct = parseUsageLog('qwen',JSON.stringify(row)+'\n','qwen.jsonl').records[0];
  const business = apiRecord(row,'F:/fixture/qwen');
  for (const record of [direct,business]) {
    assert.equal(record.inputTokens,100); assert.equal(record.cacheReadTokens,200);
    assert.equal(record.cacheWriteTokens,50); assert.equal(record.outputTokens,10);
    assert.equal(record.totalTokens,360); assert.equal(record.costUSD,0.000323);
    assert.equal(record.costComplete,false); assert.equal(record.unpricedTokens,200);
    assert.equal(record.pricingContext.cacheMode,'explicit');
  }
  assert.equal(quote('qwen3.8-max',0,200,0).cost,null,'A wholly unknown cache amount is not free');
  const aggregate = aggregateRecords([direct,direct]);
  assert.equal(aggregate.totals.totalTokens,360);
  assert.equal(aggregate.totals.unpricedTokens,200);
  assert.equal(aggregate.totals.costComplete,false);
  const normalized = normalizeDaily(recordsToDaily([direct]),'qwen');
  assert.equal(normalized[0].unpricedTokens,200);
  const invalid = {...row,usage:{...row.usage,prompt_tokens:240}};
  assert.equal(apiRecord(invalid,'F:/fixture/qwen'),null);
  const parsedInvalid = parseUsageLog('qwen',JSON.stringify(invalid)+'\n','qwen.jsonl');
  assert.equal(parsedInvalid.records.length,0); assert.equal(parsedInvalid.parseErrors,1);
  const free = quoteCatalogUsage({standard:{in:1,out:1,cache:0},pricingPolicy:{version:1,serviceTiers:{default:1}}},
    'free-cache',{cacheReadTokens:200});
  assert.equal(free.cost,0); assert.equal(free.costComplete,true);
});

test('nullable Qwen rates and original missing components survive history restart and FX changes', () => {
  const record = parseUsageLog('qwen',JSON.stringify({timestamp:'2026-11-19T04:00:00Z',model:'qwen3.8-max',
    usage:{prompt_tokens:350,completion_tokens:10,total_tokens:360,
      prompt_tokens_details:{cached_tokens:200,cache_creation_input_tokens:50}}})+'\n','qwen.jsonl').records[0];
  const directory = fs.mkdtempSync(path.join(process.env.HOME,'qwen-history-'));
  const first = createPricingHistory({directory});
  const original = first.apply([record])[0];
  const catalog = JSON.parse(JSON.stringify(MODEL_CATALOG));
  const model = catalog['qwen3.8-max'];
  model.standard = model.flagship = {in:12/14.3,out:36/14.3,cache:null};
  model.pricingEvidence.exchangeRateCNYPerUSD = 14.3;
  const restarted = createPricingHistory({directory,catalog});
  assert.equal(restarted.metadata().readable,true);
  const saved = restarted.apply([{...record,costUSD:0.000162,unpricedTokens:0}])[0];
  assert.equal(saved.costUSD,original.costUSD);
  assert.equal(saved.unpricedTokens,200);
  assert.equal(saved.pricingContext.evidence.exchangeRateCNYPerUSD,7.15);
  const current = restarted.apply([record],{pricingMode:'current'})[0];
  assert.equal(current.costUSD,0.000162);
  assert.equal(current.unpricedTokens,200);
  assert.notEqual(current.pricingVersion,original.pricingVersion);
  assert.equal(restarted.apply([record],{pricingMode:'current',pricingVersion:original.pricingVersion})[0].costUSD,original.costUSD);
});

test('Qwen region/FX selection changes catalog identity and never borrows an unavailable region or infinite rate', () => {
  function selected(region,fx) {
    return JSON.parse(execFileSync(process.execPath,['-e',`const c=require('./models-pricing').MODEL_CATALOG;
      console.log(JSON.stringify({max:c['qwen3.8-max'],small:c['qwen3.8-27b']}));`],
      {encoding:'utf8',env:{...process.env,QWEN_PRICING_REGION:region,QWEN_USD_CNY_RATE:fx}}));
  }
  assert.equal(selected('cn-beijing','10').max.standard.in,1.2);
  const singapore = selected('intl-singapore','1');
  assert.equal(singapore.max.standard.in,14.988);
  assert.equal(singapore.small.standard.out,21.875);
  assert.equal(selected('global','1').small.unpriced,true);
  assert.equal(selected('unverified-region','1').max.unpriced,true);
  const invalid = selected('cn-beijing','Infinity');
  assert.equal(invalid.max.standard.in,12/7.15);
  assert.equal(invalid.max.pricingEvidence.exchangeRateBasis,'invalid-config-default-assumption');
});
