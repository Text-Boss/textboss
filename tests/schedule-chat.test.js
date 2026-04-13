const assert = require("node:assert/strict");

const SAMPLE_PROFILE = {
  occupation: "Mobile Hairdresser",
  services: [{ name: "Cut & Style", duration_minutes: 60 }],
  buffer_before_minutes: 15,
  buffer_after_minutes: 15,
  working_hours: null,
  onboarding_complete: true,
};

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
    createSchedulingResponse: async () => ({
      output: "Book you in.",
      usage: { total_tokens: 20 },
      toolCalls: [],
      rawOutput: [],
    }),
    getBusinessProfile: async () => SAMPLE_PROFILE,
    listAppointments: async () => [],
    createAppointment: async () => { throw new Error("should not create"); },
    updateAppointment: async () => { throw new Error("should not update"); },
    loadThreadMessages: async () => [],
    saveMessage: async () => {},
    ...overrides,
  };
}

async function testProTierGetsSchedulingResponse() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  let capturedInput = null;

  const handler = createHandler(makeProDeps({
    getBusinessProfile: async () => SAMPLE_PROFILE,
    listAppointments: async () => [
      { id: "a1", scheduled_date: "2026-04-13", scheduled_time: "10:00",
        duration_minutes: 60, client_name: "Jane", status: "confirmed" },
    ],
    createSchedulingResponse: async (input) => {
      capturedInput = input;
      return {
        output: "Monday at 9am works.",
        usage: { total_tokens: 30 },
        toolCalls: [],
        rawOutput: [],
      };
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

  assert.ok(capturedInput, "createSchedulingResponse was not called");
  assert.ok(capturedInput.extraSystemContext.includes("pro-scheduling-instructions"),
    "scheduling instructions missing from context");
  assert.ok(capturedInput.extraSystemContext.includes("Mobile Hairdresser"),
    "business profile occupation missing from context");
  assert.ok(capturedInput.extraSystemContext.includes("2026-04-13"),
    "appointment date missing from context");
  assert.ok(capturedInput.extraSystemContext.includes("Jane"),
    "client name missing from context");
  assert.ok(capturedInput.tools, "tools not passed to createSchedulingResponse");
  assert.ok(capturedInput.tools.length > 0, "tools array is empty");
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
    createSchedulingResponse: async (input) => {
      assert.ok(input.extraSystemContext.includes("black-scheduling-instructions"));
      return {
        output: "Confirmed.",
        usage: { total_tokens: 10 },
        toolCalls: [],
        rawOutput: [],
      };
    },
    getBusinessProfile: async () => null,
    listAppointments: async () => [],
    createAppointment: async () => { throw new Error("should not create"); },
    updateAppointment: async () => { throw new Error("should not update"); },
    loadThreadMessages: async () => [],
    saveMessage: async () => {},
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
    createSchedulingResponse: async () => { throw new Error("should not call OpenAI for Core"); },
    getBusinessProfile: async () => { throw new Error("should not query profile"); },
    listAppointments: async () => { throw new Error("should not query appointments"); },
    createAppointment: async () => { throw new Error("should not create"); },
    updateAppointment: async () => { throw new Error("should not update"); },
    loadThreadMessages: async () => { throw new Error("should not load threads"); },
    saveMessage: async () => { throw new Error("should not save"); },
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
    createSchedulingResponse: async () => { throw new Error("should not call OpenAI"); },
    getBusinessProfile: async () => { throw new Error("should not query"); },
    listAppointments: async () => { throw new Error("should not query"); },
    createAppointment: async () => { throw new Error("should not create"); },
    updateAppointment: async () => { throw new Error("should not update"); },
    loadThreadMessages: async () => { throw new Error("should not load"); },
    saveMessage: async () => { throw new Error("should not save"); },
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
    createSchedulingResponse: async () => { throw new Error("should not call OpenAI"); },
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
    createSchedulingResponse: async () => { throw new Error("should not call OpenAI"); },
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

  const profile = {
    occupation: "Plumber",
    services: [{ name: "Emergency call-out", duration_minutes: 90 }],
    buffer_before_minutes: 20,
    buffer_after_minutes: 20,
    working_hours: null,
  };
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

  const ctx = buildSchedulingContext(profile, appointments);

  assert.ok(ctx.includes("Plumber"), "occupation missing from context");
  assert.ok(ctx.includes("Emergency call-out"), "service name missing");
  assert.ok(ctx.includes("90 min"), "service duration or appt duration missing");
  assert.ok(ctx.includes("2026-04-13"), "appointment date missing");
  assert.ok(ctx.includes("11:00"), "appointment time missing");
  assert.ok(ctx.includes("Jane Smith"), "client name missing");
  assert.ok(ctx.includes("jane@example.com"), "client contact missing");
  assert.ok(ctx.includes("Consultation"), "title missing");
  assert.ok(ctx.includes("[id:a1]"), "appointment ID missing from context");
}

async function testBuildSchedulingContextEmpty() {
  const { buildSchedulingContext } = require("../netlify/functions/schedule-chat");

  const ctx = buildSchedulingContext(null, []);

  assert.ok(ctx.includes("No upcoming appointments"), "empty appointments message missing");
}

async function testToolCallBookAppointment() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  let createdAppt = null;
  let round = 0;

  const handler = createHandler(makeProDeps({
    createSchedulingResponse: async (input) => {
      round++;
      if (round === 1) {
        // First round: AI decides to call book_appointment
        return {
          output: "",
          usage: { total_tokens: 15 },
          toolCalls: [{
            call_id: "call_123",
            name: "book_appointment",
            arguments: JSON.stringify({
              client_name: "Jane",
              scheduled_date: "2026-04-15",
              scheduled_time: "14:00",
              duration_minutes: 30,
            }),
          }],
          rawOutput: [{ type: "function_call", call_id: "call_123", name: "book_appointment" }],
        };
      }
      // Second round: AI produces final text after tool result
      return {
        output: "Booked Jane for April 15 at 2pm, 30 minutes.",
        usage: { total_tokens: 25 },
        toolCalls: [],
        rawOutput: [],
      };
    },
    createAppointment: async (email, appt) => {
      createdAppt = { email, ...appt };
      return {
        id: "new-appt-1",
        ...appt,
        status: "confirmed",
      };
    },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "Book Jane for next Tuesday at 2pm, 30 minutes." }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.output, "Booked Jane for April 15 at 2pm, 30 minutes.");
  assert.ok(body.actions, "actions array missing");
  assert.equal(body.actions.length, 1);
  assert.equal(body.actions[0].tool, "book_appointment");
  assert.ok(body.actions[0].result.booked, "appointment not flagged as booked");

  assert.ok(createdAppt, "createAppointment was not called");
  assert.equal(createdAppt.email, "pro@example.com");
  assert.equal(createdAppt.client_name, "Jane");
  assert.equal(createdAppt.scheduled_date, "2026-04-15");
  assert.equal(createdAppt.scheduled_time, "14:00");
  assert.equal(createdAppt.duration_minutes, 30);
}

async function testToolCallCancelAppointment() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  let updatedArgs = null;

  const handler = createHandler(makeProDeps({
    createSchedulingResponse: async () => {
      if (!updatedArgs) {
        return {
          output: "",
          usage: { total_tokens: 10 },
          toolCalls: [{
            call_id: "call_456",
            name: "cancel_appointment",
            arguments: JSON.stringify({ appointment_id: "appt-to-cancel" }),
          }],
          rawOutput: [{ type: "function_call", call_id: "call_456", name: "cancel_appointment" }],
        };
      }
      return {
        output: "The appointment has been cancelled.",
        usage: { total_tokens: 20 },
        toolCalls: [],
        rawOutput: [],
      };
    },
    updateAppointment: async (id, email, updates) => {
      updatedArgs = { id, email, updates };
      return { id, status: "cancelled" };
    },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "Cancel my appointment appt-to-cancel." }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.ok(body.actions);
  assert.equal(body.actions[0].tool, "cancel_appointment");
  assert.ok(body.actions[0].result.cancelled);

  assert.ok(updatedArgs, "updateAppointment was not called");
  assert.equal(updatedArgs.id, "appt-to-cancel");
  assert.equal(updatedArgs.updates.status, "cancelled");
}

async function testToolCallRescheduleAppointment() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  let updatedArgs = null;

  const handler = createHandler(makeProDeps({
    createSchedulingResponse: async () => {
      if (!updatedArgs) {
        return {
          output: "",
          usage: { total_tokens: 10 },
          toolCalls: [{
            call_id: "call_789",
            name: "reschedule_appointment",
            arguments: JSON.stringify({
              appointment_id: "appt-to-move",
              scheduled_date: "2026-04-17",
              scheduled_time: "15:00",
            }),
          }],
          rawOutput: [{ type: "function_call", call_id: "call_789", name: "reschedule_appointment" }],
        };
      }
      return {
        output: "Rescheduled to Thursday at 3pm.",
        usage: { total_tokens: 20 },
        toolCalls: [],
        rawOutput: [],
      };
    },
    updateAppointment: async (id, email, updates) => {
      updatedArgs = { id, email, updates };
      return { id, ...updates };
    },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "Move my appointment to Thursday at 3pm." }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.actions);
  assert.equal(body.actions[0].tool, "reschedule_appointment");
  assert.ok(body.actions[0].result.rescheduled);

  assert.equal(updatedArgs.id, "appt-to-move");
  assert.equal(updatedArgs.updates.scheduled_date, "2026-04-17");
  assert.equal(updatedArgs.updates.scheduled_time, "15:00");
  assert.equal(updatedArgs.updates.status, "confirmed");
}

async function testThreadMessagesPersisted() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  const saved = [];

  const handler = createHandler(makeProDeps({
    createSchedulingResponse: async () => ({
      output: "Done.",
      usage: { total_tokens: 5 },
      toolCalls: [],
      rawOutput: [],
    }),
    loadThreadMessages: async (threadId, email) => {
      assert.equal(threadId, "thread-abc");
      assert.equal(email, "pro@example.com");
      return [
        { role: "user", content: "Earlier message" },
        { role: "assistant", content: "Earlier reply" },
      ];
    },
    saveMessage: async (threadId, role, content) => {
      saved.push({ threadId, role, content });
    },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "Follow-up", threadId: "thread-abc" }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).threadId, "thread-abc");

  assert.equal(saved.length, 2);
  assert.equal(saved[0].role, "user");
  assert.equal(saved[0].content, "Follow-up");
  assert.equal(saved[1].role, "assistant");
  assert.equal(saved[1].content, "Done.");
}

async function testSystemPromptExcludesTextMessagingInstructions() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  let capturedInput = null;

  // Use realistic text-messaging instructions that should NOT appear in the scheduling prompt
  const textMessagingInstructions = "You are Text Boss at the Pro tier. You handle situations that require structured boundary enforcement and firm authority.";

  const handler = createHandler(makeProDeps({
    getTierPolicy: () => ({
      tier: "Pro",
      instructions: textMessagingInstructions,
      inputLimit: 6000,
      responseMaxTokens: 600,
    }),
    getSchedulingInstructions: () => "You are the Text Boss scheduling assistant.",
    createSchedulingResponse: async (input) => {
      capturedInput = input;
      return { output: "Done.", usage: { total_tokens: 5 }, toolCalls: [], rawOutput: [] };
    },
  }));

  await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "What's my schedule today?" }),
  });

  assert.ok(capturedInput, "createSchedulingResponse was not called");
  // The scheduling instructions must be present
  assert.ok(capturedInput.extraSystemContext.includes("scheduling assistant"),
    "scheduling instructions missing from extraSystemContext");
  // The text-messaging instructions must NOT be in the extraSystemContext
  assert.ok(!capturedInput.extraSystemContext.includes("boundary enforcement"),
    "text-messaging instructions leaked into scheduling context");
}

