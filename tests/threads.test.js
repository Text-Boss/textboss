const assert = require("node:assert/strict");

function makeAuth(tier) {
  return {
    verifySessionCookie: () => ({
      ok: true,
      session: { email: "user@example.com", tier },
    }),
    findEntitlementByEmail: async (email) => ({
      email,
      entitled_tier: tier,
      subscription_status: "active",
    }),
  };
}

async function testListThreadsReturnsUserThreads() {
  const { createHandler } = require("../netlify/functions/threads");

  const fakeThreads = [
    { id: "t1", title: "First thread", created_at: "2026-01-01", updated_at: "2026-01-02" },
    { id: "t2", title: "Second thread", created_at: "2026-01-01", updated_at: "2026-01-01" },
  ];

  const handler = createHandler({
    ...makeAuth("Core"),
    listThreads: async (email, limit) => {
      assert.equal(email, "user@example.com");
      assert.equal(limit, 10);
      return fakeThreads;
    },
    createThread: async () => { throw new Error("should not create"); },
    getThreadWithMessages: async () => { throw new Error("should not get"); },
    deleteThread: async () => { throw new Error("should not delete"); },
  });

  const response = await handler({
    httpMethod: "GET",
    headers: { cookie: "textboss_session=signed" },
    queryStringParameters: {},
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.threads.length, 2);
  assert.equal(body.threads[0].id, "t1");
}

async function testCreateThreadReturnsNewThread() {
  const { createHandler } = require("../netlify/functions/threads");

  const handler = createHandler({
    ...makeAuth("Pro"),
    listThreads: async () => { throw new Error("should not list"); },
    createThread: async (email, tier) => {
      assert.equal(email, "user@example.com");
      assert.equal(tier, "Pro");
      return { id: "t-new", title: "New conversation", created_at: "2026-04-06", updated_at: "2026-04-06" };
    },
    getThreadWithMessages: async () => { throw new Error("should not get"); },
    deleteThread: async () => { throw new Error("should not delete"); },
  });

  const response = await handler({
    httpMethod: "POST",
    headers: { cookie: "textboss_session=signed" },
    queryStringParameters: {},
    body: JSON.stringify({}),
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.thread.id, "t-new");
}

async function testGetThreadWithMessagesReturnsFullThread() {
  const { createHandler } = require("../netlify/functions/threads");

  const handler = createHandler({
    ...makeAuth("Black"),
    listThreads: async () => { throw new Error("should not list"); },
    createThread: async () => { throw new Error("should not create"); },
    getThreadWithMessages: async (threadId, email) => {
      assert.equal(threadId, "t-abc");
      assert.equal(email, "user@example.com");
      return {
        id: "t-abc",
        title: "Test thread",
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        messages: [
          { id: "m1", role: "user", content: "Hello", created_at: "2026-01-01" },
          { id: "m2", role: "assistant", content: "Hi there", created_at: "2026-01-01" },
        ],
      };
    },
    deleteThread: async () => { throw new Error("should not delete"); },
  });

  const response = await handler({
    httpMethod: "GET",
    headers: { cookie: "textboss_session=signed" },
    queryStringParameters: { id: "t-abc" },
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.thread.messages.length, 2);
}

async function testGetThreadNotFoundReturns404() {
  const { createHandler } = require("../netlify/functions/threads");

  const handler = createHandler({
    ...makeAuth("Core"),
    listThreads: async () => { throw new Error("should not list"); },
    createThread: async () => { throw new Error("should not create"); },
    getThreadWithMessages: async () => null,
    deleteThread: async () => { throw new Error("should not delete"); },
  });

  const response = await handler({
    httpMethod: "GET",
    headers: { cookie: "textboss_session=signed" },
    queryStringParameters: { id: "nonexistent" },
  });

  assert.equal(response.statusCode, 404);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "thread_not_found");
}

async function testDeleteThreadSucceeds() {
  const { createHandler } = require("../netlify/functions/threads");

  let deletedId = null;
  const handler = createHandler({
    ...makeAuth("Pro"),
    listThreads: async () => { throw new Error("should not list"); },
    createThread: async () => { throw new Error("should not create"); },
    getThreadWithMessages: async () => { throw new Error("should not get"); },
    deleteThread: async (threadId, email) => {
      deletedId = threadId;
      assert.equal(email, "user@example.com");
    },
  });

  const response = await handler({
    httpMethod: "DELETE",
    headers: { cookie: "textboss_session=signed" },
    queryStringParameters: { id: "t-del" },
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.deleted, true);
  assert.equal(deletedId, "t-del");
}

async function testDeleteWithoutIdReturns400() {
  const { createHandler } = require("../netlify/functions/threads");

  const handler = createHandler({
    ...makeAuth("Core"),
    listThreads: async () => { throw new Error("should not list"); },
    createThread: async () => { throw new Error("should not create"); },
    getThreadWithMessages: async () => { throw new Error("should not get"); },
    deleteThread: async () => { throw new Error("should not delete"); },
  });

  const response = await handler({
    httpMethod: "DELETE",
    headers: { cookie: "textboss_session=signed" },
    queryStringParameters: {},
  });

  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.reason, "missing_thread_id");
}

async function testMissingSessionDenied() {
  const { createHandler } = require("../netlify/functions/threads");

  const handler = createHandler({
    verifySessionCookie: () => ({ ok: false, reason: "missing_session" }),
    findEntitlementByEmail: async () => { throw new Error("should not query"); },
    listThreads: async () => { throw new Error("should not list"); },
    createThread: async () => { throw new Error("should not create"); },
    getThreadWithMessages: async () => { throw new Error("should not get"); },
    deleteThread: async () => { throw new Error("should not delete"); },
  });

  const response = await handler({
    httpMethod: "GET",
    headers: {},
    queryStringParameters: {},
  });

  assert.equal(response.statusCode, 401);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.reason, "missing_session");
}

async function testInactiveTierDenied() {
  const { createHandler } = require("../netlify/functions/threads");

  const handler = createHandler({
    verifySessionCookie: () => ({
      ok: true,
      session: { email: "user@example.com", tier: "Core" },
    }),
    findEntitlementByEmail: async () => ({
      email: "user@example.com",
      entitled_tier: "Core",
      subscription_status: "cancelled",
    }),
    listThreads: async () => { throw new Error("should not list"); },
    createThread: async () => { throw new Error("should not create"); },
    getThreadWithMessages: async () => { throw new Error("should not get"); },
    deleteThread: async () => { throw new Error("should not delete"); },
  });

  const response = await handler({
    httpMethod: "GET",
    headers: { cookie: "textboss_session=signed" },
    queryStringParameters: {},
  });

  assert.equal(response.statusCode, 403);
  const body = JSON.parse(response.body);
  assert.equal(body.reason, "not_active");
}

async function testBlackTierGetsUnlimitedThreads() {
  const { createHandler } = require("../netlify/functions/threads");

  let receivedLimit = null;
  const handler = createHandler({
    ...makeAuth("Black"),
    listThreads: async (email, limit) => {
      receivedLimit = limit;
      return [];
    },
    createThread: async () => { throw new Error("should not create"); },
    getThreadWithMessages: async () => { throw new Error("should not get"); },
    deleteThread: async () => { throw new Error("should not delete"); },
  });

  await handler({
    httpMethod: "GET",
    headers: { cookie: "textboss_session=signed" },
    queryStringParameters: {},
  });

  assert.equal(receivedLimit, Infinity);
}

async function testUnsupportedMethodDenied() {
  const { createHandler } = require("../netlify/functions/threads");

  const handler = createHandler({
    ...makeAuth("Core"),
    listThreads: async () => { throw new Error("should not list"); },
    createThread: async () => { throw new Error("should not create"); },
    getThreadWithMessages: async () => { throw new Error("should not get"); },
    deleteThread: async () => { throw new Error("should not delete"); },
  });

  const response = await handler({
    httpMethod: "PUT",
    headers: { cookie: "textboss_session=signed" },
    queryStringParameters: {},
  });

  assert.equal(response.statusCode, 405);
  const body = JSON.parse(response.body);
  assert.equal(body.reason, "method_not_allowed");
}

async function run() {
  await testListThreadsReturnsUserThreads();
  await testCreateThreadReturnsNewThread();
  await testGetThreadWithMessagesReturnsFullThread();
  await testGetThreadNotFoundReturns404();
  await testDeleteThreadSucceeds();
  await testDeleteWithoutIdReturns400();
  await testMissingSessionDenied();
  await testInactiveTierDenied();
  await testBlackTierGetsUnlimitedThreads();
  await testUnsupportedMethodDenied();
  console.log("threads tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
