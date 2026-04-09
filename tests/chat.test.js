const assert = require("node:assert/strict");

async function testMissingSessionDeniedWithoutAdvice() {
  const { createHandler } = require("../netlify/functions/chat");

  const handler = createHandler({
    verifySessionCookie: () => ({ ok: false, reason: "missing_session" }),
    findEntitlementByEmail: async () => {
      throw new Error("should not query entitlement when session is missing");
    },
    getTierPolicy: () => {
      throw new Error("should not resolve tier policy for denied users");
    },
    createResponse: async () => {
      throw new Error("should not call OpenAI for denied users");
    },
  });

  const response = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({ message: "Help me negotiate pricing" }),
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    denied: true,
    reason: "missing_session",
  });
}

async function testActiveBlackSessionUsesTierPolicy() {
  const { createHandler } = require("../netlify/functions/chat");

  const handler = createHandler({
    verifySessionCookie: () => ({
      ok: true,
      session: {
        email: "black@example.com",
        tier: "Black",
      },
    }),
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: "Black",
      subscription_status: "active",
    }),
    getTierPolicy: (tier) => ({
      tier,
      instructions: "black-tier-policy",
      inputLimit: 4000,
    }),
    createResponse: async ({ message, policy, tier }) => {
      assert.equal(message, "Draft a final response");
      assert.equal(policy.instructions, "black-tier-policy");
      assert.equal(tier, "Black");
      return {
        output: "This ends here.",
        usage: { total_tokens: 42 },
      };
    },
  });

  const response = await handler({
    httpMethod: "POST",
    headers: {
      cookie: "textboss_session=signed",
    },
    body: JSON.stringify({ message: "Draft a final response" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    tier: "Black",
    output: "This ends here.",
    usage: { total_tokens: 42 },
  });
}

async function testOversizedMessageRejected() {
  const { createHandler } = require("../netlify/functions/chat");

  const handler = createHandler({
    verifySessionCookie: () => ({
      ok: true,
      session: {
        email: "core@example.com",
        tier: "Core",
      },
    }),
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: "Core",
      subscription_status: "active",
    }),
    getTierPolicy: (tier) => ({
      tier,
      instructions: "core-tier-policy",
      inputLimit: 4000,
    }),
    createResponse: async () => {
      throw new Error("should not call OpenAI for oversized messages");
    },
  });

  const oversizedMessage = "x".repeat(4001);
  const response = await handler({
    httpMethod: "POST",
    headers: {
      cookie: "textboss_session=signed",
    },
    body: JSON.stringify({ message: oversizedMessage }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    denied: false,
    reason: "message_too_long",
  });
}

async function run() {
  await testMissingSessionDeniedWithoutAdvice();
  await testActiveBlackSessionUsesTierPolicy();
  await testOversizedMessageRejected();
  console.log("chat tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
