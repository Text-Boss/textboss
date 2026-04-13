const { createBusyBlockStore, createEntitlementStore } = require("./_lib/supabase");
const sessionLib    = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");
const { json, denied } = require("./_lib/http");

const SCHEDULING_TIERS = new Set(["Pro", "Black"]);
// Maximum stored busy blocks per tier (Pro is capped, Black is not)
const BLOCK_LIMITS = { Pro: 200, Black: Infinity };

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function createHandler(deps) {
  const { verifySessionCookie, findEntitlementByEmail, busyBlockStore } = deps;

  async function authorize(headers) {
    let v;
    try { v = verifySessionCookie(headers); }
    catch { return { session: null, tier: null, error: denied(401, "missing_session") }; }
    if (!v.ok) return { session: null, tier: null, error: denied(401, v.reason) };

    const entitlement = await findEntitlementByEmail(v.session.email);
    if (!entitlement) return { session: null, tier: null, error: denied(403, "not_found") };

    const status = normalizeStatus(entitlement.subscription_status);
    if (status !== "active" && status !== "trialing") {
      return { session: null, tier: null, error: denied(403, "not_active") };
    }

    const tier = normalizeTier(entitlement.entitled_tier);
    if (!SCHEDULING_TIERS.has(tier)) {
      return { session: null, tier: null, error: denied(403, "tier_not_entitled") };
    }

    return { session: v.session, tier, error: null };
  }

  return async function handler(event) {
    const { session, tier, error } = await authorize(event.headers || {});
    if (error) return error;

    // ── GET: list upcoming busy blocks ──────────────────────────────────────
    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      const today = new Date().toISOString().split("T")[0];
      const blocks = await busyBlockStore.listBusyBlocks(
        session.email,
        params.start || today,
        params.end   || null
      );
      return json(200, { ok: true, blocks });
    }

    // ── POST: create one or more busy blocks ────────────────────────────────
    if (event.httpMethod === "POST") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return json(400, { ok: false, reason: "invalid_json" }); }

      const incoming = Array.isArray(body.blocks) ? body.blocks : [];
      if (incoming.length === 0) return json(400, { ok: false, reason: "no_blocks" });
      if (incoming.length > 500) return json(400, { ok: false, reason: "too_many_blocks" });

      // Enforce per-tier total cap
      const limit = BLOCK_LIMITS[tier];
      if (isFinite(limit)) {
        const existing = await busyBlockStore.countBusyBlocks(session.email);
        if (existing + incoming.length > limit) {
          return json(400, { ok: false, reason: "block_limit_reached", limit });
        }
      }

      const source       = ["ical_import", "ai_parsed", "manual"].includes(body.source)
        ? body.source : "manual";
      const importBatch  = body.import_batch || null;

      const validated = [];
      for (const b of incoming) {
        if (!b.block_date || !b.start_time || !b.end_time) continue;
        validated.push({
          block_date:   String(b.block_date).slice(0, 10),
          start_time:   String(b.start_time).slice(0, 5),
          end_time:     String(b.end_time).slice(0, 5),
          label:        b.label ? String(b.label).slice(0, 120) : null,
          source,
          import_batch: importBatch,
        });
      }

      if (validated.length === 0) {
        return json(400, { ok: false, reason: "no_valid_blocks" });
      }

      const created = await busyBlockStore.createBusyBlocks(session.email, validated);
      return json(200, { ok: true, created: created.length, blocks: created });
    }

    // ── DELETE: remove by id or by import_batch ─────────────────────────────
    if (event.httpMethod === "DELETE") {
      const params = event.queryStringParameters || {};

      if (params.batch) {
        await busyBlockStore.deleteBusyBlocksByBatch(params.batch, session.email);
        return json(200, { ok: true });
      }

      if (params.id) {
        await busyBlockStore.deleteBusyBlock(params.id, session.email);
        return json(200, { ok: true });
      }

      return json(400, { ok: false, reason: "missing_id_or_batch" });
    }

    return json(405, { ok: false, reason: "method_not_allowed" });
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore = overrides.entitlementStore || createEntitlementStore();
  const busyBlockStore   = overrides.busyBlockStore   || createBusyBlockStore();
  const runtimeSessionLib = overrides.sessionLib      || sessionLib;

  return createHandler({
    verifySessionCookie:    (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e) => entitlementStore.findEntitlementByEmail(e),
    busyBlockStore,
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    return json(500, { ok: false, reason: "server_error" });
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
