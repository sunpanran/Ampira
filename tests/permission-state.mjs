import assert from "node:assert/strict";
import {
  buildPermissionRows,
  filterFeedItemsBySources,
  filterRevokedFeedItems,
  normalizeOriginPattern,
  revokedSourceKeys,
  valueTouchesOrigins,
} from "../extension/core/permission-state.mjs";

assert.equal(normalizeOriginPattern("https://example.com/path"), "https://example.com/*");
assert.equal(normalizeOriginPattern("http://localhost:3000/*"), "http://localhost:3000/*");
assert.equal(normalizeOriginPattern("http://example.com/*"), "");
assert.equal(normalizeOriginPattern("https://*/*"), "https://*/*");
assert.equal(normalizeOriginPattern("*://*/*"), "*://*/*");
assert.equal(normalizeOriginPattern("https://user:secret@example.com/"), "");

assert.deepEqual(buildPermissionRows(
  ["https://required.example/*"],
  ["https://required.example/*", "https://legacy.example/*"],
), [
  { origin: "https://required.example/*", granted: true, directlyGranted: true, coveredByBroad: false, coversRequired: false, required: true, legacy: false },
  { origin: "https://legacy.example/*", granted: true, directlyGranted: true, coveredByBroad: false, coversRequired: false, required: false, legacy: true },
]);

assert.deepEqual(buildPermissionRows(
  ["https://required.example/*"],
  ["https://*/*"],
), [
  { origin: "https://required.example/*", granted: true, directlyGranted: false, coveredByBroad: true, coversRequired: false, required: true, legacy: false },
  { origin: "https://*/*", granted: true, directlyGranted: true, coveredByBroad: false, coversRequired: true, required: false, legacy: false },
], "a broad legacy grant must satisfy exact HTTPS rows while remaining visible for revocation");

const sources = [
  { key: "a", url: "https://one.example/feed" },
  { key: "b", url: "https://two.example/feed" },
];
const revokedKeys = revokedSourceKeys(sources, ["https://one.example/*"]);
assert.deepEqual([...revokedKeys], ["a"]);
assert.deepEqual(filterRevokedFeedItems([
  { sourceKey: "a", url: "https://cdn.example/article" },
  { sourceKey: "b", sourceOrigin: "https://two.example", url: "https://two.example/article" },
  { sourceKey: "b", sourceOrigin: "https://two.example", url: "https://one.example/article" },
  { sourceKey: "legacy", url: "https://unrelated.example/article" },
], ["https://one.example/*"], revokedKeys), [
  { sourceKey: "b", sourceOrigin: "https://two.example", url: "https://two.example/article" },
  { sourceKey: "b", sourceOrigin: "https://two.example", url: "https://one.example/article" },
]);

assert.deepEqual(filterFeedItemsBySources([
  { sourceKey: "a", sourceOrigin: "https://one.example", url: "https://cdn.example/article" },
  { sourceKey: "b", sourceOrigin: "https://old.example", url: "https://two.example/article" },
  { sourceKey: "legacy", url: "https://one.example/article" },
], [
  { key: "a", url: "https://one.example/feed" },
  { key: "b", url: "https://two.example/feed" },
]), [
  { sourceKey: "a", sourceOrigin: "https://one.example", url: "https://cdn.example/article" },
], "read-time filtering must require both the current source key and its exact source origin");

assert.deepEqual([...revokedSourceKeys(sources, ["https://*/*"])], ["a", "b"], "a broad HTTPS revocation must cover every HTTPS source");

assert.equal(valueTouchesOrigins({ url: "https://one.example/article" }, ["https://one.example/*"]), true);
assert.equal(valueTouchesOrigins({ links: [{ url: "https://two.example/article" }] }, ["https://one.example/*"]), false);
assert.equal(valueTouchesOrigins({ url: "https://two.example/article" }, ["https://*/*"]), true);

console.log("permission state tests passed");
