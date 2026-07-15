# Repository Guidelines

## Project Structure

Ampira is a local-first Manifest V3 Chrome new-tab extension. `manifest.json` is the package root, `dashboard.html` is the single-page shell, and `extension/service-worker.mjs` is the thin Chrome event-registration and runtime-composition entry point.

- `assets/dashboard.css` is the stylesheet entry point. It imports the fixed cascade in `assets/styles/`; `assets/extension.css` contains extension-only onboarding and permission surfaces.
- `assets/client/` contains browser ESM controllers, views, presenters, state, message clients, and UI primitives. Locale modules in `assets/client/locales/` must stay aligned across Simplified Chinese, Traditional Chinese, and English.
- `extension/runtime/` owns message routing and Chrome-facing workflows for permissions, refresh, AI, Reader, settings, weather, maintenance, and cache access.
- `extension/core/` contains reusable domain logic and adapters for bookmarks, feeds, Reader parsing, network policy, IndexedDB, settings, credentials, quotas, and synchronization.
- `tests/extension.mjs` is the unified test entry; focused behavior, security, and architecture checks live in `tests/suites/`.
- `_locales/` contains Chrome manifest localization. `docs/` is the GitHub Pages privacy, support, and data-deletion site. `store/` contains listing copy, disclosures, reviewer notes, and intentional listing assets.
- `scripts/verify-extension.ps1` is the main validation entry. `scripts/package-extension.ps1` creates deterministic, versioned release artifacts from an explicit allowlist.

Legacy `dashboard-cache/` may contain user data from the removed Node edition. Never read, migrate, delete, publish, or package it unless the user explicitly asks.

## Development Commands

PowerShell 7 and Node.js 20 or newer are required for repository verification. There is no package manifest, dependency install, build step, local server, or Node runtime in the shipped extension.

- `.\scripts\verify-extension.ps1` runs the unified test suite, syntax-checks every extension module, validates local imports and HTML assets, and checks manifest, localization, documentation, and security constraints.
- `node tests\extension.mjs` runs the automated extension tests directly.
- `node --check extension\service-worker.mjs` checks the service-worker entry point.
- `Get-ChildItem extension,assets\client -Recurse -File -Filter *.mjs | ForEach-Object { node --check $_.FullName }` checks all browser modules.
- `$env:REQUIRED_SUPPORT_URL = "https://github.com/sunpanran/Ampira/issues"; .\scripts\verify-extension.ps1 -Package` validates and creates `dist/ampira-<manifest-version>.zip`, its SHA-256 sidecar, and its release manifest.
- Load the repository root from `chrome://extensions` for manual extension QA.

Do not hard-code a release version in documentation or automation. `manifest.json` is the version source of truth.

## Architecture and Coding Style

Use 2-space indentation in HTML, CSS, JavaScript, JSON, and Markdown examples. Keep JavaScript as native ESM. Use `camelCase` for functions and locals, `UPPER_SNAKE_CASE` for constants, and kebab-case for CSS custom properties.

Keep `extension/service-worker.mjs` declarative and small. Put Chrome-facing orchestration and message handling in `extension/runtime/`; keep deterministic parsing, normalization, selection, and policy logic in `extension/core/`. UI code should call runtime capabilities through the existing client ports and message contracts instead of reaching across layers.

Keep Chrome messages in the envelope `{ type, requestId, payload? }` and return discriminated success/error responses. Preserve request correlation, stale-request protection, permission epochs, and refresh-generation invalidation when changing asynchronous workflows. Route durable setting changes through the existing settings store/workflow, and do not bypass cache metadata or permission policies.

Keep remote data inert: never use `eval`, `new Function`, remotely hosted scripts, non-literal dynamic imports, inline event handlers, or untrusted `innerHTML`/HTML sinks. Render remote text through `textContent` or structured DOM nodes. Keep all shipped imports local and statically reviewable.

## UI Direction

Follow `ui-design-system.md` and preserve the high-density information-terminal style, semantic surfaces, restrained borders, single grid texture, floating desktop navigation, mobile bottom navigation, three locales, and existing `1120px`, `820px`, and `520px` breakpoints. Reuse tokens and primitives from `assets/styles/tokens.css`, `assets/styles/primitives.css`, and `assets/client/ui-primitives.mjs` before adding one-off controls.

Do not return to decorative card-heavy layouts, broad gradients, oversized marketing sections, one-note palettes, or remote fonts. Preserve dark and light themes, keyboard focus, reduced-motion behavior, and compact information density. New user-facing strings must be added consistently to all three client locales and, when relevant, all three Chrome `_locales/` files.

Do not use `scrollbar-gutter: stable` on floating selects, menus, or popover lists. It leaves a false right-side inset when the list is too short to scroll. Keep short-list padding visually symmetric and let scrollbars consume space only when content actually overflows.

The settings “Browser” page must explain that the new-tab override is controlled by extension installation state; never add a fake writable toggle. Internal search must remain clearly labeled as Ampira content search, not general web search.

## Permissions, Privacy, and Storage

Required permissions stay limited to `activeTab`, `bookmarks`, `storage`, and `alarms`. `activeTab` is approved only for the user-initiated toolbar Read later capture: after the user clicks the Ampira action, read only the invoked tab's title and URL, then let access expire on navigation or tab close. Do not use it for passive tab monitoring, page-content access, or background inspection of other tabs. Bookmark access is read-only. The optional `favicon` permission may be requested only from a user gesture to render Chrome-provided icons for URLs already present in Ampira; do not replace it with a third-party favicon service.

Do not expand the approved `activeTab` use or add `tabs`, `history`, `scripting`, `webRequest`, `management`, `unlimitedStorage`, content scripts, or required broad host access without explicit product and policy review. Optional website access must be requested from a user gesture, narrowed to exact origins, and rechecked at the point of use. Reject insecure non-local HTTP; localhost and `127.0.0.1` are the only intended HTTP development exceptions.

Never log, test with, screenshot, or package real API keys, private bookmarks, Chrome profile data, or runtime cache contents. API keys must remain in `chrome.storage.local`, outside Chrome Sync and public settings responses. Feed data, summaries, reading state, and other caches belong in the existing IndexedDB/storage abstractions; preserve quota and pruning behavior.

## Testing and QA

For every code or content change, run `.\scripts\verify-extension.ps1`. At minimum, the unified test and syntax checks must pass. Add focused coverage in `tests/suites/` for changed policy, storage, permission, parser, runtime, or UI-model behavior, then register new suites through `tests/extension.mjs`.

For UI changes, load the unpacked extension or use a safe local preview. Verify dark and light themes at 1280×800, 1440×1000, and a narrow mobile-sized window; confirm zero horizontal overflow, keyboard focus, reduced motion, loading/empty/error states, and no console errors. Record only intentional, privacy-safe screenshots in `output/playwright/`.

Update `design-qa.md` when UI, permissions, storage, API behavior, store materials, packaging, or verification changes materially. Do not claim manual Chrome QA that was not actually performed.

## Store Release

Before release, set the real public HTTPS `REQUIRED_SUPPORT_URL` and run `.\scripts\verify-extension.ps1 -Package`. Audit the generated ZIP, SHA-256 sidecar, and release manifest for secrets, local paths, remote code, unexpected files, and a root-level `manifest.json`. Do not hand-edit generated artifacts in `dist/`.

Keep the three-language listing copy, privacy disclosures, permission justifications, reviewer instructions, documentation, and actual behavior consistent. Publish the `docs/` privacy, support, and data-deletion pages before submission. Use the same Chrome Web Store item for private testing and public release; do not create a duplicate production listing.
