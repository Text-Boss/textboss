const { createEntitlementStore, createAvailabilityStore, createAppointmentStore } = require("./_lib/supabase");
const sessionLib    = require("./_lib/session");
const tierPolicyLib = require("./_lib/tier-policy");
const { createResponsesClient } = require("./_lib/openai");
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

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function buildSchedulingContext(availability, appointments) {
  const lines = ["=== SCHEDULING CONTEXT ==="];

  lines.push("\nWeekly Availability:");
  if (!availability || availability.length === 0) {
    lines.push("- No availability configured.");
  } else {
    for (const slot of availability) {
      const day = DAYS[slot.day_of_week] || `Day ${slot.day_of_week}`;
      lines.push(`- ${day}: ${slot.start_time} – ${slot.end_time}`);
    }
  }

  lines.push("\nUpcoming Appointments:");
  if (!appointments || appointments.length === 0) {
    lines.push("- No upcoming appointments.");
  } else {
    for (const appt of appointments) {
      const dateParts = appt.scheduled_date ? appt.scheduled_date.split("-") : [];
      let dayLabel = "";
      if (dateParts.length === 3) {
        const d = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]));
        dayLabel = ` (${DAYS[d.getDay()]})`;
      }
      const parts = [
        `${appt.scheduled_date}${dayLabel} at ${appt.scheduled_time}`,
        `${appt.duration_minutes || 60} min`,
      ];
      if (appt.client_name)    parts.push(appt.client_name);
      if (appt.client_contact) parts.push(appt.client_contact);
      if (appt.title)          parts.push(appt.title);
      if (appt.status && appt.status !== "confirmed") parts.push(`[${appt.status}]`);
      lines.push(`- ${parts.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

function createHandler(deps) {
  const {
    verifySessionCookie,
    findEntitlementByEmail,
    getTierPolicy,
    getSchedulingInstructions,
    createResponse,
    listAvailability,
    listAppointments,
  } = deps;

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return deny(405, "method_not_allowed");
    }

    const verification = verifySessionCookie(event.headers || {});
    if (!verification.ok) return deny(401, verification.reason);

    let body;
    try { body = event.body ? JSON.parse(event.body) : {}; }
    catch { return deny(400, "invalid_json"); }

    const message = String(body.message || "").trim();
    if (!message) return deny(400, "missing_message");

    const session = verification.session;
    const entitlement = await findEntitlementByEmail(session.email);
    if (!entitlement) return deny(403, "not_found");

    if (normalizeStatus(entitlement.subscription_status) !== "active" &&
        normalizeStatus(entitlement.subscription_status) !== "trialing") {
      return deny(403, "not_active");
    }

    const entitlementTier = normalizeTier(entitlement.entitled_tier);
    const sessionTier     = normalizeTier(session.tier);
    if (!entitlementTier || !sessionTier || entitlementTier !== sessionTier) {
      return deny(403, "invalid_tier");
    }

    if (!SCHEDULING_TIERS.has(sessionTier)) {
      return deny(403, "tier_not_entitled");
    }

    const policy = getTierPolicy(sessionTier);

    if (message.length > policy.inputLimit) {
      return deny(400, "message_too_long");
    }

    const conversation = Array.isArray(body.conversation) ? body.conversation : [];

    const [availability, appointments] = await Promise.all([
      listAvailability(session.email),
      listAppointments(session.email, true),
    ]);

    const schedulingInstructions = getSchedulingInstructions(sessionTier);
    const contextBlock = buildSchedulingContext(availability, appointments);

    const extraSystemContext = schedulingInstructions
      ? `${schedulingInstructions}\n\n${contextBlock}`
      : contextBlock;

    const response = await createResponse({
      tier: sessionTier,
      message,
      conversation,
      policy,
      extraSystemContext,
    });

    return json(200, {
      ok: true,
      tier: sessionTier,
      output: response.output,
      usage: response.usage,
    });
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore  = overrides.entitlementStore  || createEntitlementStore();
  const availabilityStore = overrides.availabilityStore || createAvailabilityStore();
  const appointmentStore  = overrides.appointmentStore  || createAppointmentStore();
  const runtimeSessionLib = overrides.sessionLib        || sessionLib;
  const runtimePolicyLib  = overrides.tierPolicyLib     || tierPolicyLib;
  const openaiClient      = overrides.openaiClient      || createResponsesClient();

  return createHandler({
    verifySessionCookie:      (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail:   (e) => entitlementStore.findEntitlementByEmail(e),
    getTierPolicy:            (t) => runtimePolicyLib.getTierPolicy(t),
    getSchedulingInstructions:(t) => runtimePolicyLib.getSchedulingInstructions(t),
    createResponse:           (i) => openaiClient.createResponse(i),
    listAvailability:         (e) => availabilityStore.listAvailability(e),
    listAppointments:         (e, u) => appointmentStore.listAppointments(e, u),
  });
}

async function handler(event, context) {
  try {
    return createRuntimeHandler()(event, context);
  } catch {
    return deny(500, "server_error");
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
exports.buildSchedulingContext = buildSchedulingContext;
