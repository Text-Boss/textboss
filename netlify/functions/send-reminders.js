const { createServiceRoleClient } = require("./_lib/supabase");

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

function createHandler(deps) {
  const {
    verifyScheduledAccess,
    findUpcomingUnreminded,
    markReminded,
  } = deps;

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return deny(405, "method_not_allowed");
    }

    const accessResult = verifyScheduledAccess(event);
    if (!accessResult.ok) {
      return deny(403, accessResult.reason);
    }

    const appointments = await findUpcomingUnreminded();

    if (appointments.length === 0) {
      return json(200, { ok: true, reminded: [], count: 0 });
    }

    const reminded = [];
    for (const appt of appointments) {
      await markReminded(appt.id);
      reminded.push({
        id: appt.id,
        owner_email: appt.owner_email,
        client_name: appt.client_name,
        client_contact: appt.client_contact,
        title: appt.title,
        scheduled_date: appt.scheduled_date,
        scheduled_time: appt.scheduled_time,
      });
    }

    return json(200, {
      ok: true,
      reminded,
      count: reminded.length,
    });
  };
}

function createRuntimeHandler(overrides = {}) {
  let _supabase;
  function getSupabase() {
    if (!_supabase) {
      _supabase = overrides.supabase || createServiceRoleClient();
    }
    return _supabase;
  }

  return createHandler({
    verifyScheduledAccess: (event) => {
      // Allow Netlify scheduled function invocations (background function header)
      // or a shared secret token passed via Authorization header
      const headers = event.headers || {};

      // Netlify scheduled functions set this header
      if (headers["x-nf-event"] === "schedule") {
        return { ok: true };
      }

      // Fallback: require a shared secret
      const authHeader = headers.authorization || headers.Authorization || "";
      const expectedToken = process.env.REMINDERS_SECRET;
      if (expectedToken && authHeader === `Bearer ${expectedToken}`) {
        return { ok: true };
      }

      return { ok: false, reason: "unauthorized" };
    },

    findUpcomingUnreminded: async () => {
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const todayDate = now.toISOString().split("T")[0];
      const tomorrowDate = in24h.toISOString().split("T")[0];

      // Find confirmed appointments scheduled within the next 24h
      // that have not yet been flagged for reminder
      const { data, error } = await getSupabase()
        .from("appointments")
        .select("id, owner_email, client_name, client_contact, title, scheduled_date, scheduled_time")
        .eq("status", "confirmed")
        .is("reminder_sent_at", null)
        .gte("scheduled_date", todayDate)
        .lte("scheduled_date", tomorrowDate)
        .order("scheduled_date", { ascending: true })
        .order("scheduled_time", { ascending: true });

      if (error) throw error;
      return data || [];
    },

    markReminded: async (appointmentId) => {
      const { error } = await getSupabase()
        .from("appointments")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", appointmentId);

      if (error) throw error;
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
