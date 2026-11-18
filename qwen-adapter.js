'use strict';
const { sources } = require('./lib/log-sources');
const { recordsToDaily } = require('./lib/request-record');
module.exports = {
  getQwenDaily: (force = false) => recordsToDaily(sources.qwen.getRecords(force)),
  getUsageRecords: (force = false) => sources.qwen.getRecords(force),
  getDiagnostics: sources.qwen.getDiagnostics
};
