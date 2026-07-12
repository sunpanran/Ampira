# Chrome Web Store Privacy Practices

## Single purpose

把用户选择的 Chrome 书签与资讯来源整理成可搜索的新标签页信息看板。

## Permission justifications

- `bookmarks`: Read the user-selected bookmark tree and build dashboard sections. Ampira never calls bookmark create, update, move, or remove methods. Chrome displays “Read and change your bookmarks” because the API has no read-only permission.
- `storage`: Store synchronized preferences, local content state, and user-entered API credentials that remain in the current Chrome profile.
- `alarms`: Wake the Manifest V3 service worker every 15 minutes to check whether authorized sources are due for refresh.
- Optional `favicon`: After an explicit user action, use Chrome’s built-in Favicon API to display site icons for bookmark and page URLs already shown by Ampira. This does not grant tab or browsing-history access, and Ampira does not send those URLs to a third-party icon service.
- Optional website origins: Fetch public feeds and article text, and read public cover-image metadata from exact inspiration origins selected by the user; connect to the user-configured AI provider or optional Brave Search API. Origins are requested at runtime after a user gesture.

## Data disclosures

- Website content: selected public Feed and article content, plus public cover metadata and image URLs from authorized inspiration pages. The built-in public-Feed supplement is enabled by default, can be disabled in Settings, and adds public news alongside bookmark sources only after the user grants each exact source origin.
- Web browsing activity: bookmark titles/URLs, article URLs used as AI context, and explicit reading state; never full browser history. Depending on the feature path and extension version, an AI-context URL can be the stored source URL or a normalized/minimized form, and can still contain path or query information.
- Authentication information: user-entered API credentials are stored only in extension-local storage and never synchronized or sent to the developer. Each key is sent directly to the provider selected by the user solely to authenticate that provider request.
- User-generated content: explicit AI search questions and source preferences.
- Synchronized settings: some non-credential settings use Chrome Sync and can be copied by Chrome to the user's other signed-in Chrome installations when Sync is enabled.
- Remote images: inspiration cards prefer the image declared by an authorized original page and use Brave Image Search only as an optional fallback. Displaying an image in a dashboard card or extracted article makes a direct request to the image host. Ampira does not proxy that request; the host receives ordinary network information needed to serve the image.

## Certifications

- Data is used only for the extension’s user-facing single purpose.
- Data is not sold, used for creditworthiness, advertising, or unrelated personalization.
- Data is not transferred to the developer.
- AI content transfers occur only after prominent in-product disclosure and consent. Brave image queries occur only after the user enables and configures that feature.
- The developer cannot access handled user data because there is no developer-operated backend.
- The use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.
