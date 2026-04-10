const { createEntitlementStore, createPushSubscriptionStore } = require("./_lib/supabase");
const sessionLib    = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");

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

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

const SCHEDULING_TIERS = new Set(["Pro", "Black"]);

function createHandler(deps) {
  const {
    verifySessionCookie,
    findEntitlementByEmail,
    saveSubscription,
    deleteSubscription,
  } = deps;

  async function verifySession(event) {
    const verification = verifySessionCookie(event.headers || {});
    if (!verification.ok) return { error: deny(401, verification.reason) };

    const session = verification.session;
    const entitlement = await findEntitlementByEmail(session.email);
    if (!entitlement) return { error: deny(403, "not_found") };

    if (normalizeStatus(entitlement.subscription_status) !== "active" &&
        normalizeStatus(entitlement.subscription_status) !== "trialing") {
      return { error: deny(403, "not_active") };
    }

    const entitlementTier = normalizeTier(entitlement.entitled_tier);
    const sessionTier     = normalizeTier(session.tier);
    if (!entitlementTier || !sessionTier || entitlementTier !== sessionTier) {
      return { error: deny(403, "invalid_tier") };
    }

    return { session, tier: sessionTier };
  }

  return async function handler(event) {
    const method = event.httpMethod;

    const auth = await verifySession(event);
    if (auth.error) return auth.error;

    if (!SCHEDULING_TIERS.has(auth.tier)) {
      return deny(403, "tier_not_entitled");
    }

    // ── POST: save a new push subscription ──────────────────────────────────
    if (method === "POST") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return deny(400, "invalid_json"); }

      const { endpoint, keys } = body;
      if (!endpoint || typeof endpoint !== "string") return deny(400, "missing_endpoint");
      if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
        return deny(400, "missing_keys");
      }

      const result = await saveSubscription(auth.session.email, { endpoint, keys });
      return json(200, { ok: true, id: result.id });
    }

    // ── DELETE: remove a push subscription by endpoint ───────────────────────
    if (method === "DELETE") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return deny(400, "invalid_json"); }

      const { endpoint } = body;
      if (!endpoint || typeof endpoint !== "string") return deny(400, "missing_endpoint");

      await deleteSubscription(auth.session.email, endpoint);
      return json(200, { ok: true, deleted: true });
    }

    return deny(405, "method_not_allowed");
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore  = overrides.entitlementStore  || createEntitlementStore();
  const pushStore         = overrides.pushStore         || createPushSubscriptionStore();
  const runtimeSessionLib = overrides.sessionLib        || sessionLib;

  return createHandler({
    verifySessionCookie:    (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e) => entitlementStore.findEntitlementByEmail(e),
    saveSubscription:       (e, s) => pushStore.saveSubscription(e, s),
    deleteSubscription:     (e, ep) => pushStore.deleteSubscription(e, ep),
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
