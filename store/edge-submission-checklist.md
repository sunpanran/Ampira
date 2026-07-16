# Microsoft Edge Add-ons submission checklist

Use the shared Chrome Web Store checklist for functional, privacy, packaging, and synthetic-data checks, with these Edge-specific additions and substitutions.

## Edge compatibility QA

- [ ] Load the repository root from `edge://extensions` with Developer mode enabled and confirm there are no manifest or service-worker errors.
- [ ] Open `edge://newtab` and complete onboarding. Confirm website-origin permissions still succeed without requesting the Chrome-only `favicon` permission.
- [ ] In Settings → Browser, confirm Website icons reports that the browser is unsupported, hides the permission toggle, and consistently uses the packaged Ampira icon.
- [ ] Confirm the extension-manager action opens `edge://extensions/`.
- [ ] Enable Top search and confirm `chrome.search` uses the current Edge default provider in the same tab; then remove the permission and confirm Ampira content search returns.
- [ ] Verify toolbar capture, read-only bookmarks, alarms, exact-origin permissions, Factory reset, and browser account sync with synthetic data in two signed-in Edge installations.
- [ ] Verify the dashboard in horizontal tabs, vertical tabs, split screen, dark and light themes, and reduced-motion mode at `1280×800`, `1440×1000`, and a narrow desktop width.
- [ ] Record the known Edge limitation that the browser may retain its own icon for the overridden New Tab tab; do not claim that Ampira controls browser-shell icons.

## Listing and review

- [ ] Use the localized Microsoft Edge wording in `store/edge-listing/` and `store/edge-reviewer-notes.md`; do not submit Chrome-branded listing copy.
- [ ] Disclose the New Tab override, optional exact-origin access, browser account sync, and the Edge website-icon fallback.
- [ ] Confirm the public privacy, support, and deletion pages mention both `chrome://extensions` and `edge://extensions`.
- [ ] Upload the same verified extension ZIP only after the Edge-specific QA above passes.
