const { createEntitlementStore } = require("./_lib/supabase");
const sessionLib = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function createHandler(deps) {
  const { verifySessionCookie, findEntitlementByEmail } = deps;

  return async function handler(event) {
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, denied: true, reason: "method_not_allowed" });
    }

    const verification = verifySessionCookie(event.headers || {});
    if (!verification.ok) {
      return json(401, { ok: false, denied: true, reason: verification.reason });
    }

    const session = verification.session;
    const entitlement = await findEntitlementByEmail(session.email);

    if (!entitlement) {
      return json(403, { ok: false, denied: true, reason: "not_found" });
    }

    const status = normalizeStatus(entitlement.subscription_status);
    if (status !== "active" && status !== "trialing") {
      return json(403, { ok: false, denied: true, reason: "not_active" });
    }

    const entitlementTier = normalizeTier(entitlement.entitled_tier);
    const sessionTier = normalizeTier(session.tier);

    if (!entitlementTier || !sessionTier) {
      return json(403, { ok: false, denied: true, reason: "invalid_tier" });
    }

    if (entitlementTier !== sessionTier) {
      return json(403, { ok: false, denied: true, reason: "invalid_tier" });
    }

    return json(200, {
      ok: true,
      email: session.email,
      tier: sessionTier,
    });
  };
}

async function notImplemented() {
  throw new Error("session-verify dependencies are not configured");
}

function createRuntimeHandler(overrides = {}) {
  const store = overrides.store || createEntitlementStore();
  const runtimeSessionLib = overrides.sessionLib || sessionLib;

  return createHandler({
    verifySessionCookie: (headers) => runtimeSessionLib.verifySessionCookie(headers),
    findEntitlementByEmail: (email) => store.findEntitlementByEmail(email),
  });
}

async function handler(event, context) {
  try {
    const runtimeHandler = createRuntimeHandler();
    return runtimeHandler(event, context);
  } catch {
    return json(500, { ok: false, denied: true, reason: "server_error" });
  }
}

exports.createHandler = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler = handler;
