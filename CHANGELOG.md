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
- Add real upstream CLI contract checks and clean-install/tarball HTTP/MCP smoke tests; expand CI to Node 22/24/26, macOS, UI and motion checks.

Configuration changes and rollback steps: [Upgrading](docs/UPGRADING.md). Source verification boundaries: [Source support](docs/SOURCE_SUPPORT.md).
