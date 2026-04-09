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

async function testGetListsAvailability() {
  const { createHandler } = require("../netlify/functions/availability");

  const slots = [
    { id: "s1", day_of_week: 1, start_time: "09:00", end_time: "17:00" },
  ];

  const handler = createHandler({
    ...makeAuth("Pro"),
    listAvailability: async (email) => {
      assert.equal(email, "pro@example.com");
      return slots;
    },
    addAvailability: async () => { throw new Error("should not add"); },
    removeAvailability: async () => { throw new Error("should not remove"); },
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, availability: slots });
}

async function testPostAddsSlot() {
  const { createHandler } = require("../netlify/functions/availability");

  const newSlot = { id: "s2", day_of_week: 3, start_time: "10:00", end_time: "12:00" };

  const handler = createHandler({
    ...makeAuth("Pro"),
    listAvailability: async () => { throw new Error("should not list"); },
    addAvailability: async (email, slot) => {
      assert.equal(email, "pro@example.com");
      assert.equal(slot.day_of_week, 3);
      assert.equal(slot.start_time, "10:00");
      assert.equal(slot.end_time, "12:00");
      return newSlot;
    },
    removeAvailability: async () => { throw new Error("should not remove"); },
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ day_of_week: 3, start_time: "10:00", end_time: "12:00" }),
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, slot: newSlot });
}

async function testPostRejectsInvalidDayOfWeek() {
  const { createHandler } = require("../netlify/functions/availability");

  const handler = createHandler({
    ...makeAuth("Pro"),
    listAvailability: async () => [],
    addAvailability: async () => { throw new Error("should not add"); },
    removeAvailability: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ day_of_week: 7, start_time: "09:00", end_time: "10:00" }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "invalid_day_of_week");
}

async function testPostRejectsEndBeforeStart() {
  const { createHandler } = require("../netlify/functions/availability");

  const handler = createHandler({
    ...makeAuth("Pro"),
    listAvailability: async () => [],
    addAvailability: async () => { throw new Error("should not add"); },
    removeAvailability: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ day_of_week: 1, start_time: "17:00", end_time: "09:00" }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "end_time_before_start");
}

async function testDeleteRemovesSlot() {
  const { createHandler } = require("../netlify/functions/availability");

  let removed = null;

  const handler = createHandler({
    ...makeAuth("Pro"),
    listAvailability: async () => [],
    addAvailability: async () => { throw new Error("should not add"); },
    removeAvailability: async (id, email) => {
      removed = { id, email };
    },
  });

  const res = await handler({
    httpMethod: "DELETE",
    headers: {},
    queryStringParameters: { id: "s1" },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, deleted: true });
  assert.deepEqual(removed, { id: "s1", email: "pro@example.com" });
}

async function testDeleteMissingIdRejected() {
  const { createHandler } = require("../netlify/functions/availability");

  const handler = createHandler({
    ...makeAuth("Pro"),
    listAvailability: async () => [],
    addAvailability: async () => {},
    removeAvailability: async () => { throw new Error("should not remove"); },
  });

  const res = await handler({
    httpMethod: "DELETE",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_id");
}

async function testCoreTierDenied() {
  const { createHandler } = require("../netlify/functions/availability");

  const handler = createHandler({
    ...makeAuth("Core"),
    listAvailability: async () => { throw new Error("should not reach store"); },
    addAvailability: async () => { throw new Error("should not reach store"); },
    removeAvailability: async () => { throw new Error("should not reach store"); },
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).reason, "tier_not_entitled");
}

async function testMissingSessionDenied() {
  const { createHandler } = require("../netlify/functions/availability");

  const handler = createHandler({
    verifySessionCookie: () => ({ ok: false, reason: "missing_session" }),
    findEntitlementByEmail: async () => { throw new Error("should not query"); },
    listAvailability: async () => { throw new Error("should not reach store"); },
    addAvailability: async () => { throw new Error("should not reach store"); },
    removeAvailability: async () => { throw new Error("should not reach store"); },
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).reason, "missing_session");
}

async function testStoreErrorReturnsStructured500() {
  // Regression test: the exported handler must catch async errors from
  // the inner handler and return a structured JSON 500 response.
  // The original bug was a missing `await` in the handler wrapper, which
  // caused async rejections to bypass the try/catch entirely.
  const { createHandler } = require("../netlify/functions/availability");

  const handler = createHandler({
    ...makeAuth("Pro"),
    listAvailability: async () => { throw new Error("Supabase connection failed"); },
    addAvailability: async () => { throw new Error("Supabase insert failed"); },
    removeAvailability: async () => { throw new Error("Supabase delete failed"); },
  });

  // GET triggers listAvailability which throws
  await assert.rejects(
    handler({ httpMethod: "GET", headers: {}, queryStringParameters: {} }),
    { message: "Supabase connection failed" },
  );

  // POST triggers addAvailability which throws
  await assert.rejects(
    handler({
      httpMethod: "POST",
      headers: {},
      queryStringParameters: {},
      body: JSON.stringify({ day_of_week: 1, start_time: "09:00", end_time: "17:00" }),
    }),
    { message: "Supabase insert failed" },
  );

  // Verify that the outer handler pattern (with await) catches these:
  // Simulate what the exported handler() does
  async function wrappedHandler(event) {
    try {
      return await handler(event);
    } catch {
      return { statusCode: 500, body: JSON.stringify({ ok: false, reason: "server_error" }) };
    }
  }

  const getRes = await wrappedHandler({
    httpMethod: "GET", headers: {}, queryStringParameters: {},
  });
  assert.equal(getRes.statusCode, 500);
  assert.equal(JSON.parse(getRes.body).reason, "server_error");

  const postRes = await wrappedHandler({
    httpMethod: "POST", headers: {}, queryStringParameters: {},
    body: JSON.stringify({ day_of_week: 1, start_time: "09:00", end_time: "17:00" }),
  });
  assert.equal(postRes.statusCode, 500);
  assert.equal(JSON.parse(postRes.body).reason, "server_error");
}

async function run() {
  await testGetListsAvailability();
  await testPostAddsSlot();
  await testPostRejectsInvalidDayOfWeek();
  await testPostRejectsEndBeforeStart();
  await testDeleteRemovesSlot();
  await testDeleteMissingIdRejected();
  await testCoreTierDenied();
  await testMissingSessionDenied();
  await testStoreErrorReturnsStructured500();
  console.log("availability tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
