import {
  HEADER_COVER_MAX_DIMENSION,
  HEADER_COVER_STORED_MAX_BYTES,
} from "../../extension/core/header-cover.mjs";

const HEADER_COVER_INPUT_MAX_BYTES = 20 * 1024 * 1024;
const HEADER_COVER_QUALITIES = Object.freeze([0.88, 0.80, 0.72]);
const HEADER_COVER_RESIZE_FACTOR = 0.85;
export const HEADER_COVER_MIN_LONG_EDGE = 1280;

export const HEADER_COVER_ACCEPTED_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export async function optimizeHeaderCoverFile(file) {
  if (!file || !HEADER_COVER_ACCEPTED_TYPES.includes(String(file.type || "").toLowerCase())) {
    throw imageError("HEADER_COVER_FILE_TYPE");
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > HEADER_COVER_INPUT_MAX_BYTES) {
    throw imageError("HEADER_COVER_FILE_SIZE");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw imageError("HEADER_COVER_FILE_DECODE");
  }

  try {
    if (!bitmap.width || !bitmap.height) throw imageError("HEADER_COVER_FILE_DECODE");
    const initialScale = Math.min(1, HEADER_COVER_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * initialScale));
    let height = Math.max(1, Math.round(bitmap.height * initialScale));

    while (true) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw imageError("HEADER_COVER_FILE_DECODE");
      context.drawImage(bitmap, 0, 0, width, height);

      for (const quality of HEADER_COVER_QUALITIES) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob?.size > 0 && blob.size <= HEADER_COVER_STORED_MAX_BYTES) {
          return {
            dataUrl: await blobToDataUrl(blob),
            name: cleanFileName(file.name),
            mimeType: "image/webp",
            width,
            height,
            byteLength: blob.size,
          };
        }
      }

      if (Math.max(width, height) <= HEADER_COVER_MIN_LONG_EDGE) break;
      ({ width, height } = nextHeaderCoverDimensions(width, height));
    }
  } finally {
    bitmap.close?.();
  }

  throw imageError("HEADER_COVER_FILE_OPTIMIZE");
}

export function nextHeaderCoverDimensions(width, height) {
  const currentWidth = Math.max(1, Math.round(Number(width) || 0));
  const currentHeight = Math.max(1, Math.round(Number(height) || 0));
  const longEdge = Math.max(currentWidth, currentHeight);
  if (longEdge <= HEADER_COVER_MIN_LONG_EDGE) return { width: currentWidth, height: currentHeight };
  const nextLongEdge = Math.max(HEADER_COVER_MIN_LONG_EDGE, Math.floor(longEdge * HEADER_COVER_RESIZE_FACTOR));
  const scale = nextLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(currentWidth * scale)),
    height: Math.max(1, Math.round(currentHeight * scale)),
  };
}

export function headerCoverImageErrorKey(error) {
  const keys = {
    HEADER_COVER_FILE_TYPE: "settings.headerImage.localErrorType",
    HEADER_COVER_FILE_SIZE: "settings.headerImage.localErrorSize",
    HEADER_COVER_FILE_DECODE: "settings.headerImage.localErrorDecode",
    HEADER_COVER_FILE_OPTIMIZE: "settings.headerImage.localErrorOptimize",
  };
  return keys[error?.code] || "settings.headerImage.localErrorDecode";
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(imageError("HEADER_COVER_FILE_DECODE"));
    reader.readAsDataURL(blob);
  });
}

function cleanFileName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "cover.webp";
}

function imageError(code) {
  const error = new Error(code);
  error.name = "HeaderCoverImageError";
  error.code = code;
  return error;
}
