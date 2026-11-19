'use strict';

// Derived file indexes intern repeated evidence without changing their public
// records. A catalog reference is shared by thousands of requests in one file.
function createEvidencePool() {
  const evidence = [], objects = new Map(), values = new Map();
  function pack(record) {
    const item = record.pricingContext?.evidence;
    if (!item || typeof item !== 'object') return record;
    let index = objects.get(item);
    if (index === undefined) {
      const key = JSON.stringify(item);
      index = values.get(key);
      if (index === undefined) { index = evidence.length; evidence.push(item); values.set(key,index); }
      objects.set(item,index);
    }
    const {evidence:_,...context} = record.pricingContext;
    return {...record,pricingContext:{...context,_pricingEvidenceRef:index}};
  }
  return {evidence,pack};
}

function restoreEvidence(record, evidence) {
  const context = record.pricingContext;
  if (!context || !Object.hasOwn(context,'_pricingEvidenceRef')) return record;
  const {_pricingEvidenceRef:index,...rest} = context;
  if (!Array.isArray(evidence) || !Number.isSafeInteger(index) || index < 0 || index >= evidence.length
    || !evidence[index] || typeof evidence[index] !== 'object' || Array.isArray(evidence[index])) throw new Error('Invalid derived pricing evidence reference');
  return {...record,pricingContext:{...rest,evidence:evidence[index]}};
}

module.exports = {createEvidencePool,restoreEvidence};
