# Repository Guidelines

## Project Structure

This repository is a Manifest V3 Chrome new-tab extension. `manifest.json` is the package root. `dashboard.html` is the single-page shell; `assets/dashboard.css` is the established visual system, `assets/extension.css` contains extension-only onboarding and permission surfaces, and `assets/client/*.mjs` contains browser ESM UI modules.

`extension/service-worker.mjs` owns extension messages, Chrome Bookmarks access, alarms, refresh state, optional-origin checks, AI calls, and cache orchestration. `extension/core/` contains browser-only bookmark mapping, RSS/Atom/JSON Feed parsing, IndexedDB storage, and extension-local credential storage. `_locales/` contains Chrome manifest localization.

`docs/` is the GitHub Pages privacy/support site. `store/` contains listing copy, privacy answers, reviewer notes, and intentional store assets. `scripts/package-extension.ps1` creates the upload ZIP from an explicit allowlist. `tests/extension.mjs` is the automated extension test.

Legacy `dashboard-cache/` may contain user data from the removed Node edition. Never read, migrate, delete, publish, or package it unless the user explicitly asks.

## Development Commands

- `node tests\extension.mjs` runs manifest, localization, parser, permission-shape, cache, credential-storage, and remote-code tests.
- `node --check extension\service-worker.mjs` validates the service worker.
- `Get-ChildItem extension\core\*.mjs,assets\client\*.mjs | ForEach-Object { node --check $_.FullName }` validates browser modules.
- `.\scripts\package-extension.ps1` creates `dist/ampira-26.1.5.zip` with `manifest.json` at the ZIP root.
- Load the repository root from `chrome://extensions` for manual extension QA.

There is no package manifest, dependency install, build step, local server, or Node runtime in the shipped extension.

## Coding Style

Use 2-space indentation in HTML, CSS, JavaScript, JSON, and Markdown examples. Keep JavaScript as ESM. Use `camelCase` for functions and locals, `UPPER_SNAKE_CASE` for constants, and kebab-case for CSS custom properties.

Keep remote data inert: never use `eval`, `new Function`, remotely hosted scripts, inline event handlers, or untrusted `innerHTML`. Render remote text through `textContent` or structured DOM nodes. Keep Chrome messages in the envelope `{ type, requestId, payload? }` and return discriminated success/error responses.

## UI Direction

Preserve the high-density information-terminal style, semantic surfaces, restrained borders, single grid texture, floating desktop navigation, mobile bottom navigation, three locales, and existing breakpoints. Do not return to decorative card-heavy layouts, broad gradients, oversized marketing sections, or one-note palettes.

The settings “Browser” page must explain that the new-tab override is controlled by extension installation state; never add a fake writable toggle. Internal search must remain clearly labeled as Ampira content search, not general web search.

## Permissions and Security

Required permissions stay limited to `bookmarks`, `storage`, and `alarms`. The optional `favicon` permission may be requested only from a user gesture to render Chrome-provided icons for URLs already present in Ampira; do not replace it with a third-party favicon service. Do not add `tabs`, `history`, `scripting`, `webRequest`, `management`, `unlimitedStorage`, content scripts, or required broad host access without explicit product and policy review.

Optional website access must be requested from a user gesture and narrowed to exact origins. Reject insecure non-local HTTP. Never log, test with, screenshot, or package real API keys, private bookmarks, Chrome profile data, or runtime cache contents. API keys must stay in `chrome.storage.local` and must never enter Chrome Sync or public settings responses.

## Testing and QA

For every change, run the extension test and syntax checks. For UI changes, load the unpacked extension or use a safe local preview, verify 1280×800, 1440×1000, and narrow-window layouts, confirm zero horizontal overflow, inspect console errors, and record intentional screenshots in `output/playwright/`.

Before release, rebuild the ZIP and audit it for secrets, local paths, remote code, and non-allowlisted files. Update `design-qa.md` when UI, permissions, storage, API behavior, store materials, packaging, or verification changes materially.

## Store Release

Keep listing copy, privacy disclosures, permission justifications, reviewer instructions, and actual behavior consistent. Publish the `docs/` privacy/support pages before submission. Use the same Chrome Web Store item for private testing and public release; do not create a duplicate production listing.
