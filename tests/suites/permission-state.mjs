import assert from "node:assert/strict";
import {
  buildPermissionRows,
  filterFeedItemsBySources,
  normalizeOriginPattern,
  revokedSourceKeys,
} from "../../extension/core/permission-state.mjs";

assert.equal(normalizeOriginPattern("https://example.com/path"), "https://example.com/*");
assert.equal(normalizeOriginPattern("http://localhost:3000/*"), "http://localhost:3000/*");
assert.equal(normalizeOriginPattern("http://example.com/*"), "");
assert.equal(normalizeOriginPattern("https://*/*"), "");
assert.equal(normalizeOriginPattern("*://*/*"), "");
assert.equal(normalizeOriginPattern("https://user:secret@example.com/"), "");

assert.deepEqual(buildPermissionRows(
  ["https://required.example/*"],
  ["https://required.example/*", "https://legacy.example/*"],
), [
  { origin: "https://required.example/*", granted: true },
]);

assert.deepEqual(buildPermissionRows(
  ["https://required.example/*"],
  ["https://*/*"],
), [
  { origin: "https://required.example/*", granted: false },
], "broad origins must not satisfy exact source access");

const sources = [
  { key: "a", url: "https://one.example/feed" },
  { key: "b", url: "https://two.example/feed" },
];
const revokedKeys = revokedSourceKeys(sources, ["https://one.example/*"]);
assert.deepEqual([...revokedKeys], ["a"]);
assert.deepEqual(filterFeedItemsBySources([
  { sourceKey: "a", url: "https://cdn.example/article" },
  { sourceKey: "b", sourceOrigin: "https://two.example", url: "https://two.example/article" },
  { sourceKey: "b", sourceOrigin: "https://two.example", url: "https://one.example/article" },
  { sourceKey: "legacy", url: "https://unrelated.example/article" },
], sources.filter((source) => !revokedKeys.has(source.key))), [
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

assert.deepEqual([...revokedSourceKeys(sources, ["https://*/*"])], [], "broad origins must not participate in source cleanup");

console.log("permission state tests passed");
