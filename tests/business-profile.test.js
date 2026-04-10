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

const NOOP = {
  getProfile:    async () => { throw new Error("should not call getProfile"); },
  upsertProfile: async () => { throw new Error("should not call upsertProfile"); },
};

const SAMPLE_PROFILE = {
  email: "pro@example.com",
  occupation: "Mobile Hairdresser",
  services: [{ name: "Cut & Style", duration_minutes: 60 }],
  buffer_before_minutes: 20,
  buffer_after_minutes: 20,
  working_hours: null,
  onboarding_complete: true,
};

async function testGetReturnsProfile() {
  const { createHandler } = require("../netlify/functions/business-profile");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    getProfile: async (email) => {
      assert.equal(email, "pro@example.com");
      return SAMPLE_PROFILE;
    },
  });

  const res = await handler({ httpMethod: "GET", headers: {}, queryStringParameters: {} });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.profile, SAMPLE_PROFILE);
}

async function testGetReturnsNullWhenNoProfile() {
  const { createHandler } = require("../netlify/functions/business-profile");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    getProfile: async () => null,
  });

  const res = await handler({ httpMethod: "GET", headers: {}, queryStringParameters: {} });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).profile, null);
}

async function testPostUpsertsProfile() {
  const { createHandler } = require("../netlify/functions/business-profile");

  let savedUpdates = null;

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    upsertProfile: async (email, updates) => {
      savedUpdates = updates;
      return { ...SAMPLE_PROFILE, ...updates };
    },
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({
      occupation: "Plumber",
      buffer_before_minutes: 30,
      buffer_after_minutes: 15,
      onboarding_complete: true,
    }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.equal(savedUpdates.occupation, "Plumber");
  assert.equal(savedUpdates.buffer_before_minutes, 30);
  assert.equal(savedUpdates.buffer_after_minutes, 15);
  assert.equal(savedUpdates.onboarding_complete, true);
}

async function testPostRejectsInvalidServices() {
  const { createHandler } = require("../netlify/functions/business-profile");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    upsertProfile: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ services: [{ name: "Bad" }] }), // missing duration_minutes
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "invalid_service_entry");
}

async function testPostRejectsInvalidBuffer() {
  const { createHandler } = require("../netlify/functions/business-profile");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    upsertProfile: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ buffer_before_minutes: -5 }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "invalid_buffer_before");
}

async function testPostRejectsNoFields() {
  const { createHandler } = require("../netlify/functions/business-profile");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    upsertProfile: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({}),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "no_fields_to_update");
}

async function testCoreTierDenied() {
  const { createHandler } = require("../netlify/functions/business-profile");

  const handler = createHandler({
    ...makeAuth("Core"),
    ...NOOP,
    getProfile: async () => null,
  });

  const res = await handler({ httpMethod: "GET", headers: {}, queryStringParameters: {} });

  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).reason, "tier_not_entitled");
}

async function testWorkingHoursValidationRejectsInvalidDay() {
  const { createHandler } = require("../netlify/functions/business-profile");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    upsertProfile: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ working_hours: { "9": { start: "09:00", end: "17:00" } } }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "invalid_working_hours_day");
}

async function run() {
  await testGetReturnsProfile();
  await testGetReturnsNullWhenNoProfile();
  await testPostUpsertsProfile();
  await testPostRejectsInvalidServices();
  await testPostRejectsInvalidBuffer();
  await testPostRejectsNoFields();
  await testCoreTierDenied();
  await testWorkingHoursValidationRejectsInvalidDay();
  console.log("business-profile tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
