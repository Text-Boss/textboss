"use strict";

const { createServiceRoleClient, createTodoStore, createPushSubscriptionStore, createEntitlementStore } = require("./_lib/supabase");
const { normalizeTier } = require("./_lib/tier-policy");

let webpush;
try { webpush = require("web-push"); } catch (_) {}

let resend;
try { resend = new (require("resend").Resend)(process.env.RESEND_API_KEY); } catch (_) {}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function verifyScheduledAccess(event) {
  const nfEvent = (event.headers || {})["x-nf-event"];
  if (nfEvent === "schedule") return { ok: true };
  const auth = (event.headers || {})["authorization"] || "";
  const secret = process.env.REMINDERS_SECRET;
  if (secret && auth === `Bearer ${secret}`) return { ok: true };
  return { ok: false, reason: "unauthorized" };
}

function tierAppUrl(tier, hash) {
  const page = tier === "Black" ? "/app-black.html" : tier === "Pro" ? "/app-pro.html" : "/access.html";
  return hash && page !== "/access.html" ? page + hash : page;
}

function createHandler(deps) {
  const {
    findDueUnreminded,
    markReminderSent,
    getSubscriptionsByEmail,
    deleteSubscriptionById,
    sendPushNotification,
    sendEmail,
    findEntitlementByEmail,
  } = deps;

  const tierCache = new Map();

  return async function handler(event) {
    if (event.httpMethod !== "POST") return json(405, { ok: false, reason: "method_not_allowed" });

    const access = verifyScheduledAccess(event);
    if (!access.ok) return json(403, { ok: false, reason: access.reason });

    const dueTodos = await findDueUnreminded();
    if (dueTodos.length === 0) return json(200, { ok: true, reminded: 0 });

    let reminded = 0;

    for (const todo of dueTodos) {
      await markReminderSent(todo.id);
      reminded++;

      let ownerTier = tierCache.get(todo.owner_email);
      if (!ownerTier && findEntitlementByEmail) {
        try {
          const ent = await findEntitlementByEmail(todo.owner_email);
          ownerTier = normalizeTier(ent && ent.entitled_tier) || "Pro";
        } catch (_) { ownerTier = "Pro"; }
        tierCache.set(todo.owner_email, ownerTier);
      }

      const payload = {
        title: todo.is_urgent ? "⚠ Urgent To-Do Reminder" : "Text Boss · To-Do Reminder",
        body:  todo.text.length > 100 ? todo.text.slice(0, 97) + "…" : todo.text,
        data:  { type: "todo", todoId: todo.id, url: tierAppUrl(ownerTier, "#todos") },
      };

      let pushDelivered = false;

      // ── Web Push (primary) ────────────────────────────────────────────────
      if (sendPushNotification) {
        const subs = await getSubscriptionsByEmail(todo.owner_email).catch(() => []);
        for (const sub of subs) {
          try {
            await sendPushNotification(sub, payload);
            pushDelivered = true;
          } catch (err) {
            if (err && (err.statusCode === 410 || err.statusCode === 404)) {
              await deleteSubscriptionById(sub.id).catch(() => {});
            }
          }
        }
      }

      // ── Email fallback ────────────────────────────────────────────────────
      if (!pushDelivered && sendEmail) {
        await sendEmail({
          to:      todo.owner_email,
          subject: payload.title,
          text:    `Reminder from Text Boss:\n\n${todo.text}\n\nLog in to manage your to-do list.`,
        }).catch(() => {});
      }
    }

    return json(200, { ok: true, reminded });
  };
}

function createRuntimeHandler(overrides = {}) {
  const todoStore = overrides.todoStore || createTodoStore();
  const pushStore = overrides.pushStore || createPushSubscriptionStore();

  function setupWebPush() {
    if (!webpush) return;
    const pub  = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subj = process.env.VAPID_SUBJECT;
    if (pub && priv && subj) {
      webpush.setVapidDetails(subj, pub, priv);
    }
  }
  setupWebPush();

  return createHandler({
    findDueUnreminded:       () => todoStore.findDueUnreminded(),
    markReminderSent:        (id) => todoStore.markReminderSent(id),
    getSubscriptionsByEmail: (e) => pushStore.getSubscriptionsByEmail(e),
    deleteSubscriptionById:  (id) => pushStore.deleteSubscriptionById(id),
    findEntitlementByEmail:  (e) => (overrides.entitlementStore || createEntitlementStore()).findEntitlementByEmail(e),

    sendPushNotification: webpush
      ? async (sub, payload) => {
          const subscription = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          };
          await webpush.sendNotification(subscription, JSON.stringify(payload));
        }
      : null,

    sendEmail: resend
      ? async ({ to, subject, text }) => {
          await resend.emails.send({
            from: "Text Boss <noreply@textboss.com.au>",
            to,
            subject,
            text,
          });
        }
      : null,
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    console.error("[send-todo-reminders] unhandled error:", err);
    return json(500, { ok: false, reason: "server_error" });
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
