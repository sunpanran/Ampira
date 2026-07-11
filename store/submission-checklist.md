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
- [ ] Open `chrome://newtab` and complete the four onboarding steps.
- [ ] Confirm the install disclosure and Bookmark permission warning match the listing.
- [ ] Grant one exact source origin and verify Feed refresh; revoke it and verify bookmark-only fallback.
- [ ] Restart Chrome, confirm the dashboard cache renders immediately, and confirm saved API keys are not shown in full.
- [ ] Test a provider with a non-production key, then remove the key and clear the test data.
- [ ] Verify no horizontal overflow at 1280×800, 1440×1000, and a narrow desktop window.

## Package and listing

- [ ] On PowerShell 7 with Node.js 20+, set `REQUIRED_SUPPORT_URL` to the exact real endpoint, then run `.\scripts\verify-extension.ps1 -Package`.
- [ ] Upload the manifest-versioned ZIP printed by the script and retain its `.zip.sha256` and `.manifest.json` sidecars with the release record.
- [ ] Use the localized copy in `store/listing/`.
- [ ] Upload `store/assets/01-dashboard.png`, `02-permissions.png`, `03-ai-settings.png`, and `ampira-promo-440x280.png`.
- [ ] Copy the single-purpose, permission, and data-use answers from `store/privacy-practices.md`.
- [ ] Include `store/reviewer-notes.md` in the reviewer instructions.
- [ ] Confirm there are no in-app purchases, mature content, analytics, ads, or remote code to disclose.
- [ ] Confirm the package manifest records the expected `GITHUB_SHA` when built in CI and that its ZIP SHA-256 matches the `.zip.sha256` sidecar.

## Rollout

- [ ] Submit the same item as Private to trusted testers.
- [ ] Resolve review or tester findings and increment the manifest version for every new ZIP.
- [ ] Switch the reviewed item to Public; do not create a duplicate production listing.
