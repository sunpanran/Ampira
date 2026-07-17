import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ENTRY_MODULES = [
  "extension/service-worker.mjs",
  "assets/client/theme-bootstrap.mjs",
  "assets/client/extension-ui.mjs",
  "assets/client/app.mjs",
  "assets/client/action-popup.mjs",
];

const DYNAMIC_CLASS_NAMES = new Set([
  "ai-provider-logo-dark",
  "ai-provider-logo-light",
  "is-archive",
  "is-cache",
  "is-healthy",
  "is-inspiration",
  "is-news",
  "is-permissionRequired",
  "is-plain",
  "is-warning",
  "loading-line-medium",
  "loading-line-short",
  "loading-line-wide",
]);

const REMOVED_IDENTIFIERS = [
  "sanitizeLocalOnlyFields",
  "broadPatternCovers",
  "CARD_SUMMARY_POLICY_VERSION",
  "NEWS_RANKING_POLICY_VERSION",
  "DAILY_DIGEST_SCHEMA_VERSION",
  "INSPIRATION_PRESET_ID",
  "INSPIRATION_PRESET_VERSION",
  "normalizeClientStatePatch",
  "normalizeChinaLocationSearchKey",
  "syncSelectCombobox",
  "formatLocaleNumber",
  "getElements",
  "bestSrcset",
  "comparableText",
  "normalizedDate",
  "currentPipelineStage",
  "setMeter",
  "isBookmarkCard",
];

export async function runCodeHygieneTests(root) {
  const productionModules = await listFiles(root, ["extension", "assets/client"], ".mjs");
  const sources = new Map(await Promise.all(productionModules.map(async (file) => [
    relative(root, file),
    await fs.readFile(file, "utf8"),
  ])));

  const reachable = new Set();
  const pending = [...ENTRY_MODULES];
  while (pending.length) {
    const current = pending.pop();
    if (reachable.has(current)) continue;
    const source = sources.get(current);
    assert(source, `production entry or local import is missing: ${current}`);
    reachable.add(current);
    for (const specifier of localModuleSpecifiers(source)) {
      const resolved = resolveModule(root, current, specifier);
      assert(sources.has(resolved), `missing packaged module import ${specifier} from ${current}`);
      pending.push(resolved);
    }
  }
  assert.deepEqual(
    [...sources.keys()].filter((file) => !reachable.has(file)),
    [],
    "every production module must be reachable from an extension entry point",
  );

  const combinedSource = [...sources.values()].join("\n");
  for (const identifier of REMOVED_IDENTIFIERS) {
    assert(!combinedSource.includes(identifier), `${identifier} must not return as obsolete production code`);
  }

  const [htmlFiles, cssFiles] = await Promise.all([
    listFiles(root, ["."], ".html"),
    listFiles(root, ["assets"], ".css"),
  ]);
  const markup = (await Promise.all(htmlFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
  const referencedText = `${combinedSource}\n${markup}`;
  const cssSource = (await Promise.all(cssFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
  const unusedClasses = [...cssSource.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)]
    .map((match) => match[1])
    .filter((name, index, all) => all.indexOf(name) === index)
    .filter((name) => !DYNAMIC_CLASS_NAMES.has(name))
    .filter((name) => !referencedText.includes(name));
  assert.deepEqual(unusedClasses, [], "CSS class selectors must be referenced by packaged markup or code");
}

function localModuleSpecifiers(source) {
  return [...source.matchAll(/(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/g)]
    .map((match) => match[1]);
}

function resolveModule(root, from, specifier) {
  return relative(root, path.resolve(root, path.dirname(from), specifier));
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

async function listFiles(root, directories, extension) {
  const files = [];
  for (const directory of directories) {
    await visit(path.join(root, directory));
  }
  return files;

  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "dashboard-cache", "output"].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && file.endsWith(extension)) files.push(file);
    }
  }
}
