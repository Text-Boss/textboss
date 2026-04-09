const { createEntitlementStore, createAppointmentStore } = require("./_lib/supabase");
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

const SCHEDULING_TIERS  = new Set(["Pro", "Black"]);
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE  = /^\d{2}:\d{2}$/;
const VALID_STATUSES = new Set(["confirmed", "cancelled", "no_show"]);

function createHandler(deps) {
  const {
    verifySessionCookie,
    findEntitlementByEmail,
    listAppointments,
    createAppointment,
    updateAppointment,
    deleteAppointment,
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

    // ── GET: list appointments ───────────────────────────────────────────────
    if (method === "GET") {
      const upcomingOnly = params.all !== "true";
      const appointments = await listAppointments(auth.session.email, upcomingOnly);
      return json(200, { ok: true, appointments });
    }

    // ── POST: create appointment ─────────────────────────────────────────────
    if (method === "POST") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return deny(400, "invalid_json"); }

      if (!body.scheduled_date || !DATE_RE.test(body.scheduled_date)) {
        return deny(400, "invalid_scheduled_date");
      }
      if (!body.scheduled_time || !TIME_RE.test(body.scheduled_time)) {
        return deny(400, "invalid_scheduled_time");
      }
      if (body.duration_minutes !== undefined &&
          (typeof body.duration_minutes !== "number" || body.duration_minutes < 1)) {
        return deny(400, "invalid_duration_minutes");
      }

      const appt = await createAppointment(auth.session.email, body);
      return json(200, { ok: true, appointment: appt });
    }

    // ── PATCH: update appointment ────────────────────────────────────────────
    if (method === "PATCH") {
      if (!params.id) return deny(400, "missing_id");

      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return deny(400, "invalid_json"); }

      if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
        return deny(400, "invalid_status");
      }
      if (body.scheduled_date !== undefined && !DATE_RE.test(body.scheduled_date)) {
        return deny(400, "invalid_scheduled_date");
      }
      if (body.scheduled_time !== undefined && !TIME_RE.test(body.scheduled_time)) {
        return deny(400, "invalid_scheduled_time");
      }

      const appt = await updateAppointment(params.id, auth.session.email, body);
      return json(200, { ok: true, appointment: appt });
    }

    // ── DELETE: delete appointment ───────────────────────────────────────────
    if (method === "DELETE") {
      if (!params.id) return deny(400, "missing_id");
      await deleteAppointment(params.id, auth.session.email);
      return json(200, { ok: true, deleted: true });
    }

    return deny(405, "method_not_allowed");
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore = overrides.entitlementStore || createEntitlementStore();
  const appointmentStore = overrides.appointmentStore || createAppointmentStore();
  const runtimeSessionLib = overrides.sessionLib      || sessionLib;

  return createHandler({
    verifySessionCookie:    (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e) => entitlementStore.findEntitlementByEmail(e),
    listAppointments:       (e, u) => appointmentStore.listAppointments(e, u),
    createAppointment:      (e, a) => appointmentStore.createAppointment(e, a),
    updateAppointment:      (id, e, u) => appointmentStore.updateAppointment(id, e, u),
    deleteAppointment:      (id, e) => appointmentStore.deleteAppointment(id, e),
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
