export const HEADER_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const HEADER_VIDEO_RECORD_PREFIX = "header-cover:video:";
export const HEADER_VIDEO_RECORD_KIND = "local-header-video";
export const HEADER_VIDEO_PATH = "/_header-video";
export const HEADER_VIDEO_SAVE_PATH = "/_header-cover-save";

export function normalizeHeaderVideoRecord(value) {
  if (Number(value?.schemaVersion) !== 2
    || !/^[a-f0-9-]{36}$/.test(String(value.videoId || ""))
    || !["video/mp4", "video/webm"].includes(value.mimeType)
    || !Number.isInteger(value.byteLength) || value.byteLength <= 0 || value.byteLength > HEADER_VIDEO_MAX_BYTES
    || !Number.isInteger(value.width) || value.width <= 0 || value.width > 8192
    || !Number.isInteger(value.height) || value.height <= 0 || value.height > 8192) return null;
  const date = new Date(String(value.updatedAt || ""));
  return {
    schemaVersion: 2, videoId: value.videoId, mimeType: value.mimeType,
    name: String(value.name || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "cover.mp4",
    width: value.width, height: value.height, byteLength: value.byteLength,
    updatedAt: Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString(),
  };
}

export async function isHeaderVideoBlob(blob, record) {
  if (!(blob instanceof Blob) || blob.size !== record?.byteLength || blob.type !== record.mimeType) return false;
  const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  if (record.mimeType === "video/mp4") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  return bytes.length >= 8 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
    && new TextDecoder().decode(bytes).includes("webm");
}

export function headerVideoResponse(blob, range = "") {
  const headers = { "Content-Type": blob.type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  if (!range) return new Response(blob, { headers: { ...headers, "Content-Length": String(blob.size) } });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = match?.[1] ? Number(match[1]) : 0;
  let end = match?.[2] ? Number(match[2]) : blob.size - 1;
  if (match && !match[1] && match[2]) { start = Math.max(0, blob.size - end); end = blob.size - 1; }
  if (!match || !match[1] && !match[2] || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start >= blob.size || end < start) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${blob.size}` } });
  }
  end = Math.min(end, blob.size - 1);
  return new Response(blob.slice(start, end + 1, blob.type), {
    status: 206,
    headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${blob.size}` },
  });
}
