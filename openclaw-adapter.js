'use strict';
const { sources } = require('./lib/log-sources');
const { recordsToDaily } = require('./lib/request-record');
function getUsageRecords(force = false) { return [...sources.openclaw.getRecords(force), ...sources.reasonix.getRecords(force)]; }
module.exports = {
  getOpenClawAndReasonixDaily: (force = false) => recordsToDaily(getUsageRecords(force)), getUsageRecords,
  getDiagnostics: () => [sources.openclaw.getDiagnostics(), sources.reasonix.getDiagnostics()]
};
