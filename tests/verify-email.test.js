const assert = require("node:assert/strict");

async function testActiveCoreEntitlement() {
  const { createHandler } = require("../netlify/functions/verify-email");

  const handler = createHandler({
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: "Core",
      subscription_status: "active",
    }),
    createSessionCookie: (session) => {
      assert.equal(session.email, "core@example.com");
      assert.equal(session.tier, "Core");
      return "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax";
    },
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "Core@Example.com" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    tier: "Core",
    redirectTo: "/app-core.html",
  });
  assert.equal(
    response.headers["set-cookie"],
    "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax"
  );
}

async function testInactiveEntitlementDenied() {
  const { createHandler } = require("../netlify/functions/verify-email");

  const handler = createHandler({
    findEntitlementByEmail: async () => ({
      email: "inactive@example.com",
      entitled_tier: "Pro",
      subscription_status: "canceled",
    }),
    createSessionCookie: () => {
      throw new Error("cookie should not be created for denied access");
    },
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "inactive@example.com" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    denied: true,
    reason: "not_active",
  });
  assert.equal(response.headers["set-cookie"], undefined);
}

async function testActiveEntitlementNormalizesTierAndStatus() {
  const { createHandler } = require("../netlify/functions/verify-email");

  const handler = createHandler({
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: " pro ",
      subscription_status: " ACTIVE ",
    }),
    createSessionCookie: (session) => {
      assert.equal(session.email, "breach@cyberservices.com");
      assert.equal(session.tier, "Pro");
      return "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax";
    },
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "  Breach@CyberServices.com  " }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    tier: "Pro",
    redirectTo: "/app-pro.html",
  });
  assert.equal(
    response.headers["set-cookie"],
    "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax"
  );
}

async function testDependencyFailureReturnsJsonError() {
  const { createHandler } = require("../netlify/functions/verify-email");

  const handler = createHandler({
    findEntitlementByEmail: async () => ({
      email: "breach@cyberservices.com",
      entitled_tier: "Pro",
      subscription_status: "active",
    }),
    createSessionCookie: () => {
      throw new Error("Missing TEXTBOSS_SESSION_SECRET");
    },
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "breach@cyberservices.com" }),
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    denied: true,
    reason: "server_error",
  });
}

async function run() {
  await testActiveCoreEntitlement();
  await testInactiveEntitlementDenied();
  await testActiveEntitlementNormalizesTierAndStatus();
  await testDependencyFailureReturnsJsonError();
  console.log("verify-email tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
