const { createEntitlementStore, createAvailabilityStore } = require("./_lib/supabase");
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
const TIME_RE = /^\d{2}:\d{2}$/;

function createHandler(deps) {
  const {
    verifySessionCookie,
    findEntitlementByEmail,
    listAvailability,
    addAvailability,
    removeAvailability,
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
    const params = event.queryStringParameters || {};

    const auth = await verifySession(event);
    if (auth.error) return auth.error;

    if (!SCHEDULING_TIERS.has(auth.tier)) {
      return deny(403, "tier_not_entitled");
    }

    // ── GET: list availability ───────────────────────────────────────────────
    if (method === "GET") {
      const slots = await listAvailability(auth.session.email);
      return json(200, { ok: true, availability: slots });
    }

    // ── POST: add a slot ─────────────────────────────────────────────────────
    if (method === "POST") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return deny(400, "invalid_json"); }

      const { day_of_week, start_time, end_time } = body;

      if (typeof day_of_week !== "number" || day_of_week < 0 || day_of_week > 6) {
        return deny(400, "invalid_day_of_week");
      }
      if (!start_time || !TIME_RE.test(start_time)) {
        return deny(400, "invalid_start_time");
      }
      if (!end_time || !TIME_RE.test(end_time)) {
        return deny(400, "invalid_end_time");
      }
      if (start_time >= end_time) {
        return deny(400, "end_time_before_start");
      }

      const slot = await addAvailability(auth.session.email, { day_of_week, start_time, end_time });
      return json(200, { ok: true, slot });
    }

    // ── DELETE: remove a slot ────────────────────────────────────────────────
    if (method === "DELETE") {
      if (!params.id) return deny(400, "missing_id");
      await removeAvailability(params.id, auth.session.email);
      return json(200, { ok: true, deleted: true });
    }

    return deny(405, "method_not_allowed");
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore  = overrides.entitlementStore  || createEntitlementStore();
  const availabilityStore = overrides.availabilityStore || createAvailabilityStore();
  const runtimeSessionLib = overrides.sessionLib        || sessionLib;

  return createHandler({
    verifySessionCookie:    (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e) => entitlementStore.findEntitlementByEmail(e),
    listAvailability:       (e) => availabilityStore.listAvailability(e),
    addAvailability:        (e, s) => availabilityStore.addAvailability(e, s),
    removeAvailability:     (id, e) => availabilityStore.removeAvailability(id, e),
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
