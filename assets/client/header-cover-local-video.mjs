import { HEADER_VIDEO_MAX_BYTES, HEADER_VIDEO_SAVE_PATH, isHeaderVideoBlob, normalizeHeaderVideoRecord } from "../../extension/core/header-video.mjs";

export async function prepareHeaderVideoFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const mimeType = ["video/mp4", "video/webm"].includes(type) ? type
    : (!type || type === "application/octet-stream") && /\.(mp4|webm)$/i.test(file?.name || "")
      ? `video/${file.name.split(".").at(-1).toLowerCase()}` : "";
  if (!mimeType) throw videoError("settings.headerImage.localErrorType");
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > HEADER_VIDEO_MAX_BYTES) throw videoError("settings.headerImage.localVideoErrorSize");
  const blob = file.slice(0, file.size, mimeType);
  if (!await isHeaderVideoBlob(blob, { byteLength: blob.size, mimeType })) throw videoError("settings.headerImage.localVideoErrorDecode");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const metadata = await readVideoMetadata(objectUrl);
    const record = normalizeHeaderVideoRecord({ schemaVersion: 2, videoId: crypto.randomUUID(), name: file.name,
      mimeType, byteLength: blob.size, ...metadata });
    if (!record) throw videoError("settings.headerImage.localVideoErrorDecode");
    return { ...record, blob, objectUrl };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

export async function saveHeaderVideoSettings(payload, blob) {
  if (!await globalThis.ampiraLayoutBootstrap?.prepareHeaderCoverController?.()) throw videoError("background.error.headerCoverStorage");
  const requestId = crypto.randomUUID();
  const form = new FormData();
  form.set("requestId", requestId);
  form.set("settings", JSON.stringify(payload));
  form.set("file", blob, "cover");
  const response = await fetch(HEADER_VIDEO_SAVE_PATH, { method: "POST", mode: "same-origin", credentials: "omit", cache: "no-store", body: form });
  const result = await response.json();
  if (result.requestId !== requestId || !result.ok) {
    throw videoError(result.error?.messageKey || "background.error.headerCoverStorage", result.error?.messageParams);
  }
  return result.data;
}

function readVideoMetadata(source) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const timer = setTimeout(() => finish(), 15000);
    const finish = (value) => {
      clearTimeout(timer);
      video.onloadeddata = video.onerror = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (value) resolve(value);
      else reject(videoError("settings.headerImage.localVideoErrorDecode"));
    };
    video.muted = true;
    video.preload = "auto";
    video.onloadeddata = () => finish({ width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => finish();
    video.src = source;
  });
}

function videoError(messageKey, messageParams = {}) {
  return Object.assign(new Error(messageKey), { messageKey, messageParams });
}
