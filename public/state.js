export const state = {
  currentPricingTier: 'standard',
  currentAgentFilter: 'all',
  currentAxisMode: 'cost',
  chartDimension: 'company',
  currentDatePreset: '30d',
  startDate: '2026-05-22',
  endDate: null,
  yScaleMode: 'auto',
  isLogScale: false,
  customYMax: null,
  currentMainView: 'timeline',
  projectSearchTerm: '',
  projectAgentFilter: 'all',
  projectSortBy: 'cost',
  projectTodayOnly: false,
  expandedProjectDrawers: new Set(),
  cachedData: null,
  chartInstance: null,
  currentThemeMode: 'auto',
  dashboardRequest: null,
  requestEpoch: 0,
  lastSuccessfulFetch: 0,
  refreshInFlight: false,
  chartSeriesLimit: 8,
  chartSeriesVisibility: new Map(),
  pagination: {
    table: {
      page: 1,
      size: 25
    },
    projects: {
      page: 1,
      size: 12
    },
    gallery: {
      page: 1,
      size: 24
    }
  },
  tableSearchTerm: '',
  tableSortBy: 'date',
  galleryCatalog: null,
  galleryCatalogRequest: null,
  galleryCatalogEpoch: 0,
  galleryCatalogError: '',
  galleryFitMode: 'contain',
  expandedFamilies: new Set(['fam-openai']),
  gallerySelectedDate: 'all',
  gallerySearchQuery: '',
  selectedQuotaDate: null,
  quotaHistoryRange: '7',
  cachedPricingMatrix: null,
  actualOnly: false,
  pricingMode: 'recorded',
  pricingVersion: null
};
