# Chrome Web Store submission checklist

## Accounts and public URLs

- [ ] Enable two-step verification on the publishing Google account.
- [ ] Create or select the single production Chrome Web Store item.
- [ ] Set the repository variable `REQUIRED_SUPPORT_URL` to the real HTTPS support endpoint, replace every support-URL marker in `docs/` with that exact URL, and confirm the link accepts reports.
- [ ] Run the release metadata check, then publish the verified `docs/` with GitHub Pages.
- [ ] Confirm the public privacy, support, and data-deletion URLs work without sign-in and that the privacy policy includes the Limited Use disclosure.

## Unpacked extension QA

- [ ] Load the repository root from `chrome://extensions` with Developer mode enabled.
- [ ] Confirm there are no manifest or service-worker errors.
- [ ] Click the Ampira toolbar icon; verify it opens the packaged dashboard without reading or capturing the current tab and without requesting `activeTab` or `tabs`.
- [ ] Open `chrome://newtab`, confirm the inspiration-folder menu lists Inspiration preset (Ampira) first, and complete the three onboarding steps with no top-level personal inspiration folder; repeat with a personal bookmark-folder option and verify switching back to the preset preserves that folder.
- [ ] Confirm the install disclosure and Bookmark permission warning match the listing.
- [ ] Enable and then remove the optional website-icon permission; verify Chrome favicons appear only while granted and missing icons fall back without console errors.
- [ ] Grant one exact source origin and verify Feed refresh; revoke it and verify bookmark-only fallback.
- [ ] Verify Settings → News reports per-source coverage and retry status; for a landing page that declares a cross-domain Feed, confirm no request reaches that domain before its separate exact-origin prompt is accepted, then revoke it and confirm cached Feed items disappear.
- [ ] Grant one exact inspiration origin and verify its original page image appears without a Brave key; revoke it and verify the card remains usable without another original-page read.
- [ ] In preset mode, verify 48 unique public HTTPS links and 24 packaged 960×600 WebP covers, no repeated cover within a daily batch, 15 unique sites and covers across the first three batches, and no preset origin or remote preview request until a Reader/AI user gesture.
- [ ] Reload the new tab and verify all 15 fixed daily inspiration cards across the three reshuffle batches begin preloading before first render, while a deliberately slow image still falls back to progressive rendering without blocking the dashboard.
- [ ] For an inspiration page with no usable image, enable Brave Image Search with a non-production key and verify Brave runs only as the fallback; remove the key afterward.
- [ ] For an authorized same-origin Feed article without a Feed image, verify one bounded metadata enrichment supplies an original image. Then use a news card with no usable image, enable Brave Image Search with a non-production key, and verify the card receives a fallback; confirm a cross-origin article metadata read is skipped and an unrelated URL cannot use the preview endpoint.
- [ ] Restart Chrome, confirm the dashboard cache renders immediately, and confirm saved API keys are not shown in full.
- [ ] Test a provider with a non-production key, then remove the key and clear the test data.
- [ ] Confirm the AI form stays locked before disclosure consent and exact-origin access, unlocks after authorization, and locks again after origin change or permission removal.
- [ ] Cycle the first efficiency card through Events → Weather → To-do and reload after each mode; confirm the mode restores and the card boundary does not change.
- [ ] In Weather, submit `慈溪`, confirm the bundled result is `慈溪市 · 宁波市 · 浙江省 · 中国` with GeoNames attribution and no geocoder request, then submit a synthetic non-China city and confirm the Open-Meteo fallback. Confirm Chrome requests only the two Open-Meteo origins, choose ambiguous candidates manually, and verify today/tomorrow/day-after rows plus the Open-Meteo attribution. Decline once, retry, then revoke each origin in Settings → Browser and confirm the weather cache is deleted without deleting the saved city.
- [ ] In Settings → Browser → Cross-device content, confirm reading queue, to-dos, and weather city all default off. Enable each with synthetic content, verify it appears in a second signed-in synced Chrome installation, update and delete individual records on the second installation, then disable each switch and confirm its Chrome Sync copy is removed while the current local copy remains. Confirm forecast responses, utility mode, full reading history, AI configuration, and API keys never enter Chrome Sync.
- [ ] In To-do, verify add/complete/restore/delete, Return-to-add, the 120-character item limit, the 50-item cap, unfinished-first order, internal scrolling, and persistence after reload and ordinary cache clearing.
- [ ] Verify no horizontal overflow at 1280×800, 1440×1000, and a narrow desktop window.

## Package and listing

- [ ] On PowerShell 7 with Node.js 20+, set `REQUIRED_SUPPORT_URL` to the exact real endpoint, then run `.\scripts\verify-extension.ps1 -Package`.
- [ ] Upload the manifest-versioned ZIP printed by the script and retain its `.zip.sha256` and `.manifest.json` sidecars with the release record.
- [ ] Use the localized copy in `store/listing/`.
- [ ] Upload `store/assets/01-dashboard.png`, `02-permissions.png`, `03-ai-settings.png`, and `ampira-promo-440x280.png`.
- [ ] Re-capture dashboard or permission screenshots if the visible website-icon state differs from the submitted assets.
- [ ] Copy the single-purpose, permission, and data-use answers from `store/privacy-practices.md`.
- [ ] Include `store/reviewer-notes.md` in the reviewer instructions.
- [ ] Confirm there are no in-app purchases, mature content, analytics, ads, or remote code to disclose.
- [ ] Confirm this release remains non-commercial, the visible Open-Meteo and GeoNames attributions are present, the bundled GeoNames extract remains covered by CC BY 4.0, and the current Open-Meteo terms remain compatible; otherwise use a commercial plan, self-hosted service, or a different provider before release.
- [ ] Confirm the package manifest records the expected `GITHUB_SHA` when built in CI and that its ZIP SHA-256 matches the `.zip.sha256` sidecar.
- [ ] Confirm the ZIP contains exactly the 24 optimized preset WebPs, stays under 4.5 MiB, and contains no PNG masters, bookmark exports, `output/`, `dashboard-cache/`, desktop paths, or private data.

## Rollout

- [ ] Submit the same item as Private to trusted testers.
- [ ] Resolve review or tester findings and increment the manifest version for every new ZIP.
- [ ] Switch the reviewed item to Public; do not create a duplicate production listing.
