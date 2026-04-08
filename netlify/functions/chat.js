const { createEntitlementStore, createServiceRoleClient } = require("./_lib/supabase");
const sessionLib = require("./_lib/session");
const tierPolicyLib = require("./_lib/tier-policy");
const { createResponsesClient } = require("./_lib/openai");
const { normalizeTier, getThreadLimit } = require("./_lib/tier-policy");

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

function deny(statusCode, reason) {
  return json(statusCode, {
    ok: false,
    denied: true,
    reason,
  });
}

function createHandler(deps) {
  const {
    verifySessionCookie,
    findEntitlementByEmail,
    getTierPolicy,
    createResponse,
    loadThreadMessages,
    saveMessage,
    getThreadMessageCount,
    generateThreadTitle,
    updateThreadTitle,
    updateThreadTimestamp,
    enforceThreadLimit,
  } = deps;

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return deny(405, "method_not_allowed");
    }

    const verification = verifySessionCookie(event.headers || {});
    if (!verification.ok) {
      return deny(401, verification.reason);
    }

    let body;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return deny(400, "invalid_json");
    }

    const message = String(body.message || "").trim();
    if (!message) {
      return deny(400, "missing_message");
    }

    const threadId = body.threadId || null;

    const session = verification.session;
    const entitlement = await findEntitlementByEmail(session.email);
    if (!entitlement) {
      return deny(403, "not_found");
    }

    if (normalizeStatus(entitlement.subscription_status) !== "active" &&
        normalizeStatus(entitlement.subscription_status) !== "trialing") {
      return deny(403, "not_active");
    }

    const entitlementTier = normalizeTier(entitlement.entitled_tier);
    const sessionTier = normalizeTier(session.tier);

    if (!entitlementTier || !sessionTier || entitlementTier !== sessionTier) {
      return deny(403, "invalid_tier");
    }

    const policy = getTierPolicy(sessionTier);

    if (message.length > policy.inputLimit) {
      return deny(400, "message_too_long");
    }

    let conversation = Array.isArray(body.conversation) ? body.conversation : [];

    if (threadId && loadThreadMessages) {
      const storedMessages = await loadThreadMessages(threadId, session.email);
      if (storedMessages && storedMessages.length > 0) {
        conversation = storedMessages.map(function (m) {
          if (m.role === "user") {
            return {
              role: "user",
              content: [{ type: "input_text", text: m.content }],
            };
          }

          return {
            role: "assistant",
            content: [{ type: "output_text", text: m.content }],
          };
        });
      }
    }

    const response = await createResponse({
      tier: sessionTier,
      message,
      conversation,
      policy,
    });

    if (threadId && saveMessage) {
      await saveMessage(threadId, "user", message);
      await saveMessage(threadId, "assistant", response.output);

      if (updateThreadTimestamp) {
        await updateThreadTimestamp(threadId);
      }

      if (getThreadMessageCount && generateThreadTitle && updateThreadTitle) {
        const count = await getThreadMessageCount(threadId);
        if (count <= 2) {
          const title = await generateThreadTitle(message);
          if (title) {
            await updateThreadTitle(threadId, title);
          }
        }
      }

      if (enforceThreadLimit) {
        await enforceThreadLimit(session.email, sessionTier);
      }
    }

    const result = {
      ok: true,
      tier: sessionTier,
      output: response.output,
      usage: response.usage,
    };

    if (threadId) {
      result.threadId = threadId;
    }

    return json(200, result);
  };
}

async function notImplemented() {
  throw new Error("chat dependencies are not configured");
}

function createRuntimeHandler(overrides = {}) {
  const store = overrides.store || createEntitlementStore();
  const runtimeSessionLib = overrides.sessionLib || sessionLib;
  const runtimeTierPolicyLib = overrides.tierPolicyLib || tierPolicyLib;
  const openaiClient = overrides.openaiClient || createResponsesClient();

  let _supabase;
  function getSupabase() {
    if (!_supabase) {
      _supabase = overrides.supabase || createServiceRoleClient();
    }
    return _supabase;
  }

  return createHandler({
    verifySessionCookie: (headers) => runtimeSessionLib.verifySessionCookie(headers),
    findEntitlementByEmail: (email) => store.findEntitlementByEmail(email),
    getTierPolicy: (tier) => runtimeTierPolicyLib.getTierPolicy(tier),
    createResponse: (input) => openaiClient.createResponse(input),

    loadThreadMessages: async (threadId, email) => {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const { data: thread } = await getSupabase()
        .from("threads")
        .select("id")
        .eq("id", threadId)
        .ilike("email", normalizedEmail)
        .maybeSingle();

      if (!thread) {
        return [];
      }

      const { data, error } = await getSupabase()
        .from("messages")
        .select("role, content")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      if (error) {
        return [];
      }

      return data || [];
    },

    saveMessage: async (threadId, role, content) => {
      await getSupabase()
        .from("messages")
        .insert({ thread_id: threadId, role, content });
    },

    getThreadMessageCount: async (threadId) => {
      const { count, error } = await getSupabase()
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", threadId);

      if (error) {
        return 999;
      }

      return count || 0;
    },

    generateThreadTitle: async (firstMessage) => {
      try {
        const titleResponse = await openaiClient.createResponse({
          tier: "Core",
          message: firstMessage,
          conversation: [],
          policy: {
            instructions: "You are a title generator. Given the user message, produce a short title of 6 words or fewer that summarizes what the user is asking about. Output only the title text, nothing else. No quotes, no punctuation at the end.",
            responseMaxTokens: 30,
          },
        });

        return (titleResponse.output || "").trim().slice(0, 100);
      } catch {
        return "";
      }
    },

    updateThreadTitle: async (threadId, title) => {
      await getSupabase()
        .from("threads")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", threadId);
    },

    updateThreadTimestamp: async (threadId) => {
      await getSupabase()
        .from("threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", threadId);
    },

    enforceThreadLimit: async (email, tier) => {
      const limit = getThreadLimit(tier);
      if (limit === Infinity) {
        return;
      }

      const normalizedEmail = String(email || "").trim().toLowerCase();
      const { data: threads, error } = await getSupabase()
        .from("threads")
        .select("id")
        .ilike("email", normalizedEmail)
        .order("updated_at", { ascending: false });

      if (error || !threads) {
        return;
      }

      if (threads.length <= limit) {
        return;
      }

      const idsToDelete = threads.slice(limit).map(function (t) { return t.id; });

      for (const id of idsToDelete) {
        await getSupabase().from("messages").delete().eq("thread_id", id);
        await getSupabase().from("threads").delete().eq("id", id);
      }
    },
  });
}

async function handler(event, context) {
  try {
    const runtimeHandler = createRuntimeHandler();
    return runtimeHandler(event, context);
  } catch {
    return deny(500, "server_error");
  }
}

exports.createHandler = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler = handler;
