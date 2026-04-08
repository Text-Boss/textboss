const { createEntitlementStore, createServiceRoleClient } = require("./_lib/supabase");
const sessionLib = require("./_lib/session");
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
    listThreads,
    createThread,
    getThreadWithMessages,
    deleteThread,
  } = deps;

  async function verifySession(event) {
    const verification = verifySessionCookie(event.headers || {});
    if (!verification.ok) {
      return { error: deny(401, verification.reason) };
    }

    const session = verification.session;
    const entitlement = await findEntitlementByEmail(session.email);
    if (!entitlement) {
      return { error: deny(403, "not_found") };
    }

    if (normalizeStatus(entitlement.subscription_status) !== "active" &&
        normalizeStatus(entitlement.subscription_status) !== "trialing") {
      return { error: deny(403, "not_active") };
    }

    const entitlementTier = normalizeTier(entitlement.entitled_tier);
    const sessionTier = normalizeTier(session.tier);

    if (!entitlementTier || !sessionTier || entitlementTier !== sessionTier) {
      return { error: deny(403, "invalid_tier") };
    }

    return { session, tier: sessionTier };
  }

  return async function handler(event) {
    const method = event.httpMethod;
    const params = event.queryStringParameters || {};

    if (method === "GET" && !params.id) {
      const auth = await verifySession(event);
      if (auth.error) {
        return auth.error;
      }

      const limit = getThreadLimit(auth.tier);
      const threads = await listThreads(auth.session.email, limit);

      return json(200, {
        ok: true,
        threads,
      });
    }

    if (method === "GET" && params.id) {
      const auth = await verifySession(event);
      if (auth.error) {
        return auth.error;
      }

      const thread = await getThreadWithMessages(params.id, auth.session.email);
      if (!thread) {
        return deny(404, "thread_not_found");
      }

      return json(200, {
        ok: true,
        thread,
      });
    }

    if (method === "POST") {
      const auth = await verifySession(event);
      if (auth.error) {
        return auth.error;
      }

      const thread = await createThread(auth.session.email, auth.tier);

      return json(200, {
        ok: true,
        thread,
      });
    }

    if (method === "DELETE") {
      if (!params.id) {
        return deny(400, "missing_thread_id");
      }

      const auth = await verifySession(event);
      if (auth.error) {
        return auth.error;
      }

      await deleteThread(params.id, auth.session.email);

      return json(200, {
        ok: true,
        deleted: true,
      });
    }

    return deny(405, "method_not_allowed");
  };
}

function createRuntimeHandler(overrides = {}) {
  const store = overrides.store || createEntitlementStore();
  const runtimeSessionLib = overrides.sessionLib || sessionLib;
  const supabase = overrides.supabase || createServiceRoleClient();

  return createHandler({
    verifySessionCookie: (headers) => runtimeSessionLib.verifySessionCookie(headers),
    findEntitlementByEmail: (email) => store.findEntitlementByEmail(email),

    listThreads: async (email, limit) => {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const query = supabase
        .from("threads")
        .select("id, title, created_at, updated_at")
        .ilike("email", normalizedEmail)
        .order("updated_at", { ascending: false });

      if (limit !== Infinity) {
        query.limit(limit);
      }

      const { data, error } = await query;
      if (error) {
        throw error;
      }

      return data || [];
    },

    createThread: async (email, tier) => {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const { data, error } = await supabase
        .from("threads")
        .insert({
          email: normalizedEmail,
          tier,
          title: "New conversation",
        })
        .select("id, title, created_at, updated_at")
        .single();

      if (error) {
        throw error;
      }

      return data;
    },

    getThreadWithMessages: async (threadId, email) => {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const { data: thread, error: threadError } = await supabase
        .from("threads")
        .select("id, title, created_at, updated_at")
        .eq("id", threadId)
        .ilike("email", normalizedEmail)
        .maybeSingle();

      if (threadError) {
        throw threadError;
      }

      if (!thread) {
        return null;
      }

      const { data: messages, error: messagesError } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      if (messagesError) {
        throw messagesError;
      }

      return {
        ...thread,
        messages: messages || [],
      };
    },

    deleteThread: async (threadId, email) => {
      const normalizedEmail = String(email || "").trim().toLowerCase();

      await supabase
        .from("messages")
        .delete()
        .eq("thread_id", threadId);

      await supabase
        .from("threads")
        .delete()
        .eq("id", threadId)
        .ilike("email", normalizedEmail);
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
