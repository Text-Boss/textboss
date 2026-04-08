const assert = require("node:assert/strict");

function makeProDeps(overrides = {}) {
  return {
    verifySessionCookie: () => ({
      ok: true,
      session: { email: "pro@example.com", tier: "Pro" },
    }),
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: "Pro",
      subscription_status: "active",
    }),
    getTierPolicy: () => ({
      tier: "Pro",
      instructions: "pro-instructions",
      inputLimit: 6000,
      responseMaxTokens: 600,
    }),
    getSchedulingInstructions: () => "pro-scheduling-instructions",
    createResponse: async () => ({ output: "Book you in.", usage: { total_tokens: 20 } }),
    listAvailability: async () => [],
    listAppointments: async () => [],
    ...overrides,
  };
}

async function testProTierGetsSchedulingResponse() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  let capturedInput = null;

  const handler = createHandler(makeProDeps({
    listAvailability: async () => [
      { id: "s1", day_of_week: 1, start_time: "09:00", end_time: "17:00" },
    ],
    listAppointments: async () => [
      { id: "a1", scheduled_date: "2026-04-13", scheduled_time: "10:00",
        duration_minutes: 60, client_name: "Jane", status: "confirmed" },
    ],
    createResponse: async (input) => {
      capturedInput = input;
      return { output: "Monday at 9am works.", usage: { total_tokens: 30 } };
    },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "Can we book next Monday?" }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.tier, "Pro");
  assert.equal(body.output, "Monday at 9am works.");

  assert.ok(capturedInput, "createResponse was not called");
  assert.ok(capturedInput.extraSystemContext.includes("pro-scheduling-instructions"),
    "scheduling instructions missing from context");
  assert.ok(capturedInput.extraSystemContext.includes("Monday: 09:00 – 17:00"),
    "availability missing from context");
  assert.ok(capturedInput.extraSystemContext.includes("2026-04-13"),
    "appointment date missing from context");
  assert.ok(capturedInput.extraSystemContext.includes("Jane"),
    "client name missing from context");
}

async function testBlackTierGetsSchedulingResponse() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  const handler = createHandler({
    verifySessionCookie: () => ({
      ok: true,
      session: { email: "black@example.com", tier: "Black" },
    }),
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: "Black",
      subscription_status: "active",
    }),
    getTierPolicy: () => ({
      tier: "Black",
      instructions: "black-instructions",
      inputLimit: 8000,
      responseMaxTokens: 700,
    }),
    getSchedulingInstructions: (tier) => {
      assert.equal(tier, "Black");
      return "black-scheduling-instructions";
    },
    createResponse: async (input) => {
      assert.ok(input.extraSystemContext.includes("black-scheduling-instructions"));
      return { output: "Confirmed.", usage: { total_tokens: 10 } };
    },
    listAvailability: async () => [],
    listAppointments: async () => [],
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "Client wants to reschedule." }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).tier, "Black");
}

async function testCoreTierDenied() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  const handler = createHandler({
    verifySessionCookie: () => ({
      ok: true,
      session: { email: "core@example.com", tier: "Core" },
    }),
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: "Core",
      subscription_status: "active",
    }),
    getTierPolicy: () => ({ tier: "Core", instructions: "", inputLimit: 4000 }),
    getSchedulingInstructions: () => null,
    createResponse: async () => { throw new Error("should not call OpenAI for Core"); },
    listAvailability: async () => { throw new Error("should not query availability"); },
    listAppointments: async () => { throw new Error("should not query appointments"); },
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "Can we schedule something?" }),
  });

  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).reason, "tier_not_entitled");
}

async function testMissingSessionDenied() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  const handler = createHandler({
    verifySessionCookie: () => ({ ok: false, reason: "missing_session" }),
    findEntitlementByEmail: async () => { throw new Error("should not query"); },
    getTierPolicy: () => { throw new Error("should not get policy"); },
    getSchedulingInstructions: () => { throw new Error("should not get instructions"); },
    createResponse: async () => { throw new Error("should not call OpenAI"); },
    listAvailability: async () => { throw new Error("should not query"); },
    listAppointments: async () => { throw new Error("should not query"); },
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({ message: "Book me in." }),
  });

  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).reason, "missing_session");
}

async function testMissingMessageRejected() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  const handler = createHandler(makeProDeps({
    createResponse: async () => { throw new Error("should not call OpenAI"); },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "   " }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_message");
}

async function testOversizedMessageRejected() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  const handler = createHandler(makeProDeps({
    createResponse: async () => { throw new Error("should not call OpenAI"); },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "x".repeat(6001) }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "message_too_long");
}

async function testNonPostMethodRejected() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  const handler = createHandler(makeProDeps());

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 405);
  assert.equal(JSON.parse(res.body).reason, "method_not_allowed");
}

async function testBuildSchedulingContextFormat() {
  const { buildSchedulingContext } = require("../netlify/functions/schedule-chat");

  const availability = [
    { id: "s1", day_of_week: 1, start_time: "09:00", end_time: "17:00" },
    { id: "s2", day_of_week: 3, start_time: "10:00", end_time: "14:00" },
  ];
  const appointments = [
    {
      id: "a1",
      scheduled_date: "2026-04-13",
      scheduled_time: "11:00",
      duration_minutes: 90,
      client_name: "Jane Smith",
      client_contact: "jane@example.com",
      title: "Consultation",
      status: "confirmed",
    },
  ];

  const ctx = buildSchedulingContext(availability, appointments);

  assert.ok(ctx.includes("Monday: 09:00 – 17:00"), "Monday availability missing");
  assert.ok(ctx.includes("Wednesday: 10:00 – 14:00"), "Wednesday availability missing");
  assert.ok(ctx.includes("2026-04-13"), "appointment date missing");
  assert.ok(ctx.includes("11:00"), "appointment time missing");
  assert.ok(ctx.includes("90 min"), "duration missing");
  assert.ok(ctx.includes("Jane Smith"), "client name missing");
  assert.ok(ctx.includes("jane@example.com"), "client contact missing");
  assert.ok(ctx.includes("Consultation"), "title missing");
}

async function testBuildSchedulingContextEmpty() {
  const { buildSchedulingContext } = require("../netlify/functions/schedule-chat");

  const ctx = buildSchedulingContext([], []);

  assert.ok(ctx.includes("No availability configured"), "empty availability message missing");
  assert.ok(ctx.includes("No upcoming appointments"), "empty appointments message missing");
}

async function run() {
  await testProTierGetsSchedulingResponse();
  await testBlackTierGetsSchedulingResponse();
  await testCoreTierDenied();
  await testMissingSessionDenied();
  await testMissingMessageRejected();
  await testOversizedMessageRejected();
  await testNonPostMethodRejected();
  await testBuildSchedulingContextFormat();
  await testBuildSchedulingContextEmpty();
  console.log("schedule-chat tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
