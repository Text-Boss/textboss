/**
 * booking-auth.js
 *
 * Shared booking-tier middleware for Netlify Functions.
 *
 * Pattern used across all scheduling endpoints:
 *   1. Verify the HMAC-signed session cookie (never trust the client claim alone).
 *   2. Re-read Supabase entitlements on every request (subscription may have lapsed).
 *   3. Cross-check session tier against DB tier — mismatch = deny.
 *   4. Gate on SCHEDULING_TIERS; Core users receive { ok:false, denied:true }.
 *
 * Returns a plain result object so callers can decide their own response shape.
 *
 * Usage:
 *   const { verifyBookingAccess } = require("./_lib/booking-auth");
 *
 *   const auth = await verifyBookingAccess(event, { verifySessionCookie, findEntitlementByEmail });
 *   if (auth.error) return auth.error;   // already a valid Netlify response object
 *   const { session, tier } = auth;       // safe to use
 */

const { denied } = require("./http");
const { normalizeTier } = require("./tier-policy");

const SCHEDULING_TIERS = new Set(["Pro", "Black"]);

/**
 * History limits per tier — how many past appointments to surface in the UI
 * and how many the AI scheduling context receives.
 *
 * Black subscribers get a deeper view (10) vs Pro (5) to support
 * the premium personalised-history experience.
 */
const APPOINTMENT_HISTORY_LIMIT = {
  Pro: 50,
  Black: null, // null = unlimited
};

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * @param {object} event           - Netlify function event
 * @param {object} deps
 * @param {Function} deps.verifySessionCookie     - from _lib/session.js
 * @param {Function} deps.findEntitlementByEmail  - from createEntitlementStore()
 * @returns {Promise<{error?: object, session?: object, tier?: string}>}
 */
async function verifyBookingAccess(event, deps) {
  const { verifySessionCookie, findEntitlementByEmail } = deps;

  // Step 1 — verify the signed cookie
  const verification = verifySessionCookie(event.headers || {});
  if (!verification.ok) {
    return { error: denied(401, verification.reason) };
  }

  const session = verification.session;

  // Step 2 — re-read entitlements from Supabase (never trust cookie tier alone)
  const entitlement = await findEntitlementByEmail(session.email);
  if (!entitlement) {
    return { error: denied(403, "not_found") };
  }

  const status = normalizeStatus(entitlement.subscription_status);
  if (status !== "active" && status !== "trialing") {
    return { error: denied(403, "not_active") };
  }

  // Step 3 — cross-check cookie tier against DB tier
  const entitlementTier = normalizeTier(entitlement.entitled_tier);
  const sessionTier = normalizeTier(session.tier);

  if (!entitlementTier || !sessionTier || entitlementTier !== sessionTier) {
    return { error: denied(403, "invalid_tier") };
  }

  // Step 4 — require a scheduling-capable tier
  if (!SCHEDULING_TIERS.has(entitlementTier)) {
    return { error: denied(403, "tier_not_entitled") };
  }

  return { session, tier: entitlementTier };
}

/**
 * Returns how many historical appointments to load for this tier.
 * Used by both the AI context builder and the UI appointment list.
 */
function getHistoryLimit(tier) {
  const normalized = normalizeTier(tier);
  if (!(normalized in APPOINTMENT_HISTORY_LIMIT)) return 50;
  return APPOINTMENT_HISTORY_LIMIT[normalized]; // null = unlimited
}

/**
 * Returns whether this tier gets the Black premium experience:
 * deeper history, gold-accent UI, personalised greeting.
 */
function isBlackTier(tier) {
  return normalizeTier(tier) === "Black";
}

exports.verifyBookingAccess = verifyBookingAccess;
exports.getHistoryLimit = getHistoryLimit;
exports.isBlackTier = isBlackTier;
exports.SCHEDULING_TIERS = SCHEDULING_TIERS;
