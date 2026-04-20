const assert = require("node:assert/strict");

async function testRuntimeHandlerUsesSharedDeps() {
  const verifyEmail = require("../netlify/functions/verify-email");

  const handler = verifyEmail.createRuntimeHandler({
    store: {
      findEntitlementByEmail: async (email) => ({
        email,
        entitled_tier: "Pro",
        subscription_status: "active",
        password_hash: "salt:hash",
      }),
    },
    sessionLib: {
      createSessionCookie: ({ email, tier }) =>
        `textboss_session=${email}:${tier}; Path=/; HttpOnly; SameSite=Lax`,
    },
    verifyPassword: () => true,
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "Pro@Example.com", password: "any" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    tier: "Pro",
    redirectTo: "/app-pro.html",
  });
  assert.equal(
    response.headers["set-cookie"],
    "textboss_session=pro@example.com:Pro; Path=/; HttpOnly; SameSite=Lax"
  );
}

async function run() {
  await testRuntimeHandlerUsesSharedDeps();
  console.log("verify-email runtime wiring tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
