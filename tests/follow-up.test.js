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
  countActiveJobs:     async () => 0,
  createJob:           async () => { throw new Error("should not create job"); },
  createMessages:      async () => { throw new Error("should not create messages"); },
  listJobs:            async () => { throw new Error("should not list jobs"); },
  listMessages:        async () => { throw new Error("should not list messages"); },
  listPendingMessages: async () => { throw new Error("should not list pending"); },
  markSent:            async () => { throw new Error("should not mark sent"); },
  skipMessage:         async () => { throw new Error("should not skip"); },
  updateJob:           async () => { throw new Error("should not update job"); },
  callOpenAI:          async () => { throw new Error("should not call OpenAI"); },
};

const VALID_AI_RESPONSE = JSON.stringify([
  { delay_days: 7, purpose: "check-in + review", draft: "Hi Jane, how are you enjoying the coating?" },
  { delay_days: 14, purpose: "rebooking reminder", draft: "Hi Jane, time to schedule a maintenance wash." },
]);

async function testPostCreatesJobAndMessages() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const createdJob = {
    id: "job-1",
    client_name: "Jane",
    service_name: "Ceramic Coating",
    service_date: "2026-04-01",
    status: "active",
  };

  const createdMessages = [
    { id: "msg-1", job_id: "job-1", send_date: "2026-04-08", purpose: "check-in + review", draft_message: "Hi Jane, how are you enjoying the coating?", status: "pending" },
    { id: "msg-2", job_id: "job-1", send_date: "2026-04-15", purpose: "rebooking reminder", draft_message: "Hi Jane, time to schedule a maintenance wash.", status: "pending" },
  ];

  let capturedMessages = null;

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    countActiveJobs: async () => 0,
    createJob: async (email, data) => {
      assert.equal(email, "pro@example.com");
      assert.equal(data.client_name, "Jane");
      assert.equal(data.service_name, "Ceramic Coating");
      return createdJob;
    },
    createMessages: async (msgs) => {
      capturedMessages = msgs;
      return createdMessages;
    },
    callOpenAI: async () => VALID_AI_RESPONSE,
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({
      client_name: "Jane",
      service_name: "Ceramic Coating",
      service_date: "2026-04-01",
    }),
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.job.id, "job-1");
  assert.equal(body.messages.length, 2);

  // Verify send dates were computed from service_date + delay_days
  assert.equal(capturedMessages[0].send_date, "2026-04-08"); // April 1 + 7
  assert.equal(capturedMessages[1].send_date, "2026-04-15"); // April 1 + 14
  assert.equal(capturedMessages[0].purpose, "check-in + review");
}

async function testPostRejectsMissingClientName() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({
      service_name: "Ceramic Coating",
      service_date: "2026-04-01",
    }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_client_name");
}

async function testPostRejectsMissingServiceName() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({
      client_name: "Jane",
      service_date: "2026-04-01",
    }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_service_name");
}

async function testPostRejectsInvalidServiceDate() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({
      client_name: "Jane",
      service_name: "Coating",
      service_date: "01-04-2026",
    }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "invalid_service_date");
}

async function testCoreTierDenied() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Core"),
    ...NOOP,
    listJobs: async () => { throw new Error("should not reach store"); },
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).reason, "tier_not_entitled");
}

async function testProTierLimitEnforced() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    countActiveJobs: async () => 10,
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({
      client_name: "Jane",
      service_name: "Coating",
      service_date: "2026-04-01",
    }),
  });

  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).reason, "follow_up_limit_reached");
}

async function testBlackTierNoLimit() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const createdJob = { id: "job-2", client_name: "Bob", service_name: "Detailing", status: "active" };

  const handler = createHandler({
    ...makeAuth("Black"),
    ...NOOP,
    countActiveJobs: async () => 999, // Would block Pro but not Black
    createJob: async () => createdJob,
    createMessages: async () => [],
    callOpenAI: async () => JSON.stringify([
      { delay_days: 3, purpose: "quality check", draft: "Hi Bob." },
      { delay_days: 7, purpose: "review request", draft: "Hi Bob, review?" },
      { delay_days: 14, purpose: "rebooking", draft: "Hi Bob, rebook?" },
      { delay_days: 30, purpose: "relationship maintenance", draft: "Hi Bob, checking in." },
    ]),
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({
      client_name: "Bob",
      service_name: "Detailing",
      service_date: "2026-04-01",
    }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
}

async function testGetListsJobs() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const jobs = [{ id: "job-1", client_name: "Jane", status: "active" }];

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    listJobs: async (email) => {
      assert.equal(email, "pro@example.com");
      return jobs;
    },
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, jobs });
}

