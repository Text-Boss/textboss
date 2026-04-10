/**
 * sw.js — Text Boss service worker
 *
 * Handles Web Push notification delivery.
 * Register from the scheduler app pages:
 *   navigator.serviceWorker.register('/sw.js')
 */

const CACHE_NAME = "textboss-v1";

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

// ── Install / activate: no caching strategy needed (push-only SW) ────────────
self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));
