const { createEntitlementStore } = require("./_lib/supabase");
const sessionLib = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");
const { hashPassword } = require("./_lib/password");

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

function createHandler(deps) {
  const { findEntitlementByEmail, updatePasswordHash, createSessionCookie } = deps;

  return async function handler(event) {
    try {
      if (event.httpMethod !== "POST") {
        return json(405, { ok: false, denied: true, reason: "method_not_allowed" });
      }

      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; } catch {
        return json(400, { ok: false, denied: true, reason: "invalid_json" });
      }

      const email           = String(body.email           || "").trim().toLowerCase();
      const password        = String(body.password        || "");
      const confirmPassword = String(body.confirmPassword || "");

      if (!email)    return json(400, { ok: false, denied: true, reason: "missing_email" });
      if (!password) return json(400, { ok: false, denied: true, reason: "missing_password" });
      if (password !== confirmPassword) return json(400, { ok: false, denied: true, reason: "password_mismatch" });
      if (password.length < 8) return json(400, { ok: false, denied: true, reason: "password_too_short" });

      const entitlement = await findEntitlementByEmail(email);
      if (!entitlement) return json(403, { ok: false, denied: true, reason: "not_found" });

      const tier = normalizeTier(entitlement.entitled_tier);
      if (!tier) return json(403, { ok: false, denied: true, reason: "invalid_tier" });

      const status = String(entitlement.subscription_status || "").trim().toLowerCase();
      if (status !== "active" && status !== "trialing") {
        return json(403, { ok: false, denied: true, reason: "not_active" });
      }

      if (entitlement.password_hash) {
        return json(403, { ok: false, denied: true, reason: "password_already_set" });
      }

      await updatePasswordHash(email, hashPassword(password));

      const setCookie = createSessionCookie({ email, tier });
      const redirectTo = tier === 'Black' ? '/app-black.html' : tier === 'Pro' ? '/app-pro.html' : '/app-core.html';
      return json(200, { ok: true, tier, redirectTo }, { "set-cookie": setCookie });

    } catch {
      return json(500, { ok: false, denied: true, reason: "server_error" });
    }
  };
}

function createRuntimeHandler(overrides = {}) {
  const store             = overrides.store      || createEntitlementStore();
  const runtimeSessionLib = overrides.sessionLib || sessionLib;

  return createHandler({
    findEntitlementByEmail: (email) => store.findEntitlementByEmail(email),
    updatePasswordHash:     (email, hash) => store.updatePasswordHash(email, hash),
    createSessionCookie:    (session) => runtimeSessionLib.createSessionCookie(session),
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch {
    return json(500, { ok: false, denied: true, reason: "server_error" });
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
