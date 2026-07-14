# Chrome Web Store Privacy Practices

## Single purpose

把用户选择的 Chrome 书签与资讯来源整理成可搜索的新标签页信息看板。

## Permission justifications

- `bookmarks`: Read the user-selected bookmark tree and build dashboard sections. Ampira never calls bookmark create, update, move, or remove methods. Chrome displays “Read and change your bookmarks” because the API has no read-only permission.
- `storage`: Store synchronized preferences, local content state, and user-entered API credentials that remain in the current Chrome profile.
- `alarms`: Wake the Manifest V3 service worker every 15 minutes to check whether authorized sources are due for refresh.
- Optional `favicon`: After an explicit user action, use Chrome’s built-in Favicon API to display site icons for bookmark and page URLs already shown by Ampira. This does not grant tab or browsing-history access, and Ampira does not send those URLs to a third-party icon service.
- Optional website origins: Fetch public feeds and article text, and read public cover-image metadata from exact news or inspiration origins selected by the user; connect to the user-configured AI provider or optional Brave Search API. Origins are requested at runtime after a user gesture. A Feed discovered on a different domain is recorded as pending and is not contacted unless the user separately grants that exact origin.
- Optional Open-Meteo origins: When the user submits a city in Weather mode, request only `https://geocoding-api.open-meteo.com/*` and `https://api.open-meteo.com/*`. A bundled GeoNames-derived index resolves matching Chinese county-level-or-above administrative places locally; otherwise the first Open-Meteo origin resolves user-entered city text to explicit candidates. The forecast origin receives coordinates only after the user selects one candidate and returns a three-day forecast. Ampira does not request geolocation, does not refresh weather in the background, and lets the user revoke either origin in Settings → Browser.

## Data disclosures

- Website content: selected public Feed and article content, plus public cover metadata and image URLs from authorized pages. When an authorized Feed item has no usable image, Ampira may read up to 1 MiB of inert image metadata from the same-origin article page; it does not request another origin or execute page scripts. The built-in public-Feed supplement is enabled by default, can be disabled in Settings, and adds public news alongside bookmark sources only after the user grants each exact source origin. Feed discovery results, response validators, image-coverage counts, and recent per-source success or failure diagnostics remain in the extension-local cache and are cleared with generated cache data.
- Web browsing activity: bookmark titles/URLs, article URLs used as AI context, and explicit reading state; never full browser history. Depending on the feature path and extension version, an AI-context URL can be the stored source URL or a normalized/minimized form, and can still contain path or query information.
- Authentication information: user-entered API credentials are stored only in extension-local storage and never synchronized or sent to the developer. Each key is sent directly to the provider selected by the user solely to authenticate that provider request.
- User-generated content: explicit AI search questions and source preferences.
- Location: matching Chinese administrative-place queries are resolved inside the extension from a bundled GeoNames-derived index and are not transmitted for search. Other manually entered city queries are sent directly to Open-Meteo's Geocoding API. The latitude and longitude of the user's explicitly selected result are sent directly to Open-Meteo's Forecast API. The selected display name, full administrative hierarchy, provider marker, and coordinates remain in extension-local client state, do not enter Chrome Sync, and are not available to the developer. Ampira never reads browser or device geolocation.
- Local to-dos: text, completion state, and timestamps remain in extension-local client state for the current Chrome profile. They are not synchronized, sent to a provider, or removed by ordinary cache clearing or interface-preference reset.
- Synchronized settings: some non-credential settings use Chrome Sync and can be copied by Chrome to the user's other signed-in Chrome installations when Sync is enabled.
- Remote images: news cards prefer safe Feed and authorized original-page candidates; inspiration cards prefer up to three images declared by an authorized original page and start preloading all 15 fixed daily cards, including all three reshuffle batches, immediately before first render. Brave Image Search is an optional fallback only when a news or inspiration card has no usable original image or every original fails to load; Reader images do not use Brave. Displaying or preloading an image makes a direct request to the image host. Ampira does not proxy that request; the host receives ordinary network information needed to serve the image.

## Certifications

- Data is used only for the extension’s user-facing single purpose.
- Data is not sold, used for creditworthiness, advertising, or unrelated personalization.
- Data is not transferred to the developer.
- AI content transfers occur only after prominent in-product disclosure and consent. Brave image queries occur only after the user enables and configures that feature.
- Open-Meteo city and coordinate transfers occur only after the user opens Weather mode and submits a non-local match or selects a city. Weather data is visibly attributed to Open-Meteo; bundled China location candidates are visibly attributed to GeoNames under CC BY 4.0. The applicable service terms and data licences are checked before release.
- The developer cannot access handled user data because there is no developer-operated backend.
- The use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.
