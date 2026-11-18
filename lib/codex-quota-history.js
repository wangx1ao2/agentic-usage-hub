'use strict';

const { toDateStr } = require('./date');
const QUOTA_TIMELINE_VERSION = 4;
const round = value => +value.toFixed(6);
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);

function dayStart(date) {
  return new Date(`${date}T00:00:00`).getTime();
}

function buildQuotaHistory(events, snapshots) {
  const ordered = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
  const groups = [];
  const exactResets = new Map();
  const lastObservation = new Map();
  for (const snapshot of ordered) if (snapshot.usedPercent > 0) lastObservation.set(snapshot.resetsAt, snapshot.timestamp);
  const windowDuration = 5 * 60 * 60_000;
  const resetTolerance = 5 * 60_000;
  const zeroSnapshots = ordered.filter(snapshot => snapshot.usedPercent === 0);
  const initializationCache = new Map();
  function initializationFor(reset, before) {
    if (!initializationCache.has(reset)) {
      initializationCache.set(reset, zeroSnapshots.filter(snapshot => Math.abs(snapshot.resetsAt - reset) <= resetTolerance
        && Math.abs(snapshot.timestamp - (reset - windowDuration)) <= resetTolerance)
        .sort((a, b) => Math.abs(a.resetsAt - reset) - Math.abs(b.resetsAt - reset)));
    }
    return initializationCache.get(reset).find(snapshot => snapshot.timestamp <= before);
  }
  function findGroup(reset, snapshot = null) {
    if (exactResets.has(reset)) return exactResets.get(reset);
    const candidates = [];
    const inferredStart = reset - windowDuration;
    for (const group of groups) {
      const nearbyReset = Math.abs(group.resetsAt - reset) <= resetTolerance;
      // Some clients keep advancing resets_at while the same counter is
      // active. A fixed reset-time tolerance splits that into tiny windows.
      // Wider drift can only match a snapshot inside the existing window;
      // it must never bridge its expiration into a fresh five-hour period.
      const activeCounter = snapshot && snapshot.timestamp >= group.startsAt - resetTolerance
        && snapshot.timestamp <= group.resetsAt + 60_000
        && inferredStart < group.resetsAt && reset > group.startsAt;
      if (!nearbyReset && !activeCounter) continue;
      if (snapshot?.planType && group.planType && snapshot.planType !== group.planType) continue;
      if (snapshot) {
        const initialization = initializationFor(reset, snapshot.timestamp);
        const counterRestarted = (!!initialization && group.maxUsedPercent > 5)
          || group.maxUsedPercent - snapshot.usedPercent >= 10;
        const previous = group.snapshots.at(-1);
        // A lower counter alone can be a delayed parallel-client snapshot.
        // A real reset also starts at the observation time, after the last
        // observation of the previous counter. Do not backdate that reset.
        const transition = initialization || snapshot;
        const startsNow = Math.abs(transition.timestamp - inferredStart) <= resetTolerance
          && inferredStart >= previous.timestamp - 30_000;
        const scheduledRollover = inferredStart >= group.resetsAt - resetTolerance;
        // If the previous counter keeps reporting afterward, this low sample
        // is a parallel counter, not evidence that the previous one ended.
        const previousCounterEnded = group.lastObservationAt <= transition.timestamp + 60_000;
        if (startsNow && (scheduledRollover || (counterRestarted && previousCounterEnded))) continue;
      }
      candidates.push(group);
    }
    return candidates.sort((a, b) => Math.abs(a.resetsAt - reset) - Math.abs(b.resetsAt - reset))[0] || null;
  }
  for (const snapshot of ordered) {
    // While idle, account reads can return 0% with resetsAt = now + 5h.
    // These moving placeholders neither start a consumed window nor anchor
    // later nonzero snapshots to the time polling happened to begin.
    if (snapshot.usedPercent === 0) continue;
    let group = findGroup(snapshot.resetsAt, snapshot);
    if (!group) {
      group = { id: String(snapshot.resetsAt), startsAt: snapshot.resetsAt - windowDuration,
        resetsAt: snapshot.resetsAt, snapshots: [], events: [], reached100At: null, reached100Percent: null,
        maxUsedPercent: 0, lastObservationAt: 0, planType: snapshot.planType || null };
      groups.push(group);
    }
    exactResets.set(snapshot.resetsAt, group);
    group.snapshots.push(snapshot);
    group.lastObservationAt = Math.max(group.lastObservationAt, lastObservation.get(snapshot.resetsAt));
    group.maxUsedPercent = Math.max(group.maxUsedPercent, snapshot.usedPercent);
    group.planType ||= snapshot.planType || null;
    if (!group.reached100At && snapshot.usedPercent >= 100) {
      group.reached100At = snapshot.timestamp;
      group.reached100Percent = snapshot.usedPercent;
      group.completionSource = snapshot.source || 'session-log';
      group.confirmedAt = snapshot.confirmedAt || null;
    }
  }

  // A real request can still round down to 0%. Its explicit quota marker is
  // evidence of a window; a standalone zero-percent poll is not.
  for (const event of events) {
    if (!event.quotaReset || findGroup(event.quotaReset) || event.timestamp < event.quotaReset - windowDuration
      || event.timestamp > event.quotaReset + 60_000) continue;
    const sample = zeroSnapshots.find(snapshot => snapshot.resetsAt === event.quotaReset
      && Math.abs(snapshot.timestamp - event.timestamp) <= 60_000);
    if (!sample) continue;
    const group = { id: String(sample.resetsAt), startsAt: sample.resetsAt - windowDuration, resetsAt: sample.resetsAt,
      snapshots: [], events: [], reached100At: null, reached100Percent: null, maxUsedPercent: 0,
      lastObservationAt: sample.timestamp, planType: sample.planType || null };
    groups.push(group);
    exactResets.set(sample.resetsAt, group);
  }
  // Only attach initialization baselines after real windows have been found.
  // Preserve the reset time established by usage, including after an idle gap.
  for (const snapshot of zeroSnapshots) {
    const group = findGroup(snapshot.resetsAt);
    if (group && snapshot.timestamp >= group.startsAt - resetTolerance && snapshot.timestamp <= group.resetsAt + 60_000
      && (!snapshot.planType || !group.planType || snapshot.planType === group.planType)) group.snapshots.push(snapshot);
  }
  for (const group of groups) group.snapshots.sort((a, b) => a.timestamp - b.timestamp);

  const days = new Map();
  function ensureDay(date) {
    if (!days.has(date)) days.set(date, { date, usedPercent: 0, quotaUnits: null,
      quotaObserved: false, usageIsLowerBound: false, apiEquivalentUSD: 0,
      quotaApiEquivalentUSD: 0, comparableApiEquivalentUSD: 0, comparableUsedPercent: 0,
      averagePer100USD: null, completedWindowCount: 0, unpricedRequests: 0,
      unknownSpeedRequests: 0, windows: [] });
    return days.get(date);
  }
  for (const snapshot of zeroSnapshots) ensureDay(toDateStr(snapshot.timestamp)).quotaObserved = true;
  const unassignedSubscriptionEvents = [];
  for (const event of events) {
    const day = ensureDay(event.date || toDateStr(event.timestamp));
    day.apiEquivalentUSD += event.cost;
    day.unpricedRequests += Number(event.unpriced);
    day.unknownSpeedRequests += Number(!event.speedKnown);
    const group = event.quotaReset && event.timestamp <= event.quotaReset + 60_000 ? findGroup(event.quotaReset) : null;
    if (group) group.events.push(event);
    else if (!event.quotaReset && event.pricingContext?.billingMode === 'chatgpt-subscription') unassignedSubscriptionEvents.push(event);
  }
  for (const event of unassignedSubscriptionEvents) {
    // Ephemeral bridge requests have no rollout quotaReset. Match the active
    // account interval, using the same most-recent start as the display when
    // an early reset overlaps its predecessor. Never include paid API calls.
    const group = groups.filter(row => event.timestamp >= row.startsAt && event.timestamp < row.resetsAt
      && (row.maxUsedPercent > 0 || row.events.length))
      .sort((a, b) => b.startsAt - a.startsAt)[0];
    if (group) group.events.push(event);
  }

  const publicWindows = [];
  for (const group of groups) {
    group.events.sort((a, b) => a.timestamp - b.timestamp);
    const first = group.snapshots[0];
    const last = group.snapshots.at(-1);
    const startCovered = first.timestamp <= group.startsAt + 5 * 60_000 && first.usedPercent <= 5;
    const at100Rows = group.reached100At
      ? group.events.filter(event => event.timestamp >= group.startsAt && event.timestamp <= group.reached100At) : [];
    const apiEquivalentAt100 = group.reached100At && at100Rows.some(event => !event.unpriced && event.cost > 0)
      ? round(sum(at100Rows, 'cost')) : null;
    const maxUsedPercent = Math.max(...group.snapshots.map(snapshot => snapshot.usedPercent));
    const dates = new Set([...group.snapshots.map(snapshot => toDateStr(snapshot.timestamp)),
      ...group.events.map(event => event.date || toDateStr(event.timestamp))]);
    const slices = [];
    let previousMax = 0;
    let hasPreviousObservation = false;

    for (const date of [...dates].sort()) {
      const day = ensureDay(date);
      const midnight = dayStart(date);
      const observations = group.snapshots.filter(snapshot => toDateStr(snapshot.timestamp) === date);
      const rows = group.events.filter(event => (event.date || toDateStr(event.timestamp)) === date);
      const startsToday = toDateStr(group.startsAt) === date;
      const dayFirst = observations[0];
      const dayLast = observations.at(-1);
      const baselineKnown = hasPreviousObservation || startsToday;
      const baseline = baselineKnown ? previousMax : (dayFirst?.usedPercent || 0);
      const endPercent = Math.max(previousMax, ...observations.map(snapshot => snapshot.usedPercent));
      const consumed = observations.length ? Math.max(0, endPercent - baseline) : 0;
      const lowerBound = observations.length > 0 && !baselineKnown && baseline > 0;

      // A counter can report old values while parallel requests finish. Use
      // its monotone maximum; decreases never represent fresh quota usage.
      let comparableBaseline = baseline;
      let comparableStart = midnight - 1;
      if (!hasPreviousObservation && !(startsToday && startCovered)) {
        comparableBaseline = dayFirst?.usedPercent || baseline;
        comparableStart = dayFirst?.timestamp || midnight;
      }
      const comparableEnd = group.reached100At && group.reached100At <= (dayLast?.timestamp || 0)
        ? Math.min(endPercent, group.reached100Percent) : endPercent;
      const comparablePercent = observations.length ? Math.max(0, comparableEnd - comparableBaseline) : 0;
      const cutoff = Math.min(dayLast?.timestamp || -Infinity, group.reached100At || Infinity);
      const comparableRows = rows.filter(event => event.timestamp > comparableStart && event.timestamp <= cutoff);
      const comparableCostKnown = comparablePercent > 0 && comparableRows.some(event => !event.unpriced && event.cost > 0);
      const comparableUSD = comparableCostKnown ? sum(comparableRows, 'cost') : 0;
      const completedToday = group.reached100At && toDateStr(group.reached100At) === date;
      const projected = comparableCostKnown ? comparableUSD * 100 / comparablePercent : null;
      const recordedEstimate = completedToday && startCovered && apiEquivalentAt100 !== null;
      const subscriptionRows = rows.filter(event => event.pricingContext?.billingMode === 'chatgpt-subscription');
      const slice = { windowId: group.id, startsAt: group.startsAt, resetsAt: group.resetsAt,
        usedPercentStart: round(baseline), usedPercentEnd: round(endPercent), usedPercent: round(consumed),
        usageIsLowerBound: lowerBound, quotaObserved: observations.length > 0,
        comparisonUsedPercent: round(comparablePercent), comparisonApiEquivalentUSD: round(comparableUSD),
        apiEquivalentUSD: round(sum(rows, 'cost')), apiEquivalentAt100: completedToday ? apiEquivalentAt100 : null,
        estimatedPer100USD: recordedEstimate ? round(apiEquivalentAt100 * 100 / group.reached100Percent) : (projected === null ? null : round(projected)),
        estimateBasis: completedToday ? (recordedEstimate ? (group.completionSource === 'user-confirmed' ? 'confirmed100' : 'recorded100') : projected === null ? 'unavailable' : 'linear-incomplete100')
          : projected === null ? 'unavailable' : 'linear',
        estimateLowSample: projected !== null && !recordedEstimate && comparablePercent < 10,
        reached100At: group.completionSource === 'user-confirmed' ? null : group.reached100At,
        completionEffectiveAt: group.reached100At, confirmationRecordedAt: group.confirmedAt || null,
        completionSource: group.completionSource || null, startCovered,
        subscriptionApiRequests: subscriptionRows.length, subscriptionApiEquivalentUSD: round(sum(subscriptionRows, 'cost')),
        unpricedRequests: rows.filter(event => event.unpriced).length,
        latestObservedAt: dayLast?.observedAt || null };
      // Zero-percent initialization snapshots with no requests add no useful
      // row; their reset IDs are still kept for matching real requests.
      if (consumed > 0 || rows.length > 0) {
        day.windows.push(slice);
        slices.push({ date, ...slice });
      }
      day.quotaObserved ||= observations.length > 0;
      day.usedPercent += consumed;
      day.usageIsLowerBound ||= lowerBound;
      day.quotaApiEquivalentUSD += sum(rows, 'cost');
      day.comparableApiEquivalentUSD += comparableUSD;
      if (comparableCostKnown) day.comparableUsedPercent += comparablePercent;
      if (completedToday) day.completedWindowCount++;
      if (observations.length) { previousMax = endPercent; hasPreviousObservation = true; }
    }
    publicWindows.push({ id: group.id, startsAt: group.startsAt, resetsAt: group.resetsAt,
      firstObservedAt: first.observedAt, latestObservedAt: last.observedAt, maxUsedPercent,
      reached100At: group.completionSource === 'user-confirmed' ? null : group.reached100At,
      completionEffectiveAt: group.reached100At, confirmationRecordedAt: group.confirmedAt || null,
      completed: !!group.reached100At, reached100Percent: group.reached100Percent, apiEquivalentUSD: round(sum(group.events, 'cost')),
      completionSource: group.completionSource || null,
      apiEquivalentAt100, startCovered, unpricedRequests: at100Rows.filter(event => event.unpriced).length,
      unknownSpeedRequests: at100Rows.filter(event => !event.speedKnown).length, days: slices });
  }
  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(day => {
    const average = day.comparableUsedPercent > 0 ? day.comparableApiEquivalentUSD * 100 / day.comparableUsedPercent : null;
    return { ...day, usedPercent: day.quotaObserved ? round(day.usedPercent) : null,
      quotaUnits: day.quotaObserved ? round(day.usedPercent / 100) : null,
      apiEquivalentUSD: round(day.apiEquivalentUSD), quotaApiEquivalentUSD: round(day.quotaApiEquivalentUSD),
      unattributedApiEquivalentUSD: round(day.apiEquivalentUSD - day.quotaApiEquivalentUSD),
      comparableApiEquivalentUSD: round(day.comparableApiEquivalentUSD), comparableUsedPercent: round(day.comparableUsedPercent),
      averagePer100USD: average === null ? null : round(average),
      estimateLowSample: average !== null && day.comparableUsedPercent < 10,
      windows: day.windows.sort((a, b) => a.startsAt - b.startsAt) };
  });
  // A new counter may start before the previous scheduled reset (for example
  // after a quota/account change). Keep that reset as provenance, but end the
  // displayed interval at the next used window's start. Empty initialization
  // counters must not truncate a real usage window.
  publicWindows.sort((a, b) => a.startsAt - b.startsAt);
  const usedWindows = publicWindows.filter(window => window.days.length > 0);
  const displayEnds = new Map();
  for (let i = 0; i < usedWindows.length; i++) {
    const window = usedWindows[i];
    displayEnds.set(window.id, Math.min(window.resetsAt, usedWindows[i + 1]?.startsAt ?? Infinity));
  }
  for (const window of publicWindows) {
    window.displayEndsAt = displayEnds.get(window.id) ?? window.resetsAt;
    for (const slice of window.days) slice.displayEndsAt = window.displayEndsAt;
  }
  for (const day of daily) {
    for (const slice of day.windows) slice.displayEndsAt = displayEnds.get(slice.windowId) ?? slice.resetsAt;
  }
  return { schemaVersion: 2, timelineVersion: QUOTA_TIMELINE_VERSION, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    latest: ordered.at(-1) || null, daily, windows: publicWindows,
    completedWindows: publicWindows.filter(window => window.completed).slice(-10) };
}

module.exports = { buildQuotaHistory, QUOTA_TIMELINE_VERSION };
