const assert = require("node:assert/strict");

async function testRuntimeHandlerUsesSharedDeps() {
  const sessionVerify = require("../netlify/functions/session-verify");

  const handler = sessionVerify.createRuntimeHandler({
    store: {
      findEntitlementByEmail: async (email) => ({
        email,
        entitled_tier: "Core",
        subscription_status: "active",
      }),
    },
    sessionLib: {
      verifySessionCookie: () => ({
        ok: true,
        session: {
          email: "core@example.com",
          tier: "Core",
        },
      }),
    },
  });

  const response = await handler({
    httpMethod: "GET",
    headers: {
      cookie: "textboss_session=signed",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    email: "core@example.com",
    tier: "Core",
  });
}

async function testHandlerReturnsJsonWhenRuntimeDepsAreMissing() {
  const sessionVerify = require("../netlify/functions/session-verify");
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await sessionVerify.handler({
      httpMethod: "GET",
      headers: {},
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
  console.log("session-verify runtime wiring tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
