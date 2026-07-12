# Reviewer notes

1. Installing the extension replaces `chrome://newtab` with `dashboard.html`.
2. The four-step onboarding explains the New Tab override, local bookmark handling, optional Chrome-provided website icons, optional website-origin permissions, and that AI is optional. The detailed AI data-transfer disclosure and affirmative consent control appear in Settings → AI before an AI key can be saved, tested, or used.
3. Core dashboard use requires only the `bookmarks`, `storage`, and `alarms` permissions. The extension only calls bookmark read methods. The optional `favicon` permission is requested from onboarding or Settings → Browser and can be removed there; without it, Ampira uses its packaged fallback icon.
4. To test Feed fetching, complete onboarding, open Settings → Browser, and grant one or more listed origins. Declining leaves bookmark cards usable.
5. To test inspiration images without Brave, grant an inspiration-site origin under Settings → Browser and open a new tab; the card reads only inert public page metadata and prefers the original page image. If that page declares no usable image, optionally enable Brave Image Search, grant `api.search.brave.com`, and use a non-production test key to verify the fallback. Revoking the inspiration origin stops original-page reads while leaving the bookmark usable.
6. AI is optional. To test it, open Settings → AI, review and affirmatively accept the disclosure, grant the configured provider origin, enter a non-production test key, save, and run the connection test. The key is sent directly to that provider to authenticate the request and never to an Ampira backend. Remove the key afterward.
7. The extension contains no content scripts, remote JavaScript, `eval`, tracking, advertising, payment flow, or developer backend.
8. The in-app reader fetches public HTML only after exact-origin permission, then renders inert structured text and images. Videos remain explicit source links; no remote iframe or player is embedded.
9. Incognito use is disabled. General web search is not provided; the top search field filters Ampira content only.
