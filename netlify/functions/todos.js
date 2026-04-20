"use strict";

const { createTodoStore }            = require("./_lib/supabase");
const { json, denied }               = require("./_lib/http");
const { verifyBookingAccess }        = require("./_lib/booking-auth");
const sessionLib                     = require("./_lib/session");
const { createEntitlementStore }     = require("./_lib/supabase");

function createHandler(deps) {
  const { verifySessionCookie, findEntitlementByEmail, listTodos, createTodo, updateTodo, deleteTodo } = deps;

  return async function handler(event) {
    const method = event.httpMethod;

    // All tiers can use todos — just need a valid session
    let verification;
    try { verification = verifySessionCookie(event.headers || {}); }
    catch { return denied(401, "missing_session"); }
    if (!verification.ok) return denied(401, verification.reason);

    const session = verification.session;

    let entitlement;
    try { entitlement = await findEntitlementByEmail(session.email); }
    catch { return denied(500, "entitlement_lookup_failed"); }
    if (!entitlement) return denied(403, "not_found");

    const status = String(entitlement.subscription_status || "").toLowerCase();
    if (status !== "active" && status !== "trialing") return denied(403, "not_active");

    const email = session.email;
    const tier  = String(session.tier || "").trim();
    const canRemind = tier === "Pro" || tier === "Black";

    if (method === "GET") {
      const todos = await listTodos(email);
      return json(200, { ok: true, todos });
    }

    if (method === "POST") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return denied(400, "invalid_json"); }

      const text = String(body.text || "").trim();
      if (!text) return denied(400, "text_required");
      if (text.length > 2000) return denied(400, "text_too_long");

      const is_urgent   = Boolean(body.is_urgent);
      const reminder_at = canRemind && body.reminder_at ? body.reminder_at : null;

      const todo = await createTodo(email, { text, is_urgent, reminder_at });
      return json(201, { ok: true, todo });
    }

    if (method === "PATCH") {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return denied(400, "missing_id");

      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return denied(400, "invalid_json"); }

      const updates = {};
      if (body.text      !== undefined) updates.text       = body.text;
      if (body.is_done   !== undefined) updates.is_done    = body.is_done;
      if (body.is_urgent !== undefined) updates.is_urgent  = body.is_urgent;
      if (body.reminder_at !== undefined) updates.reminder_at = canRemind ? body.reminder_at : null;

      if (Object.keys(updates).length === 0) return denied(400, "no_fields_to_update");

      const todo = await updateTodo(id, email, updates);
      return json(200, { ok: true, todo });
    }

    if (method === "DELETE") {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return denied(400, "missing_id");
      await deleteTodo(id, email);
      return json(200, { ok: true });
    }

    return denied(405, "method_not_allowed");
  };
}

function createRuntimeHandler(overrides = {}) {
  const todoStore        = overrides.todoStore        || createTodoStore();
  const entitlementStore = overrides.entitlementStore || createEntitlementStore();
  const runtimeSessionLib = overrides.sessionLib      || sessionLib;

  return createHandler({
    verifySessionCookie:    (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e) => entitlementStore.findEntitlementByEmail(e),
    listTodos:              (e) => todoStore.listTodos(e),
    createTodo:             (e, t) => todoStore.createTodo(e, t),
    updateTodo:             (id, e, u) => todoStore.updateTodo(id, e, u),
    deleteTodo:             (id, e) => todoStore.deleteTodo(id, e),
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    console.error("[todos] unhandled error:", err);
    return denied(500, "server_error");
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
