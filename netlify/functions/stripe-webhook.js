const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const sig = event.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      webhookSecret
    );
  } catch (err) {
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`,
    };
  }

  // Only care about subscription events
  if (
    stripeEvent.type === "checkout.session.completed" ||
    stripeEvent.type === "customer.subscription.updated" ||
    stripeEvent.type === "customer.subscription.created"
  ) {
    let subscription;

    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      if (!session.subscription) {
        return { statusCode: 200, body: "No subscription attached." };
      }
      subscription = await stripe.subscriptions.retrieve(session.subscription);
    } else {
      subscription = stripeEvent.data.object;
    }

    const customer = await stripe.customers.retrieve(subscription.customer);
    const email = customer.email;

    const priceId = subscription.items.data[0].price.id;

    let entitledTier = null;

    if (priceId === process.env.STRIPE_PRICE_CORE) {
      entitledTier = "Core";
    } else if (priceId === process.env.STRIPE_PRICE_PRO) {
      entitledTier = "Pro";
    } else if (priceId === process.env.STRIPE_PRICE_BLACK) {
      entitledTier = "Black";
    }

    if (!entitledTier) {
      return { statusCode: 200, body: "Unknown price ID." };
    }

    await supabase.from("entitlements").upsert({
      email: email,
      stripe_customer_id: subscription.customer,
      stripe_subscription_id: subscription.id,
      price_id: priceId,
      entitled_tier: entitledTier,
      subscription_status: subscription.status,
      current_period_end: new Date(
        subscription.current_period_end * 1000
      ).toISOString(),
      updated_at: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      body: `Entitlement updated for ${email}`,
    };
  }

  return {
    statusCode: 200,
    body: "Event ignored.",
  };
};
