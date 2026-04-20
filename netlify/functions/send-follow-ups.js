const { createFollowUpStore, createPushSubscriptionStore, createEntitlementStore } = require("./_lib/supabase");
const { normalizeTier } = require("./_lib/tier-policy");

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
  } = deps;

  const tierCache = new Map();

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return deny(405, "method_not_allowed");
    }

    const accessResult = verifyScheduledAccess(event);
    if (!accessResult.ok) {
      return deny(403, accessResult.reason);
    }

    const today = new Date().toISOString().split("T")[0];
    const messages = await listPendingMessages(today);

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

      // Deliver push notification to all of this owner's subscribed devices
      if (sendPushNotification) {
        let ownerTier = tierCache.get(msg.owner_email);
        if (!ownerTier && findEntitlementByEmail) {
          try {
            const ent = await findEntitlementByEmail(msg.owner_email);
            ownerTier = normalizeTier(ent && ent.entitled_tier) || "Pro";
          } catch (_) { ownerTier = "Pro"; }
          tierCache.set(msg.owner_email, ownerTier);
        }

        const subscriptions = await getSubscriptionsByEmail(msg.owner_email);
        for (const sub of subscriptions) {
          try {
            // Try to get job details for better notification text
            let clientName = "";
            let serviceName = "";
            if (getJobById) {
              try {
                const job = await getJobById(msg.job_id);
                if (job) {
                  clientName = job.client_name || "";
                  serviceName = job.service_name || "";
                }
              } catch (_) { /* best-effort */ }
            }

            const bodyParts = [];
            if (clientName) bodyParts.push(`Message for ${clientName}`);
            if (serviceName) bodyParts.push(`(${serviceName})`);
            bodyParts.push("is ready to send");

            await sendPushNotification(sub, {
              title: "Text Boss \u00b7 Follow-Up Ready",
              body: bodyParts.join(" "),
              data: { type: "follow_up", messageId: msg.id, url: tierAppUrl(ownerTier, "#follow-ups") },
            });
          } catch (err) {
            // 410 Gone = subscription expired; remove it so we don't retry
            if (err && (err.statusCode === 410 || err.statusCode === 404)) {
              await deleteSubscriptionById(sub.id).catch(() => {});
            }
            // All other errors: log and continue — don't block marking notified
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

  // Configure VAPID once; skip if keys not present
  let vapidReady = false;
  if (webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:noreply@textboss.app",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    vapidReady = true;
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

    getJobById: null, // In runtime, we rely on the message's owner_email + job data embedded in notification

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
  } catch {
    return deny(500, "server_error");
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
