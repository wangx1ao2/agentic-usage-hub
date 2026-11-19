'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createFileCache} = require('../lib/file-cache');
const {hash} = require('../lib/persistent-cache');
const {createPricingHistory} = require('../lib/pricing-history');
const {createRequestRecord} = require('../lib/request-record');

test('large request indexes retain complete evidence across restart without repeating it for every request', () => {
  const directory = fs.mkdtempSync(path.join(process.env.HOME,'evidence-index-'));
  const source = path.join(directory,'source.jsonl'), filename = path.join(directory,'index.json');
  fs.writeFileSync(source,'fixture\n');
  const evidence = {source:'https://example.test/pricing',checkedAt:'2026-11-19',note:'fixture'.repeat(400)};
  const records = Array.from({length:1000},(_,id) => ({id,inputTokens:100,outputTokens:20,
    pricingContext:{cacheMode:'implicit',evidence}}));
  const parse = () => ({records});
  const storage = {filename,identity:'evidence-fixture'};
  const original = createFileCache(parse,fs,storage).update([source]);
  assert.deepEqual(original,records);
  assert.ok(fs.statSync(filename).size < Buffer.byteLength(JSON.stringify(records))/2,'Repeated evidence must not dominate the index');
  let parsed = 0;
  const restored = createFileCache(() => {parsed++; return parse();},fs,storage);
  assert.deepEqual(restored.update([source]),records);
  assert.equal(parsed,0);
  const damaged = JSON.parse(fs.readFileSync(filename,'utf8'));
  damaged.data.entries[0][1].records[0].pricingContext._pricingEvidenceRef = 100000;
  damaged.checksum = hash(damaged.data);
  fs.writeFileSync(filename,JSON.stringify(damaged));
  const rebuilt = createFileCache(() => {parsed++; return parse();},fs,storage);
  assert.deepEqual(rebuilt.update([source]),records);
  assert.equal(parsed,1);
  assert.equal(rebuilt.diagnostics().restoredFiles,0);
  assert.equal(fs.readFileSync(source,'utf8'),'fixture\n');
});

test('an invalid durable evidence reference preserves the history and old captures never claim current evidence', () => {
  const directory = fs.mkdtempSync(path.join(process.env.HOME,'evidence-history-'));
  const record = createRequestRecord({source:'qwen',id:'qwen',model:'qwen3.8-max',
    timestamp:'2026-11-19T04:00:00Z',inputTokens:100,outputTokens:20});
  const history = createPricingHistory({directory});
  history.apply([record]);
  const filename = path.join(directory,'history.json');
  const saved = JSON.parse(fs.readFileSync(filename,'utf8'));
  const capture = Object.values(saved.records)[0];
  delete capture.pricingContext;
  fs.writeFileSync(filename,JSON.stringify(saved));
  const previous = createPricingHistory({directory}).apply([record])[0];
  assert.equal(previous.pricingContext.historicalContextUnavailable,true);
  assert.equal(previous.pricingContext.evidence.region,'cn-beijing','Evidence comes from the saved snapshot');
  capture.pricingContext = {_evidenceFromSnapshot:'missing-model'};
  const damaged = JSON.stringify(saved);
  fs.writeFileSync(filename,damaged);
  const corrupt = createPricingHistory({directory});
  assert.equal(corrupt.metadata().readable,false);
  assert.equal(corrupt.apply([record])[0].pricingHistoryUnavailable,true);
  assert.equal(fs.readFileSync(filename,'utf8'),damaged);
  const legacyDirectory = path.join(directory,'legacy');
  const legacy = createPricingHistory({directory:legacyDirectory,catalog:{'qwen3.8-max':{standard:{in:1,out:2,cache:0.1}}}});
  const old = legacy.apply([{...record,pricingContext:undefined}])[0];
  const upgraded = createPricingHistory({directory:legacyDirectory}).apply([record])[0];
  assert.equal(upgraded.pricingVersion,old.pricingVersion);
  assert.equal(upgraded.pricingContext.evidence,null,'A snapshot without evidence cannot inherit the new catalog source');
  assert.equal(upgraded.pricingContext.historicalContextUnavailable,true);
});
