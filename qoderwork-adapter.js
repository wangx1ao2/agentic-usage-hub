'use strict';
const { sources } = require('./lib/log-sources');
const { recordsToDaily } = require('./lib/request-record');
const { projectsFromRecords } = require('./lib/project-records');
function getUsageRecords(force = false) { return sources.qoderwork.getRecords(force); }
function getQoderProjectDaily() {
  return projectsFromRecords(getUsageRecords()).map(project => ({ project: project.name, path: project.primaryPath,
    tokens: project.totalTokens, cost: project.totalCost, calls: project.requestCount, lastDate: project.lastActive,
    modelBreakdowns: recordsToDaily(getUsageRecords().filter(row => row.projectPath === (project.primaryPath || null))).flatMap(day => day.modelBreakdowns) }));
}
module.exports = { getQoderDaily: (force = false) => recordsToDaily(getUsageRecords(force)),
  getUsageRecords, getQoderProjectDaily, getDiagnostics: sources.qoderwork.getDiagnostics };
