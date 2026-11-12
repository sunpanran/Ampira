import fs from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";

export async function savePairing(directory, ticket) {
  if (!valid(ticket)) throw new Error("invalid-or-expired-pairing");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error("invalid-data-directory");
  const file = path.join(directory, "pairing.json");
  const existing = await fs.lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (existing?.isSymbolicLink()) throw new Error("invalid-pairing-file");
  await fs.writeFile(file, JSON.stringify(ticket), { encoding: "utf8", mode: 0o600 });
}
export async function matchPairing(directory, code, extensionId) {
  const ticket = await read(directory);
  if (!valid(ticket) || ticket.extensionId !== extensionId || typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code)) return false;
  return timingSafeEqual(Buffer.from(ticket.code), Buffer.from(code));
}
export async function finishPairing(directory, code) {
  const ticket = await read(directory);
  if (ticket?.code === code) await fs.unlink(path.join(directory, "pairing.json")).catch(error => { if (error.code !== "ENOENT") throw error; });
}
async function read(directory) {
  try {
    const file = path.join(directory, "pairing.json"), info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) return null;
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch { return null; }
}
function valid(ticket) {
  return ticket && /^[a-f0-9]{64}$/.test(ticket.code) && /^[a-p]{32}$/.test(ticket.extensionId)
    && Number.isSafeInteger(ticket.expiresAt) && ticket.expiresAt > Date.now() && ticket.expiresAt <= Date.now() + 10 * 60 * 1000;
}
