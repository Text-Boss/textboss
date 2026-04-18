const assert = require("node:assert/strict");

async function testHashIsDifferentEachTime() {
  const { hashPassword } = require("../netlify/functions/_lib/password");
  const h1 = hashPassword("same-password");
  const h2 = hashPassword("same-password");
  assert.notEqual(h1, h2, "Each hash should use a unique salt");
}

async function testHashHasSaltColonHashFormat() {
  const { hashPassword } = require("../netlify/functions/_lib/password");
  const stored = hashPassword("test");
  const parts = stored.split(":");
  assert.equal(parts.length, 2);
  assert.ok(parts[0].length === 32, "Salt should be 16 bytes = 32 hex chars");
  assert.ok(parts[1].length === 64, "Hash should be 32 bytes = 64 hex chars");
}

async function testCorrectPasswordVerifies() {
  const { hashPassword, verifyPassword } = require("../netlify/functions/_lib/password");
  const stored = hashPassword("correct-horse-battery");
  assert.equal(verifyPassword("correct-horse-battery", stored), true);
}

async function testWrongPasswordFails() {
  const { hashPassword, verifyPassword } = require("../netlify/functions/_lib/password");
  const stored = hashPassword("correct-horse-battery");
  assert.equal(verifyPassword("wrong-password", stored), false);
}

async function testMalformedStoredReturnsFalse() {
  const { verifyPassword } = require("../netlify/functions/_lib/password");
  assert.equal(verifyPassword("anything", "not-a-valid-hash"), false);
  assert.equal(verifyPassword("anything", ""), false);
  assert.equal(verifyPassword("anything", ":"), false);
}

async function run() {
  await testHashIsDifferentEachTime();
  await testHashHasSaltColonHashFormat();
  await testCorrectPasswordVerifies();
  await testWrongPasswordFails();
  await testMalformedStoredReturnsFalse();
  console.log("password tests passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
