const { createEntitlementStore, createPasswordResetTokenStore } = require("./_lib/supabase");
const sessionLib = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");
const { hashPassword } = require("./_lib/password");
const { json, denied } = require("./_lib/http");

function createHandler(deps) {
  const { findToken, markTokenUsed, findEntitlementByEmail, updatePasswordHash, createSessionCookie } = deps;

  return async function handler(event) {
    try {
      if (event.httpMethod !== "POST") {
        return denied(405, "method_not_allowed");
      }

      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; } catch {
        return denied(400, "invalid_json");
      }

      const token           = String(body.token           || "").trim();
      const password        = String(body.password        || "");
      const confirmPassword = String(body.confirmPassword || "");

      if (!token)    return denied(400, "missing_token");
      if (!password) return denied(400, "missing_password");
      if (password !== confirmPassword) return denied(400, "password_mismatch");
      if (password.length < 8) return denied(400, "password_too_short");

      const tokenRecord = await findToken(token);
      if (!tokenRecord)        return denied(403, "invalid_token");
      if (tokenRecord.used_at) return denied(403, "token_used");
      if (new Date(tokenRecord.expires_at) < new Date()) {
        return denied(403, "token_expired");
      }

      const entitlement = await findEntitlementByEmail(tokenRecord.email);
      if (!entitlement) return denied(403, "not_found");

      const tier = normalizeTier(entitlement.entitled_tier);
      if (!tier) return denied(403, "invalid_tier");

      const status = String(entitlement.subscription_status || "").trim().toLowerCase();
      if (status !== "active" && status !== "trialing") {
        return denied(403, "not_active");
      }

      await updatePasswordHash(tokenRecord.email, hashPassword(password));
      await markTokenUsed(token);

      const setCookie = createSessionCookie({ email: tokenRecord.email, tier });
      return json(200, { ok: true, tier, redirectTo: `/app-${tier.toLowerCase()}.html` }, { "set-cookie": setCookie });

    } catch (err) {
      console.error("[reset-password] error:", err?.message || err);
      return denied(500, "server_error");
    }
  };
}

function createRuntimeHandler(overrides = {}) {
  try {
    const entitlementStore = overrides.entitlementStore || createEntitlementStore();
    const tokenStore       = overrides.tokenStore       || createPasswordResetTokenStore();
    const runtimeSessionLib = overrides.sessionLib || sessionLib;

    return createHandler({
      findToken:              (token) => tokenStore.findToken(token),
      markTokenUsed:          (token) => tokenStore.markTokenUsed(token),
      findEntitlementByEmail: (email) => entitlementStore.findEntitlementByEmail(email),
      updatePasswordHash:     (email, hash) => entitlementStore.updatePasswordHash(email, hash),
      createSessionCookie:    (session) => runtimeSessionLib.createSessionCookie(session),
    });
  } catch (err) {
    console.error("[reset-password] init error:", err);
    return async () => denied(500, "internal_error");
  }
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    console.error("[reset-password] unhandled error:", err?.message || err);
    return denied(500, "server_error");
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
