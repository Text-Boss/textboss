const { createServiceStore } = require("./_lib/supabase");
const { json, denied }       = require("./_lib/http");
const { verifyBookingAccess } = require("./_lib/booking-auth");
const sessionLib             = require("./_lib/session");
const { createEntitlementStore } = require("./_lib/supabase");

function validateServiceBody(body) {
  const errors = [];

  const title = String(body.title || "").trim();
  if (!title) errors.push("title_required");
  else if (title.length > 100) errors.push("title_too_long");

  if (body.duration_min !== undefined) {
    const v = Number(body.duration_min);
    if (!Number.isInteger(v) || v <= 0 || v % 15 !== 0) errors.push("invalid_duration_min");
  }

  if (body.price !== undefined && body.price !== null) {
    const v = Number(body.price);
    if (isNaN(v) || v < 0 || v > 99999.99) errors.push("invalid_price");
  }

  if (body.buffer_time_min !== undefined) {
    const v = Number(body.buffer_time_min);
    if (!Number.isInteger(v) || v < 0 || v > 240) errors.push("invalid_buffer_time_min");
  }

  if (body.description !== undefined && body.description !== null) {
    if (String(body.description).length > 500) errors.push("description_too_long");
  }

  if (body.sort_order !== undefined) {
    const v = Number(body.sort_order);
    if (!Number.isInteger(v) || v < 0) errors.push("invalid_sort_order");
  }

  return errors;
}

function createHandler(deps) {
  const { verifySessionCookie, findEntitlementByEmail, listServices, createService, updateService, deleteService } = deps;

  return async function handler(event) {
    const method = event.httpMethod;

    const auth = await verifyBookingAccess(event, { verifySessionCookie, findEntitlementByEmail });
    if (auth.error) return auth.error;

    const email = auth.session.email;

    // GET — list active services
    if (method === "GET") {
      const services = await listServices(email);
      return json(200, { ok: true, services });
    }

    // POST — create service
    if (method === "POST") {
      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return denied(400, "invalid_json"); }

      const title = String(body.title || "").trim();
      if (!title) return denied(400, "title_required");
      if (title.length > 100) return denied(400, "title_too_long");

      const durationMin = Number(body.duration_min);
      if (!Number.isInteger(durationMin) || durationMin <= 0 || durationMin % 15 !== 0) {
        return denied(400, "invalid_duration_min");
      }

      const errors = validateServiceBody(body);
      if (errors.length > 0) return denied(400, errors[0]);

      const svc = await createService(email, {
        title,
        description:     body.description     != null ? String(body.description).trim() : null,
        duration_min:    durationMin,
        price:           body.price            != null ? Number(body.price)           : null,
        buffer_time_min: body.buffer_time_min  != null ? Number(body.buffer_time_min) : 0,
        sort_order:      body.sort_order       != null ? Number(body.sort_order)      : 0,
      });
      return json(201, { ok: true, service: svc });
    }

    // PATCH — update service fields
    if (method === "PATCH") {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return denied(400, "missing_id");

      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; }
      catch { return denied(400, "invalid_json"); }

      const updates = {};

      if (body.title !== undefined) {
        const t = String(body.title || "").trim();
        if (!t) return denied(400, "title_required");
        if (t.length > 100) return denied(400, "title_too_long");
        updates.title = t;
      }
      if (body.description !== undefined) {
        const d = body.description != null ? String(body.description).trim() : null;
        if (d && d.length > 500) return denied(400, "description_too_long");
        updates.description = d || null;
      }
      if (body.duration_min !== undefined) {
        const v = Number(body.duration_min);
        if (!Number.isInteger(v) || v <= 0 || v % 15 !== 0) return denied(400, "invalid_duration_min");
        updates.duration_min = v;
      }
      if (body.price !== undefined) {
        updates.price = body.price != null ? Number(body.price) : null;
      }
      if (body.buffer_time_min !== undefined) {
        const v = Number(body.buffer_time_min);
        if (!Number.isInteger(v) || v < 0 || v > 240) return denied(400, "invalid_buffer_time_min");
        updates.buffer_time_min = v;
      }
      if (body.sort_order !== undefined) {
        const v = Number(body.sort_order);
        if (!Number.isInteger(v) || v < 0) return denied(400, "invalid_sort_order");
        updates.sort_order = v;
      }

      if (Object.keys(updates).length === 0) return denied(400, "no_fields_to_update");

      const svc = await updateService(id, email, updates);
      return json(200, { ok: true, service: svc });
    }

    // DELETE — soft-delete service
    if (method === "DELETE") {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return denied(400, "missing_id");
      await deleteService(id, email);
      return json(200, { ok: true });
    }

    return denied(405, "method_not_allowed");
  };
}

function createRuntimeHandler(overrides = {}) {
  const serviceStore      = overrides.serviceStore      || createServiceStore();
  const entitlementStore  = overrides.entitlementStore  || createEntitlementStore();
  const runtimeSessionLib = overrides.sessionLib        || sessionLib;

  return createHandler({
    verifySessionCookie:    (h) => runtimeSessionLib.verifySessionCookie(h),
    findEntitlementByEmail: (e) => entitlementStore.findEntitlementByEmail(e),
    listServices:           (e) => serviceStore.listServices(e),
    createService:          (e, s) => serviceStore.createService(e, s),
    updateService:          (id, e, u) => serviceStore.updateService(id, e, u),
    deleteService:          (id, e) => serviceStore.deleteService(id, e),
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    console.error("[services] unhandled error:", err);
    return denied(500, "server_error");
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
