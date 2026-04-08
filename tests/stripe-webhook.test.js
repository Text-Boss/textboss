const assert = require("node:assert/strict");

async function testCheckoutCompletionStoresCoreEntitlement() {
  const { createHandler } = require("../netlify/functions/stripe-webhook");

  const upserts = [];
  const handler = createHandler({
    stripeClient: {
      webhooks: {
        constructEvent(body, signature, secret) {
          assert.equal(signature, "sig");
          assert.equal(secret, "whsec");
          return JSON.parse(body);
        },
      },
      subscriptions: {
        async retrieve(subscriptionId) {
          assert.equal(subscriptionId, "sub_123");
          return {
            id: subscriptionId,
            customer: "cus_123",
            status: "active",
            current_period_end: 1_700_000_000,
            items: {
              data: [
                {
                  price: {
                    id: "price_core",
                  },
                },
              ],
            },
          };
        },
      },
    },
    store: {
      async upsertEntitlement(payload) {
        upserts.push(payload);
      },
    },
    config: {
      webhookSecret: "whsec",
      priceIds: {
        Core: "price_core",
        Pro: "price_pro",
        Black: "price_black",
      },
    },
  });

  const response = await handler({
    headers: {
      "stripe-signature": "sig",
    },
    body: JSON.stringify({
      type: "checkout.session.completed",
      data: {
        object: {
          customer_details: {
            email: "core@example.com",
          },
          subscription: "sub_123",
        },
      },
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].entitled_tier, "Core");
  assert.equal(upserts[0].subscription_status, "active");
}

async function testSubscriptionUpdateRevokesInactiveAccess() {
  const { createHandler } = require("../netlify/functions/stripe-webhook");

  const upserts = [];
  const handler = createHandler({
    stripeClient: {
      webhooks: {
        constructEvent(body) {
          return JSON.parse(body);
        },
      },
      subscriptions: {
        async retrieve() {
          throw new Error("should not fetch subscription for direct subscription updates");
        },
      },
    },
    store: {
      async upsertEntitlement(payload) {
        upserts.push(payload);
      },
    },
    config: {
      webhookSecret: "whsec",
      priceIds: {
        Core: "price_core",
        Pro: "price_pro",
        Black: "price_black",
      },
    },
  });

  const response = await handler({
    headers: {
      "stripe-signature": "sig",
    },
    body: JSON.stringify({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_456",
          customer: "cus_456",
          status: "past_due",
          current_period_end: 1_700_000_001,
          items: {
            data: [
              {
                price: {
                  id: "price_pro",
                },
              },
            ],
          },
          metadata: {
            email: "pro@example.com",
          },
        },
      },
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].entitled_tier, "Pro");
  assert.equal(upserts[0].subscription_status, "past_due");
}

async function testSubscriptionUpdateFallsBackToExistingEntitlementEmail() {
  const { createHandler } = require("../netlify/functions/stripe-webhook");

  const upserts = [];
  const handler = createHandler({
    stripeClient: {
      webhooks: {
        constructEvent(body) {
          return JSON.parse(body);
        },
      },
      subscriptions: {
        async retrieve() {
          throw new Error("should not fetch subscription for direct subscription updates");
        },
      },
    },
    store: {
      async findEntitlementByStripeRefs(subscriptionId, customerId) {
        assert.equal(subscriptionId, "sub_789");
        assert.equal(customerId, "cus_789");
        return {
          email: "black@example.com",
        };
      },
      async upsertEntitlement(payload) {
        upserts.push(payload);
      },
    },
    config: {
      webhookSecret: "whsec",
      priceIds: {
        Core: "price_core",
        Pro: "price_pro",
        Black: "price_black",
      },
    },
  });

  const response = await handler({
    headers: {
      "stripe-signature": "sig",
    },
    body: JSON.stringify({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_789",
          customer: "cus_789",
          status: "canceled",
          current_period_end: 1_700_000_002,
          items: {
            data: [
              {
                price: {
                  id: "price_black",
                },
              },
            ],
          },
          metadata: {},
        },
      },
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].email, "black@example.com");
  assert.equal(upserts[0].entitled_tier, "Black");
  assert.equal(upserts[0].subscription_status, "canceled");
}

async function run() {
  await testCheckoutCompletionStoresCoreEntitlement();
  await testSubscriptionUpdateRevokesInactiveAccess();
  await testSubscriptionUpdateFallsBackToExistingEntitlementEmail();
  console.log("stripe-webhook tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
