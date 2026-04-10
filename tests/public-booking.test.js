const assert = require("node:assert/strict");

const SAMPLE_PROFILE = {
  email: "owner@example.com",
  occupation: "Mobile Hairdresser",
  services: [
    { name: "Cut & Style", duration_minutes: 60 },
    { name: "Colour", duration_minutes: 120 },
  ],
  buffer_before_minutes: 15,
  buffer_after_minutes: 15,
  working_hours: { "1": { start: "09:00", end: "17:00" } },
  onboarding_complete: true,
  booking_slug: "abc12345",
};

function makeDeps(overrides = {}) {
  return {
    getProfileBySlug: async (slug) => {
      if (slug === "abc12345") return SAMPLE_PROFILE;
      return null;
    },
    getEntitlementByEmail: async (email) => {
      if (email === "owner@example.com") {
        return {
          email: "owner@example.com",
          entitled_tier: "Pro",
          subscription_status: "active",
        };
      }
      return null;
    },
    listAppointments: async () => [],
    createAppointment: async (email, appt) => ({
      id: "appt-new-1",
      ...appt,
      status: "confirmed",
      created_at: "2026-04-10T00:00:00Z",
    }),
    generateICSData: (params) => "BEGIN:VCALENDAR\r\nMOCK ICS\r\nEND:VCALENDAR",
    sendOwnerNotification: null,
    callOpenAI: async () => ({
      output: "I can help you book an appointment.",
      toolCalls: [],
      rawOutput: [],
    }),
    ...overrides,
  };
}

function makeEvent(body, method = "POST") {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify(body),
  };
}

// ── Init flow tests ────────────────────────────────────────────────────────────

async function testInitReturnsProfileData() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps());
  const res = await handler(makeEvent({ slug: "abc12345", message: "__init__" }));

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.businessName, "Mobile Hairdresser");
  assert.equal(body.services.length, 2);
  assert.equal(body.services[0].name, "Cut & Style");
}

async function testInitReturns404ForUnknownSlug() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps());
  const res = await handler(makeEvent({ slug: "unknown99", message: "__init__" }));

  assert.equal(res.statusCode, 404);
}

// ── Security tests ─────────────────────────────────────────────────────────────

async function testDeniesCoreTierOwner() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps({
    getEntitlementByEmail: async () => ({
      email: "owner@example.com",
      entitled_tier: "Core",
      subscription_status: "active",
    }),
  }));

  const res = await handler(makeEvent({ slug: "abc12345", message: "__init__" }));

  // Returns 404 to avoid leaking that the slug exists
  assert.equal(res.statusCode, 404);
}

async function testDeniesInactiveSubscription() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps({
    getEntitlementByEmail: async () => ({
      email: "owner@example.com",
      entitled_tier: "Pro",
      subscription_status: "canceled",
    }),
  }));

  const res = await handler(makeEvent({ slug: "abc12345", message: "__init__" }));
  assert.equal(res.statusCode, 404);
}

async function testDeniesNoEntitlement() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps({
    getEntitlementByEmail: async () => null,
  }));

  const res = await handler(makeEvent({ slug: "abc12345", message: "__init__" }));
  assert.equal(res.statusCode, 404);
}

async function testDeniesEmptySlug() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps());
  const res = await handler(makeEvent({ slug: "", message: "__init__" }));
  assert.equal(res.statusCode, 404);
}

async function testDeniesMessageTooLong() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps());
  const longMessage = "a".repeat(2001);
  const res = await handler(makeEvent({ slug: "abc12345", message: longMessage }));

  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.reason, "message_too_long");
}

async function testDeniesConversationTooLong() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps());
  const conversation = Array.from({ length: 21 }, (_, i) => ({
    role: "user",
    content: [{ type: "input_text", text: `msg ${i}` }],
  }));
  const res = await handler(makeEvent({
    slug: "abc12345",
    message: "hello",
    conversation,
  }));

  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.reason, "conversation_too_long");
}

async function testDeniesGetMethod() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps());
  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
    body: null,
  });

  assert.equal(res.statusCode, 405);
}

// ── Conversation flow tests ────────────────────────────────────────────────────

async function testNormalConversation() {
  const { createHandler } = require("../netlify/functions/public-booking");

  let capturedArgs = null;
  const handler = createHandler(makeDeps({
    callOpenAI: async (args) => {
      capturedArgs = args;
      return {
        output: "I have availability on Monday at 10am.",
        toolCalls: [],
        rawOutput: [],
      };
    },
  }));

  const res = await handler(makeEvent({
    slug: "abc12345",
    message: "I need a haircut",
  }));

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.output, "I have availability on Monday at 10am.");
  assert.ok(!body.booking, "should not include booking on non-booking response");

  // Verify system prompt was constructed correctly
  assert.ok(capturedArgs.systemPrompt.includes("Mobile Hairdresser"));
  assert.ok(capturedArgs.systemPrompt.includes("Cut & Style"));
  assert.ok(capturedArgs.message === "I need a haircut");
}

// ── Booking confirmation flow ──────────────────────────────────────────────────

