exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }

  const body = JSON.parse(event.body || "{}");

  // MCP sends arguments inside params.arguments
  const email = body?.params?.arguments?.email;

  if (!email) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Email is required"
      })
    };
  }

  const { createClient } = require("@supabase/supabase-js");

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("email", email)
    .eq("subscription_status", "active")
    .single();

  if (error || !data) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        result: {
          ok: false,
          tier: null
        }
      })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      result: {
        ok: true,
        tier: data.tier
      }
    })
  };
};