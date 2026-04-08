const assert = require("node:assert/strict");

async function testMissingCookieDenied() {
  const { createHandler } = require("../netlify/functions/session-verify");

  const handler = createHandler({
    verifySessionCookie: () => ({ ok: false, reason: "missing_session" }),
    findEntitlementByEmail: async () => {
      throw new Error("should not query entitlements without a valid session");
    },
  });

  const response = await handler({
    httpMethod: "GET",
    headers: {},
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    denied: true,
    reason: "missing_session",
  });
}

async function testValidCookieAndActiveEntitlementPasses() {
  const { createHandler } = require("../netlify/functions/session-verify");

  const handler = createHandler({
    verifySessionCookie: () => ({
      ok: true,
      session: {
        email: "pro@example.com",
        tier: "Pro",
      },
    }),
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: "Pro",
      subscription_status: "trialing",
    }),
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
    email: "pro@example.com",
    tier: "Pro",
  });
}

async function testValidCookiePassesWithNormalizedEntitlementValues() {
  const { createHandler } = require("../netlify/functions/session-verify");

  const handler = createHandler({
    verifySessionCookie: () => ({
      ok: true,
      session: {
        email: "breach@cyberservices.com",
        tier: "Pro",
      },
    }),
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: " pro ",
      subscription_status: " ACTIVE ",
    }),
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
    email: "breach@cyberservices.com",
    tier: "Pro",
  });
}

async function run() {
  await testMissingCookieDenied();
  await testValidCookieAndActiveEntitlementPasses();
  await testValidCookiePassesWithNormalizedEntitlementValues();
  console.log("session-verify tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
