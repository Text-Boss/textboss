const assert = require("node:assert/strict");

function makeDeps(overrides = {}) {
  return {
    verifyScheduledAccess: () => ({ ok: true }),
    findUpcomingUnreminded: async () => [],
    markReminded: async () => {},
    ...overrides,
  };
}

async function testReturnsEmptyWhenNoAppointments() {
  const { createHandler } = require("../netlify/functions/send-reminders");

  const handler = createHandler(makeDeps());

  const res = await handler({
    httpMethod: "POST",
    headers: {},
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.count, 0);
  assert.deepEqual(body.reminded, []);
}

async function testFindsAndMarksAppointments() {
  const { createHandler } = require("../netlify/functions/send-reminders");

  const markedIds = [];

  const handler = createHandler(makeDeps({
    findUpcomingUnreminded: async () => [
      {
        id: "appt-1",
        owner_email: "user@example.com",
        client_name: "Jane",
        client_contact: "jane@test.com",
        title: "Consultation",
        scheduled_date: "2026-04-09",
        scheduled_time: "14:00",
      },
      {
        id: "appt-2",
        owner_email: "user@example.com",
        client_name: "Bob",
        client_contact: null,
        title: "Follow-up",
        scheduled_date: "2026-04-09",
        scheduled_time: "16:00",
      },
    ],
    markReminded: async (id) => {
      markedIds.push(id);
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
  assert.equal(body.reminded.length, 2);
  assert.equal(body.reminded[0].id, "appt-1");
  assert.equal(body.reminded[0].client_name, "Jane");
  assert.equal(body.reminded[1].id, "appt-2");

  assert.deepEqual(markedIds, ["appt-1", "appt-2"]);
}

async function testUnauthorizedAccessDenied() {
  const { createHandler } = require("../netlify/functions/send-reminders");

  const handler = createHandler(makeDeps({
    verifyScheduledAccess: () => ({ ok: false, reason: "unauthorized" }),
    findUpcomingUnreminded: async () => { throw new Error("should not query"); },
  }));

  const res = await handler({
    httpMethod: "POST",
    headers: {},
  });

  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).reason, "unauthorized");
}

async function testNonPostMethodRejected() {
  const { createHandler } = require("../netlify/functions/send-reminders");

  const handler = createHandler(makeDeps());

  const res = await handler({
    httpMethod: "GET",
    headers: {},
  });

  assert.equal(res.statusCode, 405);
  assert.equal(JSON.parse(res.body).reason, "method_not_allowed");
}

async function testMarkRemindedErrorPropagates() {
  const { createHandler } = require("../netlify/functions/send-reminders");

  const handler = createHandler(makeDeps({
    findUpcomingUnreminded: async () => [
      { id: "appt-err", owner_email: "u@e.com", scheduled_date: "2026-04-09", scheduled_time: "10:00" },
    ],
    markReminded: async () => {
      throw new Error("db_error");
    },
  }));

  await assert.rejects(
    async () => handler({ httpMethod: "POST", headers: {} }),
    { message: "db_error" },
  );
}

async function run() {
  await testReturnsEmptyWhenNoAppointments();
  await testFindsAndMarksAppointments();
  await testUnauthorizedAccessDenied();
  await testNonPostMethodRejected();
  await testMarkRemindedErrorPropagates();
  console.log("send-reminders tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