async function testSchedulingPromptContainsOffTopicRefusal() {
  const { getSchedulingInstructions } = require("../netlify/functions/_lib/tier-policy");

  const proInstructions = getSchedulingInstructions("Pro");
  const blackInstructions = getSchedulingInstructions("Black");

  // Both tiers must instruct the AI to refuse non-scheduling requests
  assert.ok(proInstructions.includes("Messages tab"),
    "Pro scheduling instructions missing off-topic refusal");
  assert.ok(blackInstructions.includes("Messages tab"),
    "Black scheduling instructions missing off-topic refusal");

  // Neither should contain text-messaging language
  assert.ok(!proInstructions.includes("scope creep"),
    "Pro scheduling instructions contain text-messaging language");
  assert.ok(!blackInstructions.includes("scope creep"),
    "Black scheduling instructions contain text-messaging language");
}

async function testSchedulingPromptRequiresToolCallBeforeConfirming() {
  const { getSchedulingInstructions } = require("../netlify/functions/_lib/tier-policy");

  const proInstructions = getSchedulingInstructions("Pro");
  const blackInstructions = getSchedulingInstructions("Black");

  // Both must require find_available_slots before suggesting times
  assert.ok(proInstructions.includes("find_available_slots"),
    "Pro scheduling instructions missing find_available_slots requirement");
  assert.ok(blackInstructions.includes("find_available_slots"),
    "Black scheduling instructions missing find_available_slots requirement");

  // Both must require explicit user confirmation before booking
  assert.ok(proInstructions.includes("explicitly confirmed") || proInstructions.includes("explicit confirmation"),
    "Pro scheduling instructions missing booking confirmation requirement");
  assert.ok(blackInstructions.includes("explicitly confirmed") || blackInstructions.includes("explicit confirmation"),
    "Black scheduling instructions missing booking confirmation requirement");
}

