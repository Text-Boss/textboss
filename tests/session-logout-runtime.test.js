const assert = require("node:assert/strict");

async function testRuntimeHandlerUsesSharedSessionHelper() {
  const sessionLogout = require("../netlify/functions/session-logout");

  const handler = sessionLogout.createRuntimeHandler({
    sessionLib: {
      clearSessionCookie: () => "textboss_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    },
  });

  const response = await handler({
    httpMethod: "POST",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(
    response.headers["set-cookie"],
    "textboss_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
}

async function run() {
  await testRuntimeHandlerUsesSharedSessionHelper();
  console.log("session-logout runtime wiring tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
