import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Count uncompressed source bytes once per file, as loaded by native ESM.
// Literal dynamic imports are intentionally excluded from the static graph.
export async function staticModuleFiles(root, entries) {
  const visited = new Set();
  async function visit(relative) {
    const file = path.resolve(root, relative);
    if (visited.has(file)) return;
    visited.add(file);
    const source = await fs.readFile(file, "utf8");
    const patterns = [
      /^\s*(?:import|export)\b(?:(?!;)[\s\S])*?\bfrom\s*["']([^"']+)["']/gm,
      /^\s*import\s*["']([^"']+)["']/gm,
    ];
    for (const pattern of patterns) {
      for (const [, specifier] of source.matchAll(pattern)) {
        if (specifier.startsWith(".")) await visit(path.resolve(path.dirname(file), specifier));
      }
    }
  }
  for (const entry of entries) await visit(entry);
  return [...visited].sort();
}

async function describeFiles(root, files) {
  const modules = await Promise.all(files.map(async file => ({
    file: path.relative(root, file).replaceAll("\\", "/"),
    bytes: (await fs.stat(file)).size,
  })));
  return { files: modules.length, bytes: modules.reduce((sum, file) => sum + file.bytes, 0), modules };
}

export async function measureStartup(root = repositoryRoot) {
  const html = await fs.readFile(path.join(root, "dashboard.html"), "utf8");
  const scriptEntries = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map(([, reference]) => reference.replace(/^\//, ""));
  const cssFiles = new Set();
  async function visitCss(file) {
    if (cssFiles.has(file)) return;
    cssFiles.add(file);
    const source = await fs.readFile(file, "utf8");
    for (const [, reference] of source.matchAll(/@import\s+url\(["']([^"']+)["']\)/g)) {
      await visitCss(path.resolve(path.dirname(file), reference));
    }
  }
  for (const [, reference] of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) {
    await visitCss(path.resolve(root, reference.replace(/^\//, "")));
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
  const [dashboardJs, workerJs, popupJs, css, locales] = await Promise.all([
    staticModuleFiles(root, scriptEntries).then(files => describeFiles(root, files)),
    staticModuleFiles(root, [manifest.background.service_worker]).then(files => describeFiles(root, files)),
    staticModuleFiles(root, ["assets/client/action-popup.mjs"]).then(files => describeFiles(root, files)),
    describeFiles(root, [...cssFiles]),
    describeFiles(root, ["en", "zh-CN", "zh-Hant"].map(locale => path.join(root, `assets/client/locales/${locale}.mjs`))),
  ]);
  return {
    unit: "uncompressed source bytes",
    note: "Dashboard JS includes theme bootstrap. Add the active locale and any configured on-demand features; CSS and HTML are separate. These are source sizes, not memory or startup timings.",
    dashboardJs, workerJs, popupJs, css,
    htmlBytes: Buffer.byteLength(html),
    activeLocaleBytes: Object.fromEntries(locales.modules.map(({ file, bytes }) => [path.basename(file, ".mjs"), bytes])),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await measureStartup();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.table(Object.fromEntries(["dashboardJs", "workerJs", "popupJs", "css"].map(key => [key, {
      files: report[key].files, bytes: report[key].bytes, KiB: (report[key].bytes / 1024).toFixed(1),
    }])));
    console.log(`HTML: ${report.htmlBytes} bytes; active locale: ${JSON.stringify(report.activeLocaleBytes)} bytes`);
    console.log(report.note);
  }
}
