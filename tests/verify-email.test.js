const assert = require("node:assert/strict");

// ── Helper ────────────────────────────────────────────────────────────────────
function makeHandler(entitlement, overrides = {}) {
  const { createHandler } = require("../netlify/functions/verify-email");
  return createHandler({
    findEntitlementByEmail: async () => entitlement,
    verifyPassword: overrides.verifyPassword ?? (() => true),
    createSessionCookie: overrides.createSessionCookie ?? (() => "textboss_session=cookie"),
  });
}

// ── Existing behaviour ────────────────────────────────────────────────────────

async function testActiveCoreEntitlement() {
  const handler = makeHandler(
    { email: "core@example.com", entitled_tier: "Core", subscription_status: "active", password_hash: "salt:hash" },
    {
      verifyPassword: (plain, stored) => {
        assert.equal(plain, "my-pass");
        assert.equal(stored, "salt:hash");
        return true;
      },
      createSessionCookie: (session) => {
        assert.equal(session.email, "core@example.com");
        assert.equal(session.tier, "Core");
        return "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax";
      },
    }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "Core@Example.com", password: "my-pass" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, tier: "Core", redirectTo: "/app.html" });
  assert.equal(response.headers["set-cookie"], "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax");
}

async function testInactiveEntitlementDenied() {
  const handler = makeHandler({
    email: "inactive@example.com",
    entitled_tier: "Pro",
    subscription_status: "canceled",
    password_hash: "salt:hash",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "inactive@example.com", password: "any" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_active" });
}

async function testActiveEntitlementNormalizesTierAndStatus() {
  const handler = makeHandler(
    { email: "breach@cyberservices.com", entitled_tier: " pro ", subscription_status: " ACTIVE ", password_hash: "s:h" },
    {
      createSessionCookie: (session) => {
        assert.equal(session.tier, "Pro");
        return "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax";
      },
    }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "  Breach@CyberServices.com  ", password: "any" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, tier: "Pro", redirectTo: "/app.html" });
}

async function testDependencyFailureReturnsJsonError() {
  const { createHandler } = require("../netlify/functions/verify-email");
  const handler = createHandler({
    findEntitlementByEmail: async () => { throw new Error("DB error"); },
    verifyPassword: () => true,
    createSessionCookie: () => "cookie",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "breach@cyberservices.com", password: "any" }),
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "server_error" });
}

// ── New password-specific behaviour ───────────────────────────────────────────

async function testNullPasswordHashReturnsNeedsSetup() {
  const handler = makeHandler({
    email: "new@example.com",
    entitled_tier: "Black",
    subscription_status: "active",
    password_hash: null,
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "new@example.com", password: "anything" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, needs_setup: true });
  assert.equal(response.headers["set-cookie"], undefined);
}

async function testWrongPasswordReturnsWrongPassword() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Pro", subscription_status: "active", password_hash: "s:h" },
    { verifyPassword: () => false }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "wrong" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "wrong_password" });
  assert.equal(response.headers["set-cookie"], undefined);
}

async function testMissingPasswordWithHashSetReturnsMissingPassword() {
  const handler = makeHandler({
    email: "u@example.com", entitled_tier: "Pro", subscription_status: "active", password_hash: "s:h",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com" }), // no password field
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "missing_password" });
}

async function testNotFoundReturnsDenied() {
  const { createHandler } = require("../netlify/functions/verify-email");
  const handler = createHandler({
    findEntitlementByEmail: async () => null,
    verifyPassword: () => true,
    createSessionCookie: () => "cookie",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "nobody@example.com", password: "any" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_found" });
}

async function run() {
  await testActiveCoreEntitlement();
  await testInactiveEntitlementDenied();
  await testActiveEntitlementNormalizesTierAndStatus();
  await testDependencyFailureReturnsJsonError();
  await testNullPasswordHashReturnsNeedsSetup();
  await testWrongPasswordReturnsWrongPassword();
  await testMissingPasswordWithHashSetReturnsMissingPassword();
  await testNotFoundReturnsDenied();
  console.log("verify-email tests passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
