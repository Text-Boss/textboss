const { createEntitlementStore, createFollowUpStore } = require("./_lib/supabase");
const sessionLib    = require("./_lib/session");
const { normalizeTier, isFollowUpTier, getFollowUpLimit, getFollowUpSystemPrompt, getTierPolicy } = require("./_lib/tier-policy");
const { createResponsesClient } = require("./_lib/openai");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function deny(statusCode, reason) {
  return json(statusCode, { ok: false, denied: statusCode === 401 || statusCode === 403, reason });
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_MESSAGE_ACTIONS = new Set(["sent", "skipped"]);

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildUserMessage(body) {
  const parts = [`Client: ${body.client_name}`, `Service: ${body.service_name}`, `Date completed: ${body.service_date}`];
  if (body.notes)          parts.push(`Notes: ${body.notes}`);
  if (body.review_link)    parts.push(`Review link: ${body.review_link}`);
  if (body.rebooking_link) parts.push(`Rebooking link: ${body.rebooking_link}`);
  return parts.join("\n");
}

function createHandler(deps) {
  const {
    verifySessionCookie,
    findEntitlementByEmail,
    countActiveJobs,
    createJob,
    createMessages,
    listJobs,
    listMessages,
    listPendingMessages,
    markSent,
    skipMessage,
    updateJob,
    callOpenAI,
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

    if (!isFollowUpTier(auth.tier)) {
      return deny(403, "tier_not_entitled");
    }

    // ── GET: list jobs or pending messages ──────────────────────────────────
    if (method === "GET") {
      if (params.pending === "true") {
        const today = new Date().toISOString().split("T")[0];
        const messages = await listMessages(auth.session.email, { status: "pending" });
        return json(200, { ok: true, messages });
      }
      if (params.messages === "true" && params.jobId) {
        const messages = await listMessages(auth.session.email, { jobId: params.jobId });
        return json(200, { ok: true, messages });
      }
      const jobs = await listJobs(auth.session.email);
      return json(200, { ok: true, jobs });
    }

    // ── POST: log service completion + generate AI follow-up drafts ────────
    if (method === "POST") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return deny(400, "invalid_json"); }

      if (!body.client_name || typeof body.client_name !== "string" || !body.client_name.trim()) {
        return deny(400, "missing_client_name");
      }
      if (!body.service_name || typeof body.service_name !== "string" || !body.service_name.trim()) {
        return deny(400, "missing_service_name");
      }
      if (!body.service_date || !DATE_RE.test(body.service_date)) {
        return deny(400, "invalid_service_date");
      }

      // Check tier limit
      const limit = getFollowUpLimit(auth.tier);
      if (limit !== Infinity) {
        const activeCount = await countActiveJobs(auth.session.email);
        if (activeCount >= limit) {
          return deny(403, "follow_up_limit_reached");
        }
      }

      // Call OpenAI for follow-up drafts
      const systemPrompt = getFollowUpSystemPrompt(auth.tier);
      const userMessage = buildUserMessage(body);
      const aiOutput = await callOpenAI(auth.tier, systemPrompt, userMessage);

      // Parse JSON from AI response
      let drafts;
      try {
        drafts = JSON.parse(aiOutput);
        if (!Array.isArray(drafts) || drafts.length === 0) {
          throw new Error("Expected non-empty array");
        }
        for (const d of drafts) {
          if (typeof d.delay_days !== "number" || !d.purpose || !d.draft) {
            throw new Error("Invalid draft structure");
          }
        }
      } catch {
        return deny(502, "ai_parse_error");
      }

      // Insert job
      const job = await createJob(auth.session.email, body);

      // Compute send dates and insert messages
      const normalized = String(auth.session.email || "").trim().toLowerCase();
      const messageRows = drafts.map((d) => ({
        job_id:        job.id,
        owner_email:   normalized,
        send_date:     addDays(body.service_date, d.delay_days),
        purpose:       d.purpose,
        draft_message: d.draft,
        status:        "pending",
      }));

      const messages = await createMessages(messageRows);

      return json(200, { ok: true, job, messages });
    }

    // ── PATCH: mark message as sent or skipped ─────────────────────────────
    if (method === "PATCH") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return deny(400, "invalid_json"); }

      if (!body.messageId) {
        return deny(400, "missing_message_id");
      }
      if (!body.action || !VALID_MESSAGE_ACTIONS.has(body.action)) {
        return deny(400, "invalid_action");
      }

      if (body.action === "sent") {
        await markSent(body.messageId, auth.session.email);
      } else {
        await skipMessage(body.messageId, auth.session.email);
      }

      return json(200, { ok: true, updated: true });
    }

    // ── DELETE: cancel a job and skip remaining messages ────────────────────
    if (method === "DELETE") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return deny(400, "invalid_json"); }

      if (!body.jobId) {
        return deny(400, "missing_job_id");
      }

      await updateJob(body.jobId, auth.session.email, { status: "cancelled" });

      return json(200, { ok: true, cancelled: true });
    }

    return deny(405, "method_not_allowed");
  };
}

function createRuntimeHandler(overrides = {}) {
  const entitlementStore = overrides.entitlementStore || createEntitlementStore();
  const followUpStore    = overrides.followUpStore    || createFollowUpStore();
  const runtimeSessionLib = overrides.sessionLib      || sessionLib;
  const openaiClient     = overrides.openaiClient     || createResponsesClient();

  return createHandler({
    verifySessionCookie:    (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e) => entitlementStore.findEntitlementByEmail(e),
    countActiveJobs:        (e) => followUpStore.countActiveJobs(e),
    createJob:              (e, d) => followUpStore.createJob(e, d),
    createMessages:         (m) => followUpStore.createMessages(m),
    listJobs:               (e) => followUpStore.listJobs(e),
    listMessages:           (e, o) => followUpStore.listMessages(e, o),
    listPendingMessages:    (d) => followUpStore.listPendingMessages(d),
    markSent:               (id, e) => followUpStore.markSent(id, e),
    skipMessage:            (id, e) => followUpStore.skipMessage(id, e),
    updateJob:              (id, e, u) => followUpStore.updateJob(id, e, u),
    callOpenAI:             async (tier, systemPrompt, userMessage) => {
      const policy = getTierPolicy(tier);
      const result = await openaiClient.createResponse({
        tier,
        message: userMessage,
        conversation: [],
        policy: { instructions: systemPrompt, responseMaxTokens: policy.responseMaxTokens },
      });
      return result.output;
    },
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
