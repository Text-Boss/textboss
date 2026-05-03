const { createFollowUpStore, createPushSubscriptionStore, createEntitlementStore } = require("./_lib/supabase");
const { normalizeTier } = require("./_lib/tier-policy");
const onesignal = require("./_lib/onesignal");

// web-push is optional — gracefully skip push delivery if not installed or VAPID not configured
let webpush;
try { webpush = require("web-push"); } catch (_) { /* not installed */ }

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function deny(statusCode, reason) {
  return json(statusCode, { ok: false, denied: true, reason });
}

function tierAppUrl(tier, hash) {
  const page = tier === "Black" ? "/app-black.html" : "/app-pro.html";
  return hash ? page + hash : page;
}

function createHandler(deps) {
  const {
    verifyScheduledAccess,
    listPendingMessages,
    markNotified,
    getSubscriptionsByEmail,
    deleteSubscriptionById,
    sendPushNotification,
    getJobById,
    findEntitlementByEmail,
    sendOneSignalPush,
  } = deps;

  const tierCache = new Map();

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return deny(405, "method_not_allowed");
    }

    const accessResult = verifyScheduledAccess(event);
    if (!accessResult.ok) {
      console.error("[send-follow-ups] auth rejected:", accessResult.reason, "method:", event.httpMethod, "x-nf-event:", (event.headers || {})["x-nf-event"]);
      return deny(403, accessResult.reason);
    }

    const today = new Date().toISOString().split("T")[0];
    let messages;
    try {
      messages = await listPendingMessages(today);
    } catch (dbErr) {
      console.error("[send-follow-ups] DB query failed:", dbErr);
      return deny(500, "db_error");
    }

    if (messages.length === 0) {
      return json(200, { ok: true, notified: [], count: 0 });
    }

    const notified = [];
    for (const msg of messages) {
      await markNotified(msg.id);

      const record = {
        id: msg.id,
        job_id: msg.job_id,
        owner_email: msg.owner_email,
        purpose: msg.purpose,
        send_date: msg.send_date,
      };
      notified.push(record);

      // Push notification delivery (OneSignal preferred, VAPID fallback)
      if (sendOneSignalPush || sendPushNotification) {
        let ownerTier = tierCache.get(msg.owner_email);
        if (!ownerTier && findEntitlementByEmail) {
          try {
            const ent = await findEntitlementByEmail(msg.owner_email);
            ownerTier = normalizeTier(ent && ent.entitled_tier) || "Pro";
          } catch (_) { ownerTier = "Pro"; }
          tierCache.set(msg.owner_email, ownerTier);
        }

        // Build notification body from job details
        let clientName = "";
        let serviceName = "";
        if (getJobById) {
          try {
            const job = await getJobById(msg.job_id);
            if (job) { clientName = job.client_name || ""; serviceName = job.service_name || ""; }
          } catch (_) { /* best-effort */ }
        }
        const bodyParts = [];
        if (clientName) bodyParts.push(`Message for ${clientName}`);
        if (serviceName) bodyParts.push(`(${serviceName})`);
        bodyParts.push("is ready to send");

        const pushPayload = {
          title: "Text Boss · Follow-Up Ready",
          body: bodyParts.join(" "),
          data: { type: "follow_up", messageId: msg.id, url: tierAppUrl(ownerTier, "#follow-ups") },
        };

        // OneSignal (primary)
        let osDelivered = false;
        if (sendOneSignalPush) {
          const r = await sendOneSignalPush(msg.owner_email, pushPayload).catch(() => ({ ok: false }));
          osDelivered = !!r.ok;
        }

        // VAPID web-push fallback
        if (!osDelivered && sendPushNotification) {
          const subscriptions = await getSubscriptionsByEmail(msg.owner_email);
          for (const sub of subscriptions) {
            try {
              await sendPushNotification(sub, pushPayload);
            } catch (err) {
              if (err && (err.statusCode === 410 || err.statusCode === 404)) {
                await deleteSubscriptionById(sub.id).catch(() => {});
              }
            }
          }
        }
      }
    }

    return json(200, {
      ok: true,
      notified,
      count: notified.length,
    });
  };
}

function createRuntimeHandler(overrides = {}) {
  const followUpStore = overrides.followUpStore || createFollowUpStore();
  const pushStore     = overrides.pushStore     || createPushSubscriptionStore();

  // Configure VAPID once; skip if keys not present or invalid
  let vapidReady = false;
  if (webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:noreply@textboss.app",
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      vapidReady = true;
    } catch (vapidErr) {
      console.error("[send-follow-ups] VAPID setup failed:", vapidErr.message);
    }
  }

  return createHandler({
    verifyScheduledAccess: (event) => {
      const headers = event.headers || {};

      // Netlify scheduled functions set this header
      if (headers["x-nf-event"] === "schedule") {
        return { ok: true };
      }

      // Fallback: require a shared secret
      const authHeader = headers.authorization || headers.Authorization || "";
      const expectedToken = process.env.REMINDERS_SECRET;
      if (expectedToken && authHeader === `Bearer ${expectedToken}`) {
        return { ok: true };
      }

      return { ok: false, reason: "unauthorized" };
    },

    listPendingMessages: (dateStr) => followUpStore.listPendingMessages(dateStr),
    markNotified:        (id) => followUpStore.markNotified(id),

    getSubscriptionsByEmail: (email) => pushStore.getSubscriptionsByEmail(email),
    deleteSubscriptionById:  (id) => pushStore.deleteSubscriptionById(id),
    findEntitlementByEmail:  (email) => (overrides.entitlementStore || createEntitlementStore()).findEntitlementByEmail(email),

    getJobById: null,

    sendOneSignalPush: (email, payload) => onesignal.sendPushToUser(email, payload),

    sendPushNotification: vapidReady
      ? async (sub, payload) => {
          const subscription = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          };
          await webpush.sendNotification(subscription, JSON.stringify(payload));
        }
      : null, // null = push delivery skipped (VAPID not configured)
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    console.error("[send-follow-ups] unhandled error:", err);
    return deny(500, "server_error");
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
