const crypto = require("node:crypto");
const { createEntitlementStore, createBusinessProfileStore } = require("./_lib/supabase");
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
    getProfile,
    upsertProfile,
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

    // ── GET: return current profile ──────────────────────────────────────────
    if (method === "GET") {
      const profile = await getProfile(auth.session.email);
      return json(200, { ok: true, profile: profile || null });
    }

    // ── POST: upsert profile fields ──────────────────────────────────────────
    if (method === "POST") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return deny(400, "invalid_json"); }

      const updates = {};

      if (body.occupation !== undefined) {
        updates.occupation = String(body.occupation || "").trim() || null;
      }

      if (body.services !== undefined) {
        if (!Array.isArray(body.services)) return deny(400, "services_must_be_array");
        for (const svc of body.services) {
          if (typeof svc !== "object" || !svc.name || typeof svc.duration_minutes !== "number") {
            return deny(400, "invalid_service_entry");
          }
        }
        updates.services = body.services;
      }

      if (body.buffer_before_minutes !== undefined) {
        const v = Number(body.buffer_before_minutes);
        if (!Number.isInteger(v) || v < 0 || v > 240) return deny(400, "invalid_buffer_before");
        updates.buffer_before_minutes = v;
      }

      if (body.buffer_after_minutes !== undefined) {
        const v = Number(body.buffer_after_minutes);
        if (!Number.isInteger(v) || v < 0 || v > 240) return deny(400, "invalid_buffer_after");
        updates.buffer_after_minutes = v;
      }

      if (body.working_hours !== undefined) {
        // Accepts null (clear) or object { "1": { start, end }, ... }
        if (body.working_hours !== null) {
          if (typeof body.working_hours !== "object" || Array.isArray(body.working_hours)) {
            return deny(400, "invalid_working_hours");
          }
          for (const [dow, times] of Object.entries(body.working_hours)) {
            const d = parseInt(dow, 10);
            if (isNaN(d) || d < 0 || d > 6) return deny(400, "invalid_working_hours_day");
            if (!times || typeof times.start !== "string" || typeof times.end !== "string") {
              return deny(400, "invalid_working_hours_times");
            }
          }
        }
        updates.working_hours = body.working_hours;
      }

      if (body.onboarding_complete !== undefined) {
        updates.onboarding_complete = Boolean(body.onboarding_complete);
      }

      if (body.booking_slug !== undefined) {
        const slug = String(body.booking_slug || "").trim();
        if (slug && (slug.length < 4 || slug.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(slug))) {
          return deny(400, "invalid_booking_slug");
        }
        updates.booking_slug = slug || null;
      }

      if (body.generateSlug) {
        updates.booking_slug = crypto.randomBytes(6).toString("base64url").slice(0, 8);
      }

      if (body.slot_duration_min !== undefined) {
        const v = Number(body.slot_duration_min);
        if (!Number.isInteger(v) || v <= 0 || v % 15 !== 0 || v > 480) {
          return deny(400, "invalid_slot_duration");
        }
        updates.slot_duration_min = v;
      }

      // Business detail fields (for prompt auto-fill + avatar)
      for (const field of ["business_name", "owner_first_name", "owner_full_name",
                            "business_phone", "website", "abn", "city"]) {
        if (body[field] !== undefined) {
          updates[field] = String(body[field] || "").trim().slice(0, 200) || null;
        }
      }

      if (body.avatar_data !== undefined) {
        // Expect base64 data-URL; cap at 200KB to avoid DB bloat
        const av = String(body.avatar_data || "").trim();
        if (av && av.length > 200_000) return deny(400, "avatar_too_large");
        updates.avatar_data = av || null;
      }

      if (Object.keys(updates).length === 0) {
        return deny(400, "no_fields_to_update");
      }

      const profile = await upsertProfile(auth.session.email, updates);
      return json(200, { ok: true, profile });
    }

    return deny(405, "method_not_allowed");
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore   = overrides.entitlementStore   || createEntitlementStore();
  const profileStore       = overrides.profileStore       || createBusinessProfileStore();
  const runtimeSessionLib  = overrides.sessionLib         || sessionLib;

  return createHandler({
    verifySessionCookie:    (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e) => entitlementStore.findEntitlementByEmail(e),
    getProfile:             (e) => profileStore.getProfile(e),
    upsertProfile:          (e, u) => profileStore.upsertProfile(e, u),
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
