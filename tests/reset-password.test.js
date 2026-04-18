const assert = require("node:assert/strict");

const FUTURE = new Date(Date.now() + 3600 * 1000).toISOString();
const PAST   = new Date(Date.now() - 3600 * 1000).toISOString();

function makeHandler(tokenRecord, entitlement, overrides = {}) {
  const { createHandler } = require("../netlify/functions/reset-password");
  return createHandler({
    findToken:              async () => tokenRecord,
    markTokenUsed:          overrides.markTokenUsed       ?? (async () => {}),
    findEntitlementByEmail: async () => entitlement,
    updatePasswordHash:     overrides.updatePasswordHash  ?? (async () => {}),
    createSessionCookie:    overrides.createSessionCookie ?? (() => "textboss_session=cookie"),
  });
}

async function testValidTokenResetsPasswordAndSignsIn() {
  let savedHash = null;
  let markedUsed = false;

  const handler = makeHandler(
    { token: "abc123", email: "u@example.com", expires_at: FUTURE, used_at: null },
    { email: "u@example.com", entitled_tier: "Black", subscription_status: "active" },
    {
      updatePasswordHash: async (email, hash) => {
        assert.equal(email, "u@example.com");
        savedHash = hash;
      },
      markTokenUsed:      async () => { markedUsed = true; },
      createSessionCookie: (session) => {
        assert.equal(session.email, "u@example.com");
        assert.equal(session.tier, "Black");
        return "textboss_session=new-cookie";
      },
    }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "abc123", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(markedUsed, true, "should mark token used");
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, tier: "Black", redirectTo: "/app-black.html" });
  assert.equal(response.headers["set-cookie"], "textboss_session=new-cookie");
  assert.ok(typeof savedHash === "string" && savedHash.includes(":"), "should save hashed password");
}

async function testRejectsExpiredToken() {
  const handler = makeHandler(
    { token: "expired", email: "u@example.com", expires_at: PAST, used_at: null },
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "expired", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "token_expired" });
}

async function testRejectsAlreadyUsedToken() {
  const handler = makeHandler(
    { token: "used", email: "u@example.com", expires_at: FUTURE, used_at: new Date().toISOString() },
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "used", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "token_used" });
}

async function testRejectsUnknownToken() {
  const { createHandler } = require("../netlify/functions/reset-password");
  const handler = createHandler({
    findToken:              async () => null,
    markTokenUsed:          async () => {},
    findEntitlementByEmail: async () => null,
    updatePasswordHash:     async () => {},
    createSessionCookie:    () => "cookie",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "bad", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "invalid_token" });
}

async function testRejectsPasswordMismatch() {
  const handler = makeHandler(
    { token: "t", email: "u@example.com", expires_at: FUTURE, used_at: null },
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "t", password: "password1", confirmPassword: "password2" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_mismatch" });
}

async function testRejectsShortPassword() {
  const handler = makeHandler(
    { token: "t", email: "u@example.com", expires_at: FUTURE, used_at: null },
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "t", password: "short", confirmPassword: "short" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_too_short" });
}

async function testRejectsInactiveSubscription() {
  const handler = makeHandler(
    { token: "t", email: "u@example.com", expires_at: FUTURE, used_at: null },
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "cancelled" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "t", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_active" });
}

async function testRejectsNoEntitlement() {
  const handler = makeHandler(
    { token: "t", email: "u@example.com", expires_at: FUTURE, used_at: null },
    null  // no entitlement row
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "t", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_found" });
}

async function run() {
  await testValidTokenResetsPasswordAndSignsIn();
  await testRejectsExpiredToken();
  await testRejectsAlreadyUsedToken();
  await testRejectsUnknownToken();
  await testRejectsPasswordMismatch();
  await testRejectsShortPassword();
  await testRejectsInactiveSubscription();
  await testRejectsNoEntitlement();
  console.log("reset-password tests passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
