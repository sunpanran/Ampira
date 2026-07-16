# Microsoft Edge Add-ons reviewer notes

Ampira replaces `edge://newtab` with its packaged `dashboard.html`. Required permissions are limited to `activeTab`, `bookmarks`, `storage`, and `alarms`. Toolbar capture reads only the title and URL of the tab on which the user explicitly clicks Ampira. Bookmark access is read-only.

Microsoft Edge does not expose the Chrome native `/_favicon/` service used by Ampira's optional `favicon` permission. Ampira detects Edge, does not request that permission during onboarding, hides the unsupported permission control, and uses its packaged icon instead. This does not affect bookmark, Feed, Reader, or website-origin permissions. Edge may also retain its own browser-shell icon for an overridden New Tab tab.

Optional website access is requested only from a user gesture and is restricted to exact origins. Optional browser search uses the supported `chrome.search` API with the user's current Edge default provider. API keys remain in `chrome.storage.local`; non-credential settings and separately opted-in reading queue, to-dos, and weather city use browser account sync. The extension contains no remote code, analytics, advertising, payment flow, content scripts, or developer backend.

For detailed functional scenarios, use `store/reviewer-notes.md`, substituting Edge browser terminology and `edge://` internal pages. Use only synthetic data and non-production credentials during review.

