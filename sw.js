/**
 * sw.js — Text Boss service worker
 *
 * Handles Web Push notification delivery and app shell caching for offline use.
 * Register from the scheduler app pages:
 *   navigator.serviceWorker.register('/sw.js')
 */

const CACHE_NAME = "textboss-v1";

const APP_SHELL_CACHE = "tb-shell-v1";
const APP_SHELL_FILES = [
  "/app.html",
  "/app-mobile.css",
  "/app-client.js",
  "/scheduler-client.js",
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

  // Determine target URL based on notification type
  var notifData = (event.notification.data) || {};
  var targetUrl = "/";
  if (notifData.type === "follow_up") {
    targetUrl = "/#follow-ups";
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
          // Final fallback: serve the app shell root
          return caches.match("/app.html");
        })
      )
  );
});
