const assert = require("node:assert/strict");

function makeHandler(tier) {
  const { createHandler } = require("../netlify/functions/verify-email");
  return createHandler({
    findEntitlementByEmail: async () => ({
      entitled_tier: tier,
      subscription_status: "active",
      password_hash: "salt:hash",
    }),
    verifyPassword: () => true,
    createSessionCookie: () => "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax",
  });
}

async function testRedirectCore() {
  const handler = makeHandler("Core");
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "test@test.com", password: "test" }),
  });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.redirectTo, "/app.html", "Core should redirect to /app.html");
}

async function testRedirectPro() {
  const handler = makeHandler("Pro");
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "test@test.com", password: "test" }),
  });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.redirectTo, "/app.html", "Pro should redirect to /app.html");
}

async function testRedirectBlack() {
  const handler = makeHandler("Black");
  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "test@test.com", password: "test" }),
  });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.redirectTo, "/app.html", "Black should redirect to /app.html");
}

async function run() {
  await testRedirectCore();
  await testRedirectPro();
  await testRedirectBlack();
  console.log("verify-email redirect: all pass");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