async function testGetPendingMessages() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const messages = [{ id: "msg-1", purpose: "check-in", status: "pending" }];

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    listMessages: async (email, opts) => {
      assert.equal(email, "pro@example.com");
      assert.equal(opts.status, "pending");
      return messages;
    },
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: { pending: "true" },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, messages });
}

async function testPatchMarksSent() {
  const { createHandler } = require("../netlify/functions/follow-up");

  let sentId = null;
  let sentEmail = null;

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    markSent: async (id, email) => {
      sentId = id;
      sentEmail = email;
    },
  });

  const res = await handler({
    httpMethod: "PATCH",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ messageId: "msg-1", action: "sent" }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.equal(sentId, "msg-1");
  assert.equal(sentEmail, "pro@example.com");
}

async function testPatchSkipsMessage() {
  const { createHandler } = require("../netlify/functions/follow-up");

  let skippedId = null;

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    skipMessage: async (id) => { skippedId = id; },
  });

  const res = await handler({
    httpMethod: "PATCH",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ messageId: "msg-2", action: "skipped" }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.equal(skippedId, "msg-2");
}

async function testPatchRejectsInvalidAction() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
  });

  const res = await handler({
    httpMethod: "PATCH",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ messageId: "msg-1", action: "delete" }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "invalid_action");
}

async function testPatchRejectsMissingMessageId() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
  });

  const res = await handler({
    httpMethod: "PATCH",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ action: "sent" }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_message_id");
}

async function testDeleteCancelsJob() {
  const { createHandler } = require("../netlify/functions/follow-up");

  let updatedId = null;
  let updatedStatus = null;

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    updateJob: async (id, email, updates) => {
      updatedId = id;
      updatedStatus = updates.status;
      assert.equal(email, "pro@example.com");
      return { id, status: "cancelled" };
    },
  });

  const res = await handler({
    httpMethod: "DELETE",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ jobId: "job-1" }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.equal(JSON.parse(res.body).cancelled, true);
  assert.equal(updatedId, "job-1");
  assert.equal(updatedStatus, "cancelled");
}

async function testDeleteRejectsMissingJobId() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
  });

  const res = await handler({
    httpMethod: "DELETE",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({}),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_job_id");
}

async function testAiParseErrorReturns502() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    countActiveJobs: async () => 0,
    callOpenAI: async () => "This is not valid JSON at all.",
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({
      client_name: "Jane",
      service_name: "Coating",
      service_date: "2026-04-01",
    }),
  });

  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).reason, "ai_parse_error");
}

async function testMethodNotAllowed() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
  });

  const res = await handler({
    httpMethod: "PUT",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 405);
  assert.equal(JSON.parse(res.body).reason, "method_not_allowed");
}

async function testUnauthenticatedDenied() {
  const { createHandler } = require("../netlify/functions/follow-up");

  const handler = createHandler({
    ...NOOP,
    verifySessionCookie: () => ({ ok: false, reason: "missing_session" }),
    findEntitlementByEmail: async () => null,
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).reason, "missing_session");
}

async function run() {
  await testPostCreatesJobAndMessages();
  await testPostRejectsMissingClientName();
  await testPostRejectsMissingServiceName();
  await testPostRejectsInvalidServiceDate();
  await testCoreTierDenied();
  await testProTierLimitEnforced();
  await testBlackTierNoLimit();
  await testGetListsJobs();
  await testGetPendingMessages();
  await testPatchMarksSent();
  await testPatchSkipsMessage();
  await testPatchRejectsInvalidAction();
  await testPatchRejectsMissingMessageId();
  await testDeleteCancelsJob();
  await testDeleteRejectsMissingJobId();
  await testAiParseErrorReturns502();
  await testMethodNotAllowed();
  await testUnauthenticatedDenied();
  console.log("follow-up tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
