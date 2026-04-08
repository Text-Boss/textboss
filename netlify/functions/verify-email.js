const { createEntitlementStore } = require("./_lib/supabase");
const sessionLib = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getRedirectForTier(tier) {
  return `/app-${tier.toLowerCase()}.html`;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function createHandler(deps) {
  const {
    findEntitlementByEmail,
    createSessionCookie,
  } = deps;

  return async function handler(event) {
    try {
      if (event.httpMethod !== "POST") {
        return json(405, { ok: false, denied: true, reason: "method_not_allowed" });
      }

      let body;
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { ok: false, denied: true, reason: "invalid_json" });
      }

      const email = normalizeEmail(body.email);
      if (!email) {
        return json(400, { ok: false, denied: true, reason: "missing_email" });
      }

      const entitlement = await findEntitlementByEmail(email);
      if (!entitlement) {
        return json(403, { ok: false, denied: true, reason: "not_found" });
      }

      const tier = normalizeTier(entitlement.entitled_tier);
      if (!tier) {
        return json(403, { ok: false, denied: true, reason: "invalid_tier" });
      }

      const status = normalizeStatus(entitlement.subscription_status);
      if (status !== "active" && status !== "trialing") {
        return json(403, { ok: false, denied: true, reason: "not_active" });
      }

      const setCookie = createSessionCookie({
        email,
        tier,
      });

      return json(
        200,
        {
          ok: true,
          tier,
          redirectTo: getRedirectForTier(tier),
        },
        { "set-cookie": setCookie }
      );
    } catch {
      return json(500, { ok: false, denied: true, reason: "server_error" });
    }
  };
}

async function notImplemented() {
  throw new Error("verify-email dependencies are not configured");
}

function createRuntimeHandler(overrides = {}) {
  const store = overrides.store || createEntitlementStore();
  const runtimeSessionLib = overrides.sessionLib || sessionLib;

  return createHandler({
    findEntitlementByEmail: (email) => store.findEntitlementByEmail(email),
    createSessionCookie: (session) => runtimeSessionLib.createSessionCookie(session),
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
