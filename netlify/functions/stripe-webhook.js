const Stripe = require("stripe");
const { createServiceRoleClient } = require("./_lib/supabase");

function tierFromPriceId(priceId, priceIds) {
  if (priceId === priceIds.Core) return "Core";
  if (priceId === priceIds.Pro) return "Pro";
  if (priceId === priceIds.Black) return "Black";
  return null;
}

function toIsoTimestamp(unixSeconds) {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) {
    return null;
  }

  return new Date(unixSeconds * 1000).toISOString();
}

function createStore(client = createServiceRoleClient()) {
  return {
    async findEntitlementByStripeRefs(subscriptionId, customerId) {
      if (subscriptionId) {
        const { data, error } = await client
          .from("entitlements")
          .select("email")
          .eq("stripe_subscription_id", subscriptionId)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (data?.email) {
          return data;
        }
      }

      if (customerId) {
        const { data, error } = await client
          .from("entitlements")
          .select("email")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (data?.email) {
          return data;
        }
      }

      return null;
    },
    async upsertEntitlement(payload) {
      const { error } = await client
        .from("entitlements")
        .upsert(payload, { onConflict: "email" });

      if (error) {
        throw error;
      }
    },
  };
}

function normalizePayload({ email, subscription, priceIds }) {
  const priceId = subscription?.items?.data?.[0]?.price?.id || null;
  const tier = tierFromPriceId(priceId, priceIds);

  if (!email || !priceId || !tier) {
    return null;
  }

  return {
    email: String(email).trim().toLowerCase(),
    stripe_customer_id: subscription.customer || null,
    stripe_subscription_id: subscription.id || null,
    price_id: priceId,
    entitled_tier: tier,
    subscription_status: subscription.status || "unknown",
    current_period_end: toIsoTimestamp(subscription.current_period_end),
    updated_at: new Date().toISOString(),
  };
}

function createHandler(deps) {
  const { stripeClient, store, config } = deps;

  return async function handler(event) {
    const signature =
      event.headers["stripe-signature"] ||
      event.headers["Stripe-Signature"];

    let stripeEvent;
    try {
      stripeEvent = stripeClient.webhooks.constructEvent(
        event.body,
        signature,
        config.webhookSecret
      );
    } catch (error) {
      return { statusCode: 400, body: `Webhook Error: ${error.message}` };
    }

    try {
      if (stripeEvent.type === "checkout.session.completed") {
        const session = stripeEvent.data.object;
        const email = session?.customer_details?.email || null;
        const subscriptionId = session?.subscription || null;

        if (!email || !subscriptionId) {
          return { statusCode: 200, body: "Missing email or subscription." };
        }

        const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
        const payload = normalizePayload({
          email,
          subscription,
          priceIds: config.priceIds,
        });

        if (!payload) {
          return { statusCode: 200, body: "Unknown or incomplete subscription." };
        }

        await store.upsertEntitlement(payload);
        return { statusCode: 200, body: `Stored: ${payload.email} -> ${payload.entitled_tier}` };
      }

      if (
        stripeEvent.type === "customer.subscription.updated" ||
        stripeEvent.type === "customer.subscription.deleted"
      ) {
        const subscription = stripeEvent.data.object;
        const existingEntitlement = await store.findEntitlementByStripeRefs?.(
          subscription?.id || null,
          subscription?.customer || null
        );
        const email =
          subscription?.metadata?.email ||
          subscription?.customer_email ||
          existingEntitlement?.email ||
          null;
        const payload = normalizePayload({
          email,
          subscription,
          priceIds: config.priceIds,
        });

        if (!payload) {
          return { statusCode: 200, body: "Subscription update missing email or price." };
        }

        await store.upsertEntitlement(payload);
        return { statusCode: 200, body: `Updated: ${payload.email} -> ${payload.subscription_status}` };
      }

      return { statusCode: 200, body: "Event ignored." };
    } catch (error) {
      return { statusCode: 200, body: `Handled error: ${error.message}` };
    }
  };
}

function createRuntimeHandler(overrides = {}) {
  const stripeClient =
    overrides.stripeClient || new Stripe(process.env.STRIPE_SECRET_KEY);
  const store = overrides.store || createStore();
  const config = overrides.config || {
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    priceIds: {
      Core: process.env.STRIPE_PRICE_CORE,
      Pro: process.env.STRIPE_PRICE_PRO,
      Black: process.env.STRIPE_PRICE_BLACK,
    },
  };

  return createHandler({
    stripeClient,
    store,
    config,
  });
}

async function handler(event, context) {
  const runtimeHandler = createRuntimeHandler();
  return runtimeHandler(event, context);
}

exports.createHandler = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler = handler;
