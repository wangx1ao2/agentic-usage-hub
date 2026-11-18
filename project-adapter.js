'use strict';
const { canonicalizeProject, projectsFromRecords } = require('./lib/project-records');
function getProjectAttributionList() {
  const service = require('./lib/usage-service');
  return service.buildDashboardData().projects;
}
module.exports = { getProjectAttributionList, canonicalizeProject, projectsFromRecords };
