# Changelog

## [5.1.2] - 2026-11-21

### Changed
- **Run the app on macOS** — skill instructions now document both macOS and Linux container environments. Postgres setup, dev server launch (`nohup` instead of `setsid`), screenshot paths (`/tmp` instead of `/var/tmp`), and Chromium path (`/Applications/Google Chrome.app/…` instead of `/opt/pw-browsers/chromium`) are now covered side by side so the same skill works in both contexts.
- **`gh` CLI available** — `ship-checks` now documents that `gh` 2.91.0 is installed at `/opt/homebrew/bin/gh`, removing incorrect guidance that it was absent.

## [5.1.1] - 2026-05-13

### Fixed
- TanStack Start HTTP 500 error on application startup
  - Added `getRouter()` function export required by SSR initialization
  - Pinned TanStack package versions to prevent dependency version conflicts
  - Resolves "TypeError: entries.routerEntry.getRouter is not a function"

## [5.1.0] - 2026-05-10

### Added
- Initial release with AI-powered code generation
