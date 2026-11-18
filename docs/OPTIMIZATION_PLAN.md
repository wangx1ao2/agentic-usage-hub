# Optimization implementation and completion audit

Scope: implement **all** recommendations in the user's attached goal-objective.md,
then review the resulting implementation and fix findings. Existing working-tree
changes are the baseline and must be preserved. A passing test alone does not prove
that an item is complete. Checkboxes below require implementation and direct evidence.

## Requirements and evidence to collect

- [x] R1 Qwen: append, same-mtime growth, truncation, removal, rotation and overlapping roots do not duplicate usage.
- [x] R2 Explicit fresh/cached/write/output token semantics; Claude project cost shares the pricing calculator.
- [x] R3 Refresh reports per-source success/failure, last successful read, stale and refreshing states; UI reports partial failures.
- [x] R4 Source + model identity is preserved in records and all model rollups.
- [x] R5 Standard/flagship comparison is independent of the selected display tier.
- [x] R6 MCP validates envelopes, null, arguments, dates, ranges, enums and limits without terminating; transport tests.
- [x] R7 Unified usage records include source, model, session, project, timestamp, token components, cost and estimation provenance.
- [x] R8 Shared query/cache service sits between adapters and HTTP/MCP; HTTP import has no protocol side effects.
- [x] R9 Projects reuse request records, expose unmatched attribution, correct activity time, daily totals and request drilldown.
- [x] R10 Frontend request/state/view modules use ES Modules with stable behavior and accessibility.
- [x] R11 Source diagnostics expose paths, availability, last success, parse errors, coverage and runtime capabilities.
- [x] R12 Estimates are tagged consistently (including Antigravity); actual-only filtering and estimate proportion are available.
- [x] R13 CSV/JSON export includes filters, timezone, pricing version and cost basis; historical/current rate selection works.
- [x] R14 Scans/SQLite run in a background worker; endpoints serve snapshots and static/live requests remain responsive.
- [x] R15 Common file/cache lifecycle handles size/mtime, truncation, deletion, retries and honest freshness.
- [x] R16 Isolated fixture tests prove detail/day/source sums, idempotence, unknown-price semantics and cross-interface equality.
- [x] R17 Cold-start/append/event-loop benchmarks produce reproducible results; UI regressions are configured in CI.
- [x] R18 Startup capability probing and documented complete runtime requirements; Linux/Windows CI covers paths, CLI and appends.

## Review gates

- Targeted regression tests for every fixed defect.
- Full isolated Node suite, browser regression suite, syntax/module checks.
- Performance benchmark and request responsiveness check with a large fixture.
- Review changes for stale data represented as fresh, lost attribution, rounding,
  unsafe paths, concurrency, privacy, deployment/package assets and docs drift.
- Requirement-by-requirement audit with file/test/runtime evidence; remaining work
  stays unchecked and the goal remains active until all requirements are verified.

## Progress

- Baseline re-inspected on 2026-10-18. Existing changes match the reviewed worktree.
- Six original defects have regression coverage in `tests/optimization-regressions.test.js` and `tests/interface-consistency.test.js`.
- `lib/request-record.js`, `lib/usage-record.js`, `lib/record-reconciliation.js` and `lib/usage-aggregate.js` provide request records and conservative day/model fallbacks. Projects reuse this ledger without assumed cache ratios.
- HTTP and MCP use `lib/usage-service.js` and `lib/index-worker.js`; MCP imports no HTTP module. HTTP/MCP equality and import side effects have direct tests.
- Final verification and measurements are recorded in [OPTIMIZATION_REVIEW.md](OPTIMIZATION_REVIEW.md), including Node, browser, packaging and syntax evidence.
- Review corrected two additional issues: model-list fallback no longer invents equal shares/default models; worker stdout must stay unreferenced so completed CLI/MCP processes can exit.
- CI configuration covers Node 20/22/24 on Linux/Windows plus browser and benchmark jobs. Remote CI has not been executed by this chat.
- `npm pack --dry-run` includes all new `lib` runtime/worker modules. Syntax checks for `lib`, `bin`, and `mcp` passed. Existing working-tree changes were retained; no commit or publication was performed.

## Completion audit

All recommendations have implementation and regression evidence in the linked review.
The review documents data limitations without inventing attribution, timestamps or
official historical prices. Local checks pass; remote CI remains unobserved.
