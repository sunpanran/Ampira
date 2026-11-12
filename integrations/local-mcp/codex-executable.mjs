import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export async function resolveCodexExecutable(executable, { platform = process.platform, stat = fs.stat, listPackages = registeredCodexPackages } = {}) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (typeof executable !== "string" || !paths.isAbsolute(executable) || /[\r\n]/.test(executable)) throw unavailable();
  const exists = async candidate => (await stat(candidate).catch(() => null))?.isFile() === true;
  if (await exists(executable)) return executable;
  const family = platform === "win32" ? storePackageFamily(executable) : "";
  if (!family) throw unavailable();
  // Store updates remove the versioned directory. Query the user's registered
  // package instead of trusting another executable from the daemon's stale PATH.
  const packages = await listPackages().catch(() => []);
  for (const installed of Array.isArray(packages) ? packages : []) {
    if (installed?.Name !== "OpenAI.Codex" || String(installed.PackageFamilyName || "").toLowerCase() !== family.toLowerCase()
      || typeof installed.InstallLocation !== "string" || !path.win32.isAbsolute(installed.InstallLocation)) continue;
    const candidate = path.win32.join(installed.InstallLocation, "app", "resources", "codex.exe");
    if (storePackageFamily(candidate).toLowerCase() === family.toLowerCase() && await exists(candidate)) return candidate;
  }
  throw unavailable();
}

function storePackageFamily(executable) {
  const resources = path.win32.dirname(executable), app = path.win32.dirname(resources), root = path.win32.dirname(app);
  if (path.win32.basename(executable).toLowerCase() !== "codex.exe" || path.win32.basename(resources).toLowerCase() !== "resources"
    || path.win32.basename(app).toLowerCase() !== "app" || path.win32.basename(path.win32.dirname(root)).toLowerCase() !== "windowsapps") return "";
  const match = path.win32.basename(root).match(/^OpenAI\.Codex_\d+\.\d+\.\d+\.\d+_(?:x64|arm64|x86|neutral)__([a-z0-9]+)$/i);
  return match ? `OpenAI.Codex_${match[1]}` : "";
}

async function registeredCodexPackages() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) return [];
  const executable = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const command = "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; @(Get-AppxPackage -Name OpenAI.Codex | Select-Object Name,PackageFamilyName,InstallLocation) | ConvertTo-Json -Compress";
  const { stdout } = await executeFile(executable, ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true, shell: false, encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024,
  });
  const value = JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "[]");
  return Array.isArray(value) ? value : [value];
}

function unavailable() { return Object.assign(new Error("unavailable"), { code: "unavailable" }); }