async function testCoreHasNoSchedulingInstructions() {
  const { getSchedulingInstructions } = require("../netlify/functions/_lib/tier-policy");

  const coreInstructions = getSchedulingInstructions("Core");
  assert.equal(coreInstructions, null, "Core should have no scheduling instructions");
}

async function testSchedulingToolsExported() {
  const { SCHEDULING_TOOLS } = require("../netlify/functions/schedule-chat");

  assert.ok(Array.isArray(SCHEDULING_TOOLS), "SCHEDULING_TOOLS not an array");
  assert.equal(SCHEDULING_TOOLS.length, 6);

  const toolNames = SCHEDULING_TOOLS.map(t => t.name);
  assert.ok(toolNames.includes("find_available_slots"), "find_available_slots missing");
  assert.ok(toolNames.includes("list_appointments"));
  assert.ok(toolNames.includes("book_appointment"));
  assert.ok(toolNames.includes("cancel_appointment"));
  assert.ok(toolNames.includes("reschedule_appointment"));
  assert.ok(toolNames.includes("add_busy_block"), "add_busy_block missing");
  assert.ok(!toolNames.includes("get_availability"), "old get_availability tool still present");
}

async function testBookAppointmentEmitsNotification() {
  const { createHandler } = require("../netlify/functions/schedule-chat");

  let round = 0;

  const handler = createHandler(makeProDeps({
    createSchedulingResponse: async () => {
      round++;
      if (round === 1) {
        return {
          output: "",
          usage: { total_tokens: 10 },
          toolCalls: [{
            call_id: "call_notif",
            name: "book_appointment",
            arguments: JSON.stringify({ scheduled_date: "2026-04-15", scheduled_time: "10:00" }),
          }],
          rawOutput: [{ type: "function_call", call_id: "call_notif", name: "book_appointment" }],
        };
      }
      return { output: "Booked.", usage: { total_tokens: 5 }, toolCalls: [], rawOutput: [] };
    },
    createAppointment: async (email, appt) => ({
      id: "notif-appt",
      ...appt,
      status: "confirmed",
    }),
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ message: "Book me Tuesday 10am." }),
  });

  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.ok(body.notification, "notification field missing after booking");
  assert.equal(body.notification.type, "appointment_created");
  assert.equal(body.notification.appointment.id, "notif-appt");
  // _notify internal flag must be stripped from actions
  assert.ok(!body.actions[0].result._notify, "_notify flag leaked into response");
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
  await testToolCallBookAppointment();
  await testToolCallCancelAppointment();
  await testToolCallRescheduleAppointment();
  await testThreadMessagesPersisted();
  await testSystemPromptExcludesTextMessagingInstructions();
  await testSchedulingPromptContainsOffTopicRefusal();
  await testSchedulingPromptRequiresToolCallBeforeConfirming();
  await testCoreHasNoSchedulingInstructions();
  await testSchedulingToolsExported();
  await testBookAppointmentEmitsNotification();
  console.log("schedule-chat tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
