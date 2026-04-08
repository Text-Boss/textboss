const assert = require("node:assert/strict");

async function testRuntimeHandlerUsesSharedDeps() {
  const chat = require("../netlify/functions/chat");

  const handler = chat.createRuntimeHandler({
    store: {
      findEntitlementByEmail: async (email) => ({
        email,
        entitled_tier: "Pro",
        subscription_status: "active",
      }),
    },
    sessionLib: {
      verifySessionCookie: () => ({
        ok: true,
        session: {
          email: "pro@example.com",
          tier: "Pro",
        },
      }),
    },
    tierPolicyLib: {
      getTierPolicy: () => ({
        instructions: "pro-policy",
        responseMaxTokens: 500,
      }),
    },
    openaiClient: {
      createResponse: async () => ({
        output: "Use the agreed scope only.",
        usage: { total_tokens: 9 },
      }),
    },
  });

  const response = await handler({
    httpMethod: "POST",
    headers: {
      cookie: "textboss_session=signed",
    },
    body: JSON.stringify({ message: "Reply to scope creep" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    tier: "Pro",
    output: "Use the agreed scope only.",
    usage: { total_tokens: 9 },
  });
}

async function testHandlerReturnsJsonWhenRuntimeDepsAreMissing() {
  const chat = require("../netlify/functions/chat");
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await chat.handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ message: "Reply to scope creep" }),
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.body), {
      ok: false,
      denied: true,
      reason: "server_error",
    });
  } finally {
    if (originalSupabaseUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalSupabaseUrl;
    }

    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    }
  }
}

async function run() {
  await testRuntimeHandlerUsesSharedDeps();
  await testHandlerReturnsJsonWhenRuntimeDepsAreMissing();
  console.log("chat runtime wiring tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
