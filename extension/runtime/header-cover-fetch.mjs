import { HEADER_COVER_CACHE_PATH, normalizeNetworkHeaderCoverUrl } from "../core/header-cover-cache.mjs";
import { handleHeaderVideoFetch } from "./header-video-fetch.mjs";

export function createHeaderCoverFetchHandler({ cache, origin, clients, headerCoverStore, saveSettings, isResetting = () => false, track = (task) => task }) {
  return function handleFetch(event) {
    const request = event.request;
    const target = new URL(request.url);
    if (target.origin !== origin && request.destination !== "video") return;
    if (target.origin !== origin || ["/_header-video", "/_header-cover-save"].includes(target.pathname)) {
      event.respondWith(track(handleHeaderVideoFetch(event, { origin, clients, headerCoverStore, saveSettings, isResetting })));
      return;
    }
    if (target.pathname !== HEADER_COVER_CACHE_PATH) return;
    event.respondWith(track(resolve(event, target)));
  };

  async function resolve(event, target) {
    const request = event.request;
    const client = event.clientId ? await clients.get(event.clientId) : null;
    const url = normalizeNetworkHeaderCoverUrl(target.searchParams.get("url"));
    if (!client || new URL(client.url).origin !== origin || new URL(client.url).pathname !== "/dashboard.html"
      || request.method !== "GET" || request.destination !== "image" || request.mode !== "no-cors" || !url || isResetting()) {
      return Response.error();
    }
    try { return await cache.load(url); } catch { return Response.error(); }
  }
}
