const assert = require("node:assert/strict");

function makeAuth(tier = "Pro") {
  return {
    verifySessionCookie: () => ({
      ok: true,
      session: { email: "pro@example.com", tier },
    }),
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: tier,
      subscription_status: "active",
    }),
  };
}

const VALID_SUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "key123", auth: "auth456" },
};

async function testPostSavesSubscription() {
  const { createHandler } = require("../netlify/functions/push-subscribe");

  let saved = null;

  const handler = createHandler({
    ...makeAuth("Pro"),
    saveSubscription: async (email, sub) => {
      saved = { email, sub };
      return { id: "sub-1" };
    },
    deleteSubscription: async () => { throw new Error("should not delete"); },
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify(VALID_SUB),
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, id: "sub-1" });
  assert.equal(saved.email, "pro@example.com");
  assert.deepEqual(saved.sub, VALID_SUB);
}

async function testPostRejectsMissingEndpoint() {
  const { createHandler } = require("../netlify/functions/push-subscribe");

  const handler = createHandler({
    ...makeAuth("Pro"),
    saveSubscription: async () => {},
    deleteSubscription: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ keys: VALID_SUB.keys }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_endpoint");
}

async function testPostRejectsMissingKeys() {
  const { createHandler } = require("../netlify/functions/push-subscribe");

  const handler = createHandler({
    ...makeAuth("Pro"),
    saveSubscription: async () => {},
    deleteSubscription: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ endpoint: VALID_SUB.endpoint }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_keys");
}

async function testDeleteRemovesSubscription() {
  const { createHandler } = require("../netlify/functions/push-subscribe");

  let deleted = null;

  const handler = createHandler({
    ...makeAuth("Black"),
    saveSubscription: async () => { throw new Error("should not save"); },
    deleteSubscription: async (email, endpoint) => {
      deleted = { email, endpoint };
    },
  });

  const res = await handler({
    httpMethod: "DELETE",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ endpoint: VALID_SUB.endpoint }),
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, deleted: true });
  assert.equal(deleted.email, "pro@example.com");
  assert.equal(deleted.endpoint, VALID_SUB.endpoint);
}

async function testDeleteRejectsMissingEndpoint() {
  const { createHandler } = require("../netlify/functions/push-subscribe");

  const handler = createHandler({
    ...makeAuth("Pro"),
    saveSubscription: async () => {},
    deleteSubscription: async () => {},
  });

  const res = await handler({
    httpMethod: "DELETE",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({}),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_endpoint");
}

async function testCoreTierDenied() {
  const { createHandler } = require("../netlify/functions/push-subscribe");

  const handler = createHandler({
    ...makeAuth("Core"),
    saveSubscription: async () => {},
    deleteSubscription: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify(VALID_SUB),
  });

  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).reason, "tier_not_entitled");
}

async function run() {
  await testPostSavesSubscription();
  await testPostRejectsMissingEndpoint();
  await testPostRejectsMissingKeys();
  await testDeleteRemovesSubscription();
  await testDeleteRejectsMissingEndpoint();
  await testCoreTierDenied();
  console.log("push-subscribe tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
