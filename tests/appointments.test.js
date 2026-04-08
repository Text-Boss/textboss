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
  listAppointments:  async () => { throw new Error("should not list"); },
  createAppointment: async () => { throw new Error("should not create"); },
  updateAppointment: async () => { throw new Error("should not update"); },
  deleteAppointment: async () => { throw new Error("should not delete"); },
};

async function testGetListsUpcomingByDefault() {
  const { createHandler } = require("../netlify/functions/appointments");

  const appts = [
    { id: "a1", scheduled_date: "2026-04-10", scheduled_time: "10:00", status: "confirmed" },
  ];

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    listAppointments: async (email, upcomingOnly) => {
      assert.equal(email, "pro@example.com");
      assert.equal(upcomingOnly, true);
      return appts;
    },
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, appointments: appts });
}

async function testGetAllParamPassedThrough() {
  const { createHandler } = require("../netlify/functions/appointments");

  const handler = createHandler({
    ...makeAuth("Black"),
    ...NOOP,
    listAppointments: async (email, upcomingOnly) => {
      assert.equal(upcomingOnly, false);
      return [];
    },
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: { all: "true" },
  });

  assert.equal(res.statusCode, 200);
}

async function testPostCreatesAppointment() {
  const { createHandler } = require("../netlify/functions/appointments");

  const created = {
    id: "a2",
    client_name: "Jane Smith",
    scheduled_date: "2026-04-15",
    scheduled_time: "14:00",
    duration_minutes: 60,
    status: "confirmed",
  };

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    createAppointment: async (email, appt) => {
      assert.equal(email, "pro@example.com");
      assert.equal(appt.scheduled_date, "2026-04-15");
      assert.equal(appt.scheduled_time, "14:00");
      return created;
    },
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({
      client_name: "Jane Smith",
      scheduled_date: "2026-04-15",
      scheduled_time: "14:00",
    }),
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, appointment: created });
}

async function testPostRejectsInvalidDate() {
  const { createHandler } = require("../netlify/functions/appointments");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    createAppointment: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ scheduled_date: "15-04-2026", scheduled_time: "14:00" }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "invalid_scheduled_date");
}

async function testPostRejectsInvalidTime() {
  const { createHandler } = require("../netlify/functions/appointments");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    createAppointment: async () => {},
  });

  const res = await handler({
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ scheduled_date: "2026-04-15", scheduled_time: "2pm" }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "invalid_scheduled_time");
}

async function testPatchUpdatesAppointment() {
  const { createHandler } = require("../netlify/functions/appointments");

  const updated = { id: "a1", status: "cancelled" };

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    updateAppointment: async (id, email, updates) => {
      assert.equal(id, "a1");
      assert.equal(email, "pro@example.com");
      assert.equal(updates.status, "cancelled");
      return updated;
    },
  });

  const res = await handler({
    httpMethod: "PATCH",
    headers: {},
    queryStringParameters: { id: "a1" },
    body: JSON.stringify({ status: "cancelled" }),
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, appointment: updated });
}

async function testPatchRejectsInvalidStatus() {
  const { createHandler } = require("../netlify/functions/appointments");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    updateAppointment: async () => {},
  });

  const res = await handler({
    httpMethod: "PATCH",
    headers: {},
    queryStringParameters: { id: "a1" },
    body: JSON.stringify({ status: "done" }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "invalid_status");
}

async function testPatchMissingIdRejected() {
  const { createHandler } = require("../netlify/functions/appointments");

  const handler = createHandler({
    ...makeAuth("Pro"),
    ...NOOP,
    updateAppointment: async () => {},
  });

  const res = await handler({
    httpMethod: "PATCH",
    headers: {},
    queryStringParameters: {},
    body: JSON.stringify({ status: "confirmed" }),
  });

  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).reason, "missing_id");
}

async function testDeleteRemovesAppointment() {
  const { createHandler } = require("../netlify/functions/appointments");

  let deleted = null;

  const handler = createHandler({
    ...makeAuth("Black"),
    ...NOOP,
    deleteAppointment: async (id, email) => {
      deleted = { id, email };
    },
  });

  const res = await handler({
    httpMethod: "DELETE",
    headers: {},
    queryStringParameters: { id: "a1" },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, deleted: true });
  assert.deepEqual(deleted, { id: "a1", email: "pro@example.com" });
}

async function testCoreTierDenied() {
  const { createHandler } = require("../netlify/functions/appointments");

  const handler = createHandler({
    ...makeAuth("Core"),
    ...NOOP,
    listAppointments: async () => { throw new Error("should not reach store"); },
  });

  const res = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).reason, "tier_not_entitled");
}

async function run() {
  await testGetListsUpcomingByDefault();
  await testGetAllParamPassedThrough();
  await testPostCreatesAppointment();
  await testPostRejectsInvalidDate();
  await testPostRejectsInvalidTime();
  await testPatchUpdatesAppointment();
  await testPatchRejectsInvalidStatus();
  await testPatchMissingIdRejected();
  await testDeleteRemovesAppointment();
  await testCoreTierDenied();
  console.log("appointments tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
