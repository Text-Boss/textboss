const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const sig =
    event.headers["stripe-signature"] ||
    event.headers["Stripe-Signature"];

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Only process real checkout completions for subscriptions
  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "Event ignored." };
  }

  try {
    const session = stripeEvent.data.object;

    const email = session?.customer_details?.email || null;
    const subId = session?.subscription || null;

    if (!email || !subId) {
      return { statusCode: 200, body: "Missing email or subscription." };
    }

    const subscription = await stripe.subscriptions.retrieve(subId);

    const priceId = subscription?.items?.data?.[0]?.price?.id || null;
    if (!priceId) {
      return { statusCode: 200, body: "Missing price ID." };
    }

    let tier = null;
    if (priceId === process.env.STRIPE_PRICE_CORE) tier = "Core";
    else if (priceId === process.env.STRIPE_PRICE_PRO) tier = "Pro";
    else if (priceId === process.env.STRIPE_PRICE_BLACK) tier = "Black";

    if (!tier) {
      return { statusCode: 200, body: `Unknown price: ${priceId}` };
    }

    const cpe = subscription?.current_period_end;
    const currentPeriodEnd =
      typeof cpe === "number" && Number.isFinite(cpe)
        ? new Date(cpe * 1000).toISOString()
        : null;

    const payload = {
      email,
      stripe_customer_id: subscription.customer || null,
      stripe_subscription_id: subscription.id || null,
      price_id: priceId,
      entitled_tier: tier,
      subscription_status: subscription.status || "unknown",
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("entitlements")
      .upsert(payload, { onConflict: "email" });

    if (error) {
      return { statusCode: 200, body: `Supabase error: ${error.message}` };
    }

    return { statusCode: 200, body: `Stored: ${email} -> ${tier}` };
  } catch (err) {
    // Never throw; prevent 502 retries
    return { statusCode: 200, body: `Handled error: ${err.message}` };
  }
};
