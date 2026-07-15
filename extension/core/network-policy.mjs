export function isPrivateAddressLiteral(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "::1"].includes(host)) return true;
  if (/^(?:fc|fd|fe[89ab])[0-9a-f:]*$/i.test(host)) return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10
    || octets[0] === 127
    || octets[0] === 0
    || octets[0] === 169 && octets[1] === 254
    || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
    || octets[0] === 192 && octets[1] === 168;
}
