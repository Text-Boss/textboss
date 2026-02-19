const { createClient } = require("@supabase/supabase-js");

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  // Parse body safely
  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const emailRaw = (body.email || "").toString().trim();
  if (!emailRaw) {
    return json(400, { ok: false, error: "missing_email" });
  }

  const email = emailRaw.toLowerCase();

  // Supabase client (service role key must be in Netlify env vars)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Fetch entitlement row
  const { data, error } = await supabase
    .from("entitlements")
    .select(
      "email, entitled_tier, subscription_status, current_period_end, updated_at"
    )
    .eq("email", email)
    .maybeSingle();

  if (error) {
    return json(200, { ok: false, error: "db_error", detail: error.message });
  }

  if (!data) {
    return json(200, { ok: false, error: "not_found" });
  }

  const status = (data.subscription_status || "").toLowerCase();

  // Stripe subscription statuses that should be treated as "paid/valid" access
  const allowed = new Set(["active", "trialing"]);

  if (!allowed.has(status)) {
    return json(200, {
      ok: false,
      error: "not_active",
      subscription_status: data.subscription_status,
    });
  }

  return json(200, {
    ok: true,
    email: data.email,
    tier: data.entitled_tier,
    subscription_status: data.subscription_status,
    current_period_end: data.current_period_end,
    updated_at: data.updated_at,
  });
};
