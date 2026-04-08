const assert = require("node:assert/strict");

async function testLogoutClearsCookie() {
  const { createHandler } = require("../netlify/functions/session-logout");

  const handler = createHandler({
    clearSessionCookie: () => "textboss_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  });

  const response = await handler({
    httpMethod: "POST",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal(
    response.headers["set-cookie"],
    "textboss_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
}

async function run() {
  await testLogoutClearsCookie();
  console.log("session-logout tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
