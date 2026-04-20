const { createEntitlementStore, createAppointmentStore } = require("./_lib/supabase");
const sessionLib    = require("./_lib/session");
const { denied: deny, json } = require("./_lib/http");
const { verifyBookingAccess, getHistoryLimit, isBlackTier } = require("./_lib/booking-auth");

const DATE_RE      = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE      = /^\d{2}:\d{2}$/;
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

  return async function handler(event) {
    const method = event.httpMethod;
    const params = event.queryStringParameters || {};

    // ── Auth: cookie verify + Supabase entitlement re-check + tier gate ────────
    // verifyBookingAccess performs all three steps on every request.
    // Core users are rejected here with 403 tier_not_entitled before any DB write.
    const auth = await verifyBookingAccess(event, { verifySessionCookie, findEntitlementByEmail });
    if (auth.error) return auth.error;

    const { session, tier } = auth;

    // ── GET: list appointments ───────────────────────────────────────────────
    if (method === "GET") {
      const upcomingOnly = params.all !== "true";

      // When fetching past appointments, cap the result set by tier.
      // Black: last 10, Pro: last 5. This feeds both the calendar UI
      // and the AI scheduling context — Black subscribers get deeper history
      // for personalised scheduling conversations.
      const historyLimit = getHistoryLimit(tier);

      const appointments = await listAppointments(session.email, upcomingOnly);
      return json(200, {
        ok: true,
        appointments,
        history_limit: historyLimit,
        is_black_tier: isBlackTier(tier),
      });
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

      const appt = await createAppointment(session.email, body);
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

      const appt = await updateAppointment(params.id, session.email, body);
      return json(200, { ok: true, appointment: appt });
    }

    // ── DELETE: delete appointment ───────────────────────────────────────────
    if (method === "DELETE") {
      if (!params.id) return deny(400, "missing_id");
      await deleteAppointment(params.id, session.email);
      return json(200, { ok: true, deleted: true });
    }

    return deny(405, "method_not_allowed");
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore  = overrides.entitlementStore || createEntitlementStore();
  const appointmentStore  = overrides.appointmentStore || createAppointmentStore();
  const runtimeSessionLib = overrides.sessionLib       || sessionLib;

  return createHandler({
    verifySessionCookie:    (h)        => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e)        => entitlementStore.findEntitlementByEmail(e),
    listAppointments:       (e, u)     => appointmentStore.listAppointments(e, u),
    createAppointment:      (e, a)     => appointmentStore.createAppointment(e, a),
    updateAppointment:      (id, e, u) => appointmentStore.updateAppointment(id, e, u),
    deleteAppointment:      (id, e)    => appointmentStore.deleteAppointment(id, e),
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
