const assert = require("node:assert/strict");

function makeHandler(entitlement, overrides = {}) {
  const { createHandler } = require("../netlify/functions/set-password");
  return createHandler({
    findEntitlementByEmail: async () => entitlement,
    updatePasswordHash:     overrides.updatePasswordHash ?? (async () => {}),
    createSessionCookie:    overrides.createSessionCookie ?? (() => "textboss_session=cookie"),
  });
}

async function testSetsPasswordAndIssuesCookieOnFirstVisit() {
  let savedHash = null;
  let savedEmail = null;

  const handler = makeHandler(
    { email: "new@example.com", entitled_tier: "Pro", subscription_status: "active", password_hash: null },
    {
      updatePasswordHash: async (email, hash) => { savedEmail = email; savedHash = hash; },
      createSessionCookie: (session) => {
        assert.equal(session.email, "new@example.com");
        assert.equal(session.tier, "Pro");
        return "textboss_session=new-cookie";
      },
    }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "new@example.com", password: "secure-pass-1", confirmPassword: "secure-pass-1" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, tier: "Pro", redirectTo: "/app-pro.html" });
  assert.equal(response.headers["set-cookie"], "textboss_session=new-cookie");
  assert.equal(savedEmail, "new@example.com");
  assert.ok(typeof savedHash === "string" && savedHash.includes(":"), "hash should be salt:hash format");
}

async function testRejectsPasswordMismatch() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active", password_hash: null }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "password1", confirmPassword: "password2" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_mismatch" });
}

async function testRejectsShortPassword() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active", password_hash: null }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "short", confirmPassword: "short" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_too_short" });
}

async function testRejectsIfPasswordAlreadySet() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active", password_hash: "existing:hash" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "new-password", confirmPassword: "new-password" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_already_set" });
}

async function testRejectsInactiveSubscription() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "canceled", password_hash: null }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "validpass", confirmPassword: "validpass" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_active" });
}

async function testRejectsUnknownEmail() {
  const { createHandler } = require("../netlify/functions/set-password");
  const handler = createHandler({
    findEntitlementByEmail: async () => null,
    updatePasswordHash:     async () => {},
    createSessionCookie:    () => "cookie",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "nobody@example.com", password: "validpass", confirmPassword: "validpass" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_found" });
}

async function run() {
  await testSetsPasswordAndIssuesCookieOnFirstVisit();
  await testRejectsPasswordMismatch();
  await testRejectsShortPassword();
  await testRejectsIfPasswordAlreadySet();
  await testRejectsInactiveSubscription();
  await testRejectsUnknownEmail();
  console.log("set-password tests passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
