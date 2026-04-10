const assert = require("node:assert/strict");

function makeDeps(overrides = {}) {
  return {
    verifyScheduledAccess: () => ({ ok: true }),
    listPendingMessages: async () => [],
    markNotified: async () => {},
    getSubscriptionsByEmail: async () => [],
    deleteSubscriptionById: async () => {},
    sendPushNotification: null,
    getJobById: null,
    ...overrides,
  };
}

async function testReturnsEmptyWhenNoPendingMessages() {
  const { createHandler } = require("../netlify/functions/send-follow-ups");

  const handler = createHandler(makeDeps());

  const res = await handler({
    httpMethod: "POST",
    headers: {},
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.count, 0);
  assert.deepEqual(body.notified, []);
}

async function testFindsAndNotifiesMessages() {
  const { createHandler } = require("../netlify/functions/send-follow-ups");

  const notifiedIds = [];

  const handler = createHandler(makeDeps({
    listPendingMessages: async () => [
      {
        id: "msg-1",
        job_id: "job-1",
        owner_email: "user@example.com",
        purpose: "check-in + review",
        send_date: "2026-04-10",
        draft_message: "Hi Jane, how is the coating holding up?",
      },
      {
        id: "msg-2",
        job_id: "job-1",
        owner_email: "user@example.com",
        purpose: "rebooking reminder",
        send_date: "2026-04-10",
        draft_message: "Hi Jane, time to schedule maintenance.",
      },
    ],
    markNotified: async (id) => {
      notifiedIds.push(id);
    },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.equal(body.notified.length, 2);
  assert.equal(body.notified[0].id, "msg-1");
  assert.equal(body.notified[0].purpose, "check-in + review");
  assert.equal(body.notified[1].id, "msg-2");

  assert.deepEqual(notifiedIds, ["msg-1", "msg-2"]);
}

async function testSendsPushNotifications() {
  const { createHandler } = require("../netlify/functions/send-follow-ups");

  const pushPayloads = [];

  const handler = createHandler(makeDeps({
    listPendingMessages: async () => [
      {
        id: "msg-1",
        job_id: "job-1",
        owner_email: "user@example.com",
        purpose: "check-in",
        send_date: "2026-04-10",
        draft_message: "Hi there.",
      },
    ],
    markNotified: async () => {},
    getSubscriptionsByEmail: async () => [
      { id: "sub-1", endpoint: "https://push.example.com", p256dh: "key1", auth: "auth1" },
    ],
    sendPushNotification: async (sub, payload) => {
      pushPayloads.push({ sub, payload });
    },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
  });

  assert.equal(res.statusCode, 200);
  assert.equal(pushPayloads.length, 1);
  assert.equal(pushPayloads[0].payload.title, "Text Boss \u00b7 Follow-Up Ready");
  assert.equal(pushPayloads[0].payload.data.type, "follow_up");
  assert.equal(pushPayloads[0].payload.data.messageId, "msg-1");
}

async function testUnauthorizedAccessDenied() {
  const { createHandler } = require("../netlify/functions/send-follow-ups");

  const handler = createHandler(makeDeps({
    verifyScheduledAccess: () => ({ ok: false, reason: "unauthorized" }),
    listPendingMessages: async () => { throw new Error("should not query"); },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
  });

  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).reason, "unauthorized");
}

async function testNonPostMethodRejected() {
  const { createHandler } = require("../netlify/functions/send-follow-ups");

  const handler = createHandler(makeDeps());

  const res = await handler({
    httpMethod: "GET",
    headers: {},
  });

  assert.equal(res.statusCode, 405);
  assert.equal(JSON.parse(res.body).reason, "method_not_allowed");
}

async function testMarkNotifiedErrorPropagates() {
  const { createHandler } = require("../netlify/functions/send-follow-ups");

  const handler = createHandler(makeDeps({
    listPendingMessages: async () => [
      { id: "msg-err", job_id: "j1", owner_email: "u@e.com", send_date: "2026-04-10", purpose: "x", draft_message: "y" },
    ],
    markNotified: async () => {
      throw new Error("db_error");
    },
  }));

  await assert.rejects(
    async () => handler({ httpMethod: "POST", headers: {} }),
    { message: "db_error" },
  );
}

async function testExpiredPushSubscriptionRemoved() {
  const { createHandler } = require("../netlify/functions/send-follow-ups");

  let deletedSubId = null;

  const handler = createHandler(makeDeps({
    listPendingMessages: async () => [
      { id: "msg-1", job_id: "j1", owner_email: "u@e.com", send_date: "2026-04-10", purpose: "x", draft_message: "y" },
    ],
    markNotified: async () => {},
    getSubscriptionsByEmail: async () => [
      { id: "sub-expired", endpoint: "https://gone.example.com", p256dh: "k", auth: "a" },
    ],
    deleteSubscriptionById: async (id) => { deletedSubId = id; },
    sendPushNotification: async () => {
      const err = new Error("Gone");
      err.statusCode = 410;
      throw err;
    },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
  });

  assert.equal(res.statusCode, 200);
  assert.equal(deletedSubId, "sub-expired");
}

async function run() {
  await testReturnsEmptyWhenNoPendingMessages();
  await testFindsAndNotifiesMessages();
  await testSendsPushNotifications();
  await testUnauthorizedAccessDenied();
  await testNonPostMethodRejected();
  await testMarkNotifiedErrorPropagates();
  await testExpiredPushSubscriptionRemoved();
  console.log("send-follow-ups tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