async function testBookingConfirmation() {
  const { createHandler } = require("../netlify/functions/public-booking");

  let appointmentCreated = null;
  let icsGenerated = null;

  const handler = createHandler(makeDeps({
    createAppointment: async (email, appt) => {
      appointmentCreated = { email, appt };
      return {
        id: "appt-123",
        client_name: appt.client_name,
        client_contact: appt.client_contact,
        title: appt.title,
        scheduled_date: appt.scheduled_date,
        scheduled_time: appt.scheduled_time,
        duration_minutes: appt.duration_minutes,
        status: "confirmed",
      };
    },
    generateICSData: (params) => {
      icsGenerated = params;
      return "BEGIN:VCALENDAR\r\nTEST\r\nEND:VCALENDAR";
    },
    callOpenAI: async () => ({
      output: "",
      toolCalls: [{
        call_id: "call-1",
        name: "confirm_booking",
        arguments: JSON.stringify({
          client_name: "Jane Doe",
          client_email: "jane@example.com",
          service_name: "Cut & Style",
          scheduled_date: "2026-04-15",
          scheduled_time: "10:00",
          duration_minutes: 60,
        }),
      }],
      rawOutput: [{ type: "function_call", call_id: "call-1", name: "confirm_booking", arguments: "{}" }],
    }),
  }));

  // Second round after tool call returns final text
  let callCount = 0;
  const handlerWithMultiRound = createHandler(makeDeps({
    createAppointment: async (email, appt) => {
      appointmentCreated = { email, appt };
      return {
        id: "appt-123",
        client_name: appt.client_name,
        client_contact: appt.client_contact,
        title: appt.title,
        scheduled_date: appt.scheduled_date,
        scheduled_time: appt.scheduled_time,
        duration_minutes: appt.duration_minutes,
        status: "confirmed",
      };
    },
    generateICSData: (params) => {
      icsGenerated = params;
      return "BEGIN:VCALENDAR\r\nTEST\r\nEND:VCALENDAR";
    },
    callOpenAI: async () => {
      callCount++;
      if (callCount === 1) {
        return {
          output: "",
          toolCalls: [{
            call_id: "call-1",
            name: "confirm_booking",
            arguments: JSON.stringify({
              client_name: "Jane Doe",
              client_email: "jane@example.com",
              service_name: "Cut & Style",
              scheduled_date: "2026-04-15",
              scheduled_time: "10:00",
              duration_minutes: 60,
            }),
          }],
          rawOutput: [{ type: "function_call", call_id: "call-1", name: "confirm_booking", arguments: "{}" }],
        };
      }
      return {
        output: "Confirmed — Tuesday, 2026-04-15 at 10:00, 60 minutes.",
        toolCalls: [],
        rawOutput: [],
      };
    },
  }));

  const res = await handlerWithMultiRound(makeEvent({
    slug: "abc12345",
    message: "Yes, book me in",
  }));

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.ok(body.output.includes("Confirmed"));

  // Verify booking result
  assert.ok(body.booking, "should include booking object");
  assert.equal(body.booking.id, "appt-123");
  assert.equal(body.booking.date, "2026-04-15");
  assert.equal(body.booking.time, "10:00");
  assert.equal(body.booking.duration, 60);
  assert.equal(body.booking.title, "Cut & Style");
  assert.ok(body.booking.icsData.includes("BEGIN:VCALENDAR"));

  // Verify appointment was created with correct owner email
  assert.equal(appointmentCreated.email, "owner@example.com");
  assert.equal(appointmentCreated.appt.client_name, "Jane Doe");
  assert.equal(appointmentCreated.appt.client_contact, "jane@example.com");

  // Verify ICS was generated
  assert.ok(icsGenerated);
  assert.equal(icsGenerated.title, "Cut & Style");
  assert.equal(icsGenerated.attendeeEmail, "jane@example.com");
  assert.equal(icsGenerated.organizerEmail, null, "should not expose owner email");
}

// ── Black tier owner test ──────────────────────────────────────────────────────

async function testBlackTierOwnerAllowed() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps({
    getEntitlementByEmail: async () => ({
      email: "owner@example.com",
      entitled_tier: "Black",
      subscription_status: "active",
    }),
  }));

  const res = await handler(makeEvent({ slug: "abc12345", message: "__init__" }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
}

// ── Missing message test ───────────────────────────────────────────────────────

async function testMissingMessage() {
  const { createHandler } = require("../netlify/functions/public-booking");

  const handler = createHandler(makeDeps());
  const res = await handler(makeEvent({ slug: "abc12345" }));

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_message");
}

async function run() {
  await testInitReturnsProfileData();
  await testInitReturns404ForUnknownSlug();
  await testDeniesCoreTierOwner();
  await testDeniesInactiveSubscription();
  await testDeniesNoEntitlement();
  await testDeniesEmptySlug();
  await testDeniesMessageTooLong();
  await testDeniesConversationTooLong();
  await testDeniesGetMethod();
  await testNormalConversation();
  await testBookingConfirmation();
  await testBlackTierOwnerAllowed();
  await testMissingMessage();
  console.log("public-booking tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
