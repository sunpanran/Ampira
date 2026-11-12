import assert from "node:assert/strict";
import path from "node:path";
import { resolveCodexExecutable } from "../../integrations/local-mcp/codex-executable.mjs";

const installation = version => `C:\\Program Files\\WindowsApps\\OpenAI.Codex_${version}_x64__syntheticpublisher`;
const executable = version => path.win32.join(installation(version), "app", "resources", "codex.exe");
const old = executable("1.0.0.0"), current = executable("1.0.1.0");
const registered = location => ({ Name: "OpenAI.Codex", PackageFamilyName: "OpenAI.Codex_syntheticpublisher", InstallLocation: location });
const files = new Set([current]);
const queried = [];
const options = {
  platform: "win32", stat: async candidate => ({ isFile: () => files.has(candidate) }),
  listPackages: async () => { queried.push(true); return [registered(installation("1.0.1.0"))]; },
};
assert.equal(await resolveCodexExecutable(old, options), current, "a removed Store version resolves through the registered package");
assert.equal(queried.length, 1);
assert.equal(await resolveCodexExecutable(current, options), current);
assert.equal(queried.length, 1, "a working path never triggers discovery");
files.add(old);
assert.equal(await resolveCodexExecutable(old, options), old, "preserve an explicitly configured working version");
assert.equal(queried.length, 1);
files.delete(old);

for (const candidate of ["C:\\custom\\codex.exe", "C:\\tools\\node.exe", "codex.exe", "C:\\custom\\codex.exe\n--unsafe"])
  await assert.rejects(resolveCodexExecutable(candidate, options), { code: "unavailable" });
assert.equal(queried.length, 1, "a missing custom executable must not silently switch to the desktop app");
await assert.rejects(resolveCodexExecutable("/usr/local/bin/codex", { ...options, platform: "linux" }), { code: "unavailable" });
assert.equal(queried.length, 1, "non-Windows paths do not query Windows packages");

for (const packages of [
  [], null,
  [{ ...registered(installation("1.0.1.0")), Name: "Other.App" }],
  [{ ...registered(installation("1.0.1.0")), PackageFamilyName: "OpenAI.Codex_otherpublisher" }],
  [registered("C:\\temp\\untrusted")],
  [registered("relative\\OpenAI.Codex_1.0.1.0_x64__syntheticpublisher")],
  [registered(installation("1.0.2.0"))],
  [registered(installation("1.0.1.0").replace("syntheticpublisher", "otherpublisher"))],
]) await assert.rejects(resolveCodexExecutable(old, { ...options, listPackages: async () => packages }), { code: "unavailable" });
await assert.rejects(resolveCodexExecutable(old, { ...options, listPackages: async () => { throw new Error("query failed"); } }), { code: "unavailable" });
await assert.rejects(resolveCodexExecutable(old, { ...options, stat: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } }), { code: "unavailable" });

files.clear(); files.add(executable("1.0.2.0"));
assert.equal(await resolveCodexExecutable(old, { ...options, listPackages: async () => [registered(installation("1.0.2.0"))] }), executable("1.0.2.0"),
  "another app update is rediscovered rather than pinning the first replacement");
console.log("Codex executable update recovery tests passed");
