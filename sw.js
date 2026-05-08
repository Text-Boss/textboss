/**
 * sw.js — Text Boss service worker
 *
 * App shell caching for offline use. Push notification delivery is handled by
 * the OneSignal SDK (imported below). Register from app pages:
 *   navigator.serviceWorker.register('/sw.js')
 */

// OneSignal handles push events — import its SW SDK first
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Bump this version (tb-shell-vN → tb-shell-v(N+1)) whenever any file in
// APP_SHELL_FILES changes. The activate handler evicts older tb-shell-* caches.
const APP_SHELL_CACHE = "tb-shell-v5";
const APP_SHELL_FILES = [
  "/app.html",
  "/app-core.html",
  "/app-pro.html",
  "/app-black.html",
  "/access.html",
  "/app-client.js",
  "/scheduler-client.js",
  "/followup-client.js",
  "/prompts-client.js",
  "/todos-client.js",
  "/settings-client.js",
  "/prompts-data.json",
  "/manifest.json",
];

// ── Install: cache app shell files and skip waiting ───────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

// ── Activate: clean up old tb-shell-* caches and claim clients ────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("tb-shell-") && key !== APP_SHELL_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first with shell cache fallback (skip API calls) ───────────
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Let API calls pass through naturally — no service worker interception
  if (url.includes("/.netlify/functions/")) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => networkResponse)
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return caches.match("/access.html");
        })
      )
  );
});
