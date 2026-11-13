import { HEADER_VIDEO_MAX_BYTES, HEADER_VIDEO_PATH, HEADER_VIDEO_SAVE_PATH, headerVideoResponse } from "../core/header-video.mjs";
import { normalizeNetworkHeaderCoverUrl } from "../core/header-cover-cache.mjs";

export async function handleHeaderVideoFetch(event, {
  origin, clients, headerCoverStore, saveSettings, isResetting = () => false, fetchVideo = fetch,
}) {
  const request = event.request;
  const target = new URL(request.url);
  const client = event.clientId ? await clients.get(event.clientId) : null;
  if (!client || new URL(client.url).origin !== origin || new URL(client.url).pathname !== "/dashboard.html" || isResetting()) {
    return Response.error();
  }
  if (target.origin === origin && target.pathname === HEADER_VIDEO_SAVE_PATH) return saveUpload();
  if (request.method !== "GET" || request.destination !== "video" || request.mode !== "no-cors") {
    return Response.error();
  }
  try {
    const range = request.headers.get("range") || "";
    if (target.origin === origin && target.pathname === HEADER_VIDEO_PATH && target.searchParams.has("local")) {
      const blob = await headerCoverStore.readVideo(target.searchParams.get("local"));
      return blob ? headerVideoResponse(blob, range) : Response.error();
    }
    if (target.origin === origin || !normalizeNetworkHeaderCoverUrl(target.href)
      || range && !/^bytes=\d+-\d*$/.test(range)) return Response.error();
    // Preserve opaque responses: only the browser media decoder may consume
    // them. No host permission, website credentials, or persistent cache needed.
    // Passing the original Request preserves the browser's privileged Range
    // header. Rebuilding it from a URL strips Range in no-cors mode.
    return await fetchVideo(request, {
      credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow",
    });
  } catch {
    return Response.error();
  }

  async function saveUpload() {
    if (request.method !== "POST" || request.destination !== "" || request.mode !== "same-origin"
      || !request.headers.get("content-type")?.startsWith("multipart/form-data;")) return Response.error();
    let requestId = "";
    try {
      let bytes = 0;
      const limited = request.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > HEADER_VIDEO_MAX_BYTES + 1024 * 1024) throw new Error("HEADER_COVER_INVALID");
          controller.enqueue(chunk);
        },
      }));
      const form = await new Response(limited, { headers: { "Content-Type": request.headers.get("content-type") } }).formData();
      requestId = String(form.get("requestId") || "").slice(0, 80);
      const rawSettings = form.get("settings");
      if (typeof rawSettings !== "string" || rawSettings.length > 1024 * 1024) throw new Error("HEADER_COVER_INVALID");
      const body = JSON.parse(rawSettings);
      if (body?.headerCoverOperation?.action !== "replace" || !body.headerCoverOperation.record?.videoId) throw new Error("HEADER_COVER_INVALID");
      body.headerCoverOperation.blob = form.get("file");
      if (request.signal.aborted || isResetting()) throw new Error("HEADER_COVER_INVALID");
      const data = await saveSettings(body);
      return Response.json({ ok: true, requestId, data });
    } catch (error) {
      return Response.json({ ok: false, requestId, error: {
        code: error.code || "HEADER_COVER_INVALID",
        messageKey: error.messageKey || "background.error.headerCoverInvalid",
        messageParams: error.messageParams || {},
      } }, { status: 400 });
    }
  }
}
