/**
 * sw.js — Text Boss service worker
 *
 * Handles Web Push notification delivery and app shell caching for offline use.
 * Register from the scheduler app pages:
 *   navigator.serviceWorker.register('/sw.js')
 */

const APP_SHELL_CACHE = "tb-shell-v3";
const APP_SHELL_FILES = [
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

// ── Push event: show notification ────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); } catch (_) { data = { body: event.data.text() }; }
  }

  const title   = data.title || "Text Boss";
  const options = {
    body:    data.body  || "You have an upcoming appointment.",
    icon:    data.icon  || "/icon-192.png",
    badge:   "/icon-72.png",
    data:    data.data  || {},
    actions: [
      { action: "view", title: "View" },
      { action: "dismiss", title: "Dismiss" },
    ],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: focus or open the app ─────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  // Determine target URL — prefer an explicit url in the payload, then fall back by type
  var notifData = (event.notification.data) || {};
  var targetUrl = notifData.url || "/access.html";
  if (!notifData.url) {
    if (notifData.type === "follow_up") targetUrl = "/access.html#follow-ups";
    else if (notifData.type === "todo")  targetUrl = "/access.html#todos";
  }

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If the app is already open, focus it
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        // Otherwise open a new window
        return clients.openWindow(targetUrl);
      })
  );
});

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
      .then((networkResponse) => {
        // Optionally update the cache with a fresh copy on network success
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return caches.match("/access.html");
        })
      )
  );
});
