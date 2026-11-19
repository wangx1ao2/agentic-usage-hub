# Changelog

## 1.1.0-rc.1 — candidate under verification

This source version has not yet been published to npm. See [verification progress](https://github.com/wangx1ao2/agentic-usage-hub/blob/codex/stable-release-prep/docs/STABLE_UPGRADE_PROGRESS.md).

- Consolidate the existing request ledger, background indexes, source diagnostics, project drilldown, pricing snapshots, exports, Codex live monitoring and business API observations into versioned source.
- Upgrade ccusage to 20.0.51 and Chart.js to 4.6.1; synchronize the browser asset and remove stale lockfile metadata/dependencies.
- Resolve ccusage through Node's module resolver, fixing dashboard failures when npm hoists dependencies during tarball/npx installs.
- Require explicit opt-in for online account quota reads, independent of business project paths, while retaining saved observations.
- Make auto-review rate assumptions configurable and leave costs unknown by default; preserve first-index price history and invalidate caches on configuration changes.
- Negotiate supported MCP handshake versions through 2025-11-25 and dispose background work when stdin closes.
- Remove fixed initial dates, improve source recovery guidance and display unpriced model rates as unknown.
- Retain business usage from symlinked workspaces on macOS/Windows; preserve reported zero costs and split cache-write token counts.
- Distinguish Claude request/message identities and disclose requestless gateway assumptions; retain original reviewer estimates and their context across configuration changes.
- Correct Gemini 2.5 rates; share per-model context, service-tier and cache-write rules between request pricing and historical recalculation. Preserve captured amounts across reference expiry and replay older snapshots with their original arithmetic.
- Save price evidence and policies in catalog snapshots; distinguish checked current/historical references, expired prices, unverifiable old references, assumptions and provider-required models. Preserve old captures when a price is no longer publicly verifiable.
- Add audited Qwen regional CNY references with Beijing as default, per-request input bands, cache/reasoning mode gaps and separate dated-snapshot promotions; preserve unknown components and original captures across FX changes.
- Share repeated evidence in indexes and capture snapshots to avoid large per-request duplication; rebuild corrupt derived references while preserving corrupt durable history for recovery.
- Remove hard-coded reviewer model labels and mark partial totals throughout Today, model families and subscription comparisons; exclude incomplete intervals from full-allowance dollar estimates.
- Audit the remaining legacy references; distinguish Gemini generation-specific batch cache discounts and expiry dates, and use actual Claude response speed/geography for supported fast/US pricing.
- Update Business/Team subscription names, monthly seat references and official links; preserve the old Team key and custom zero fees/budgets without calculating an invalid ratio.
- Add real upstream CLI contract checks and clean-install/tarball HTTP/MCP smoke tests; expand CI to Node 22/24/26, macOS, UI and motion checks.

Configuration changes and rollback steps: [Upgrading](docs/UPGRADING.md). Source verification boundaries: [Source support](docs/SOURCE_SUPPORT.md).
