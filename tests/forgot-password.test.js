const assert = require("node:assert/strict");

function makeHandler(entitlement, overrides = {}) {
  const { createHandler } = require("../netlify/functions/forgot-password");
  return createHandler({
    findEntitlementByEmail: async () => entitlement,
    deleteTokensByEmail:    overrides.deleteTokensByEmail ?? (async () => {}),
    createToken:            overrides.createToken         ?? (async () => {}),
    sendEmail:              overrides.sendEmail           ?? (async () => {}),
  });
}

async function testAlwaysReturnsSuccessForKnownEmail() {
  let tokenSaved = null;
  let emailSentTo = null;

  const handler = makeHandler(
    { email: "sub@example.com", entitled_tier: "Pro", subscription_status: "active" },
    {
      createToken: async (email, token, expiresAt) => {
        assert.equal(email, "sub@example.com");
        assert.ok(typeof token === "string" && token.length === 64, "token should be 32 bytes hex");
        assert.ok(expiresAt instanceof Date && expiresAt > new Date(), "expiresAt should be in the future");
        tokenSaved = token;
      },
      sendEmail: async (email, token) => {
        emailSentTo = email;
        assert.equal(token, tokenSaved);
      },
    }
  );

  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ email: "sub@example.com" }) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.ok(tokenSaved !== null, "token should have been created");
  assert.equal(emailSentTo, "sub@example.com");
}

async function testAlwaysReturnsSuccessForUnknownEmail() {
  let createTokenCalled = false;
  const handler = makeHandler(null, {
    createToken: async () => { createTokenCalled = true; },
    sendEmail:   async () => {},
  });

  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ email: "nobody@example.com" }) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal(createTokenCalled, false, "should not create token for unknown email");
}

async function testDeletesExistingTokensBeforeCreating() {
  const deletedEmails = [];
  const callOrder = [];
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" },
    {
      deleteTokensByEmail: async (email) => { callOrder.push("delete"); deletedEmails.push(email); },
      createToken:         async () => { callOrder.push("create"); },
    }
  );

  await handler({ httpMethod: "POST", body: JSON.stringify({ email: "u@example.com" }) });

  assert.ok(deletedEmails.includes("u@example.com"), "should delete existing tokens first");
  assert.equal(callOrder[0], "delete", "delete should be called before create");
  assert.equal(callOrder[1], "create", "create should be called after delete");
}

async function testErrorsAreSwallowed() {
  const { createHandler } = require("../netlify/functions/forgot-password");
  const handler = createHandler({
    findEntitlementByEmail: async () => { throw new Error("db exploded"); },
    deleteTokensByEmail:    async () => {},
    createToken:            async () => {},
    sendEmail:              async () => {},
  });

  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ email: "err@example.com" }) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
}

async function testRejectsNonPost() {
  const handler = makeHandler(null);
  const response = await handler({ httpMethod: "GET", body: null });
  assert.equal(response.statusCode, 405);
}

async function testMissingEmailReturns400() {
  const handler = makeHandler(null);
  const response = await handler({ httpMethod: "POST", body: JSON.stringify({}) });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "missing_email" });
}

async function run() {
  await testAlwaysReturnsSuccessForKnownEmail();
  await testAlwaysReturnsSuccessForUnknownEmail();
  await testDeletesExistingTokensBeforeCreating();
  await testRejectsNonPost();
  await testMissingEmailReturns400();
  await testErrorsAreSwallowed();
  console.log("forgot-password tests passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
