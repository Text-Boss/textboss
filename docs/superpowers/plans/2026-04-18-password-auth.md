# Password Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password-based auth to Text Boss — email + password login, first-time setup prompt, and self-service forgot-password via Resend email.

**Architecture:** `password_hash` stored in the existing `entitlements` table. One-time reset tokens in a new `password_reset_tokens` table. Pure PBKDF2 hashing in `_lib/password.js` (no new dep). Three new Netlify Functions (`set-password`, `forgot-password`, `reset-password`). `verify-email` extended to check the hash. `access.html` gains a JavaScript state machine for three UI states. New `reset-password.html` page for the reset link landing.

**Tech Stack:** Node.js built-in `crypto` (PBKDF2-SHA256), Supabase (existing), `resend` npm package, Netlify Functions, vanilla JS frontend.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `netlify/functions/_lib/password.js` | Create | `hashPassword` / `verifyPassword` using PBKDF2 |
| `netlify/functions/_lib/supabase.js` | Modify | Add `password_hash` to entitlement select; add `updatePasswordHash`; add `createPasswordResetTokenStore` |
| `migrations/008_password_auth.sql` | Create | Add `password_hash` column; create `password_reset_tokens` table |
| `netlify/functions/verify-email.js` | Modify | Accept `password` field; check hash; return `needs_setup` when null |
| `netlify/functions/set-password.js` | Create | First-time password setup; issues session cookie |
| `netlify/functions/forgot-password.js` | Create | Generate reset token; send email via Resend |
| `netlify/functions/reset-password.js` | Create | Validate token; update hash; issue session cookie |
| `access.html` | Modify | Three-state JS form (signin / setup / forgot) |
| `reset-password.html` | Create | Reset link landing page |
| `tests/password.test.js` | Create | Unit tests for hash/verify helpers |
| `tests/verify-email.test.js` | Modify | Extend with password cases |
| `tests/set-password.test.js` | Create | Unit tests for set-password handler |
| `tests/forgot-password.test.js` | Create | Unit tests for forgot-password handler |
| `tests/reset-password.test.js` | Create | Unit tests for reset-password handler |

---

## Task 1: Password hashing library

**Files:**
- Create: `netlify/functions/_lib/password.js`
- Create: `tests/password.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/password.test.js`:

```js
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node tests/password.test.js
```

Expected: `Error: Cannot find module '../netlify/functions/_lib/password'`

- [ ] **Step 3: Implement `_lib/password.js`**

Create `netlify/functions/_lib/password.js`:

```js
const crypto = require("node:crypto");

const ITERATIONS = 100_000;
const KEY_LENGTH  = 32; // bytes → 64 hex chars
const SALT_LENGTH = 16; // bytes → 32 hex chars
const DIGEST      = "sha256";

function hashPassword(plaintext) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  const hash = crypto.pbkdf2Sync(plaintext, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(plaintext, stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [salt, expectedHash] = parts;
  const actualHash = crypto.pbkdf2Sync(plaintext, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  const expected = Buffer.from(expectedHash, "hex");
  const actual   = Buffer.from(actualHash, "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node tests/password.test.js
```

Expected: `password tests passed`

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_lib/password.js tests/password.test.js
git commit -m "feat: add PBKDF2 password hashing library"
```

---

## Task 2: Database migration

**Files:**
- Create: `migrations/008_password_auth.sql`

- [ ] **Step 1: Write the migration file**

Create `migrations/008_password_auth.sql`:

```sql
-- 008: Password authentication
-- Adds password_hash to entitlements and creates reset token table.

ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token       TEXT        PRIMARY KEY,
  email       TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prt_email
  ON password_reset_tokens (email);
```

- [ ] **Step 2: Apply migration to Supabase**

Run this in the Supabase SQL editor (dashboard → SQL Editor):

```sql
ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token       TEXT        PRIMARY KEY,
  email       TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prt_email
  ON password_reset_tokens (email);
```

Expected: both statements complete with no error.

- [ ] **Step 3: Commit**

```bash
git add migrations/008_password_auth.sql
git commit -m "feat: migration 008 — password_hash column and reset tokens table"
```

---

## Task 3: Supabase store additions

**Files:**
- Modify: `netlify/functions/_lib/supabase.js`

- [ ] **Step 1: Add `password_hash` to the entitlement select query**

In `createEntitlementStore`, find the `.select(...)` call inside `findEntitlementByEmail` and update it:

```js
// Before:
.select("email, entitled_tier, subscription_status, current_period_end, updated_at")

// After:
.select("email, entitled_tier, subscription_status, current_period_end, updated_at, password_hash")
```

- [ ] **Step 2: Add `updatePasswordHash` to `createEntitlementStore`**

Inside the object returned by `createEntitlementStore`, after `findEntitlementByEmail`, add:

```js
async updatePasswordHash(email, hash) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const { error } = await client
    .from("entitlements")
    .update({ password_hash: hash, updated_at: new Date().toISOString() })
    .ilike("email", normalizedEmail);
  if (error) throw error;
},
```

- [ ] **Step 3: Add `createPasswordResetTokenStore` factory**

At the bottom of `_lib/supabase.js`, before the `exports` block, add:

```js
function createPasswordResetTokenStore(options = {}) {
  const client = options.client || createServiceRoleClient();

  return {
    async createToken(email, token, expiresAt) {
      const normalized = String(email || "").trim().toLowerCase();
      const { error } = await client
        .from("password_reset_tokens")
        .insert({ token, email: normalized, expires_at: expiresAt.toISOString() });
      if (error) throw error;
    },

    async findToken(token) {
      const { data, error } = await client
        .from("password_reset_tokens")
        .select("token, email, expires_at, used_at")
        .eq("token", token)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async markTokenUsed(token) {
      const { error } = await client
        .from("password_reset_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("token", token);
      if (error) throw error;
    },

    async deleteTokensByEmail(email) {
      const normalized = String(email || "").trim().toLowerCase();
      const { error } = await client
        .from("password_reset_tokens")
        .delete()
        .ilike("email", normalized);
      if (error) throw error;
    },
  };
}
```

- [ ] **Step 4: Export the new store**

Find the `exports` block at the bottom of `supabase.js` and add `createPasswordResetTokenStore`:

```js
exports.createPasswordResetTokenStore = createPasswordResetTokenStore;
```

- [ ] **Step 5: Run existing tests — verify nothing broke**

```bash
npm test
```

Expected: all test suites pass.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_lib/supabase.js
git commit -m "feat: add password_hash to entitlement store and createPasswordResetTokenStore"
```

---

## Task 4: Extend `verify-email` with password checking

**Files:**
- Modify: `netlify/functions/verify-email.js`
- Modify: `tests/verify-email.test.js`

- [ ] **Step 1: Add new test cases and update existing ones**

Replace the full contents of `tests/verify-email.test.js` with:

```js
const assert = require("node:assert/strict");

// ── Helper ────────────────────────────────────────────────────────────────────
function makeHandler(entitlement, overrides = {}) {
  const { createHandler } = require("../netlify/functions/verify-email");
  return createHandler({
    findEntitlementByEmail: async () => entitlement,
    verifyPassword: overrides.verifyPassword ?? (() => true),
    createSessionCookie: overrides.createSessionCookie ?? (() => "textboss_session=cookie"),
  });
}

// ── Existing behaviour ────────────────────────────────────────────────────────

async function testActiveCoreEntitlement() {
  const handler = makeHandler(
    { email: "core@example.com", entitled_tier: "Core", subscription_status: "active", password_hash: "salt:hash" },
    {
      verifyPassword: (plain, stored) => {
        assert.equal(plain, "my-pass");
        assert.equal(stored, "salt:hash");
        return true;
      },
      createSessionCookie: (session) => {
        assert.equal(session.email, "core@example.com");
        assert.equal(session.tier, "Core");
        return "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax";
      },
    }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "Core@Example.com", password: "my-pass" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, tier: "Core", redirectTo: "/app-core.html" });
  assert.equal(response.headers["set-cookie"], "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax");
}

async function testInactiveEntitlementDenied() {
  const handler = makeHandler({
    email: "inactive@example.com",
    entitled_tier: "Pro",
    subscription_status: "canceled",
    password_hash: "salt:hash",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "inactive@example.com", password: "any" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_active" });
}

async function testActiveEntitlementNormalizesTierAndStatus() {
  const handler = makeHandler(
    { email: "breach@cyberservices.com", entitled_tier: " pro ", subscription_status: " ACTIVE ", password_hash: "s:h" },
    {
      createSessionCookie: (session) => {
        assert.equal(session.tier, "Pro");
        return "textboss_session=signed-cookie; Path=/; HttpOnly; SameSite=Lax";
      },
    }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "  Breach@CyberServices.com  ", password: "any" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, tier: "Pro", redirectTo: "/app-pro.html" });
}

async function testDependencyFailureReturnsJsonError() {
  const { createHandler } = require("../netlify/functions/verify-email");
  const handler = createHandler({
    findEntitlementByEmail: async () => { throw new Error("DB error"); },
    verifyPassword: () => true,
    createSessionCookie: () => "cookie",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "breach@cyberservices.com", password: "any" }),
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "server_error" });
}

// ── New password-specific behaviour ───────────────────────────────────────────

async function testNullPasswordHashReturnsNeedsSetup() {
  const handler = makeHandler({
    email: "new@example.com",
    entitled_tier: "Black",
    subscription_status: "active",
    password_hash: null,
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "new@example.com", password: "anything" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, needs_setup: true });
  assert.equal(response.headers["set-cookie"], undefined);
}

async function testWrongPasswordReturnsWrongPassword() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Pro", subscription_status: "active", password_hash: "s:h" },
    { verifyPassword: () => false }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "wrong" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "wrong_password" });
  assert.equal(response.headers["set-cookie"], undefined);
}

async function testMissingPasswordWithHashSetReturnsMissingPassword() {
  const handler = makeHandler({
    email: "u@example.com", entitled_tier: "Pro", subscription_status: "active", password_hash: "s:h",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com" }), // no password field
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "missing_password" });
}

async function testNotFoundReturnsDenied() {
  const { createHandler } = require("../netlify/functions/verify-email");
  const handler = createHandler({
    findEntitlementByEmail: async () => null,
    verifyPassword: () => true,
    createSessionCookie: () => "cookie",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "nobody@example.com", password: "any" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_found" });
}

async function run() {
  await testActiveCoreEntitlement();
  await testInactiveEntitlementDenied();
  await testActiveEntitlementNormalizesTierAndStatus();
  await testDependencyFailureReturnsJsonError();
  await testNullPasswordHashReturnsNeedsSetup();
  await testWrongPasswordReturnsWrongPassword();
  await testMissingPasswordWithHashSetReturnsMissingPassword();
  await testNotFoundReturnsDenied();
  console.log("verify-email tests passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
```

- [ ] **Step 2: Run updated tests — verify they fail on the new cases**

```bash
node tests/verify-email.test.js
```

Expected: existing tests pass, new password tests fail (verify-email doesn't check passwords yet).

- [ ] **Step 3: Update `verify-email.js`**

Replace the full contents of `netlify/functions/verify-email.js` with:

```js
const { createEntitlementStore } = require("./_lib/supabase");
const sessionLib = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");
const { verifyPassword: defaultVerifyPassword } = require("./_lib/password");

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function normalizeStatus(value) { return String(value || "").trim().toLowerCase(); }
function getRedirectForTier(tier) { return `/app-${tier.toLowerCase()}.html`; }

function createHandler(deps) {
  const { findEntitlementByEmail, createSessionCookie, verifyPassword = defaultVerifyPassword } = deps;

  return async function handler(event) {
    try {
      if (event.httpMethod !== "POST") {
        return json(405, { ok: false, denied: true, reason: "method_not_allowed" });
      }

      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; } catch {
        return json(400, { ok: false, denied: true, reason: "invalid_json" });
      }

      const email    = normalizeEmail(body.email);
      const password = body.password || null;

      if (!email) return json(400, { ok: false, denied: true, reason: "missing_email" });

      const entitlement = await findEntitlementByEmail(email);
      if (!entitlement) return json(403, { ok: false, denied: true, reason: "not_found" });

      const tier = normalizeTier(entitlement.entitled_tier);
      if (!tier) return json(403, { ok: false, denied: true, reason: "invalid_tier" });

      const status = normalizeStatus(entitlement.subscription_status);
      if (status !== "active" && status !== "trialing") {
        return json(403, { ok: false, denied: true, reason: "not_active" });
      }

      // Password gate
      if (!entitlement.password_hash) {
        return json(200, { ok: true, needs_setup: true });
      }

      if (!password) {
        return json(400, { ok: false, denied: true, reason: "missing_password" });
      }

      if (!verifyPassword(password, entitlement.password_hash)) {
        return json(403, { ok: false, denied: true, reason: "wrong_password" });
      }

      const setCookie = createSessionCookie({ email, tier });
      return json(200, { ok: true, tier, redirectTo: getRedirectForTier(tier) }, { "set-cookie": setCookie });

    } catch {
      return json(500, { ok: false, denied: true, reason: "server_error" });
    }
  };
}

function createRuntimeHandler(overrides = {}) {
  const store           = overrides.store           || createEntitlementStore();
  const runtimeSessionLib = overrides.sessionLib    || sessionLib;

  return createHandler({
    findEntitlementByEmail: (email) => store.findEntitlementByEmail(email),
    createSessionCookie:    (session) => runtimeSessionLib.createSessionCookie(session),
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch {
    return json(500, { ok: false, denied: true, reason: "server_error" });
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
```

- [ ] **Step 4: Run all tests — verify everything passes**

```bash
npm test
```

Expected: all suites pass including the new verify-email cases.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/verify-email.js tests/verify-email.test.js
git commit -m "feat: verify-email checks password hash, returns needs_setup for new accounts"
```

---

## Task 5: `set-password` function

**Files:**
- Create: `netlify/functions/set-password.js`
- Create: `tests/set-password.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/set-password.test.js`:

```js
const assert = require("node:assert/strict");

function makeHandler(entitlement, overrides = {}) {
  const { createHandler } = require("../netlify/functions/set-password");
  return createHandler({
    findEntitlementByEmail: async () => entitlement,
    updatePasswordHash:     overrides.updatePasswordHash ?? (async () => {}),
    createSessionCookie:    overrides.createSessionCookie ?? (() => "textboss_session=cookie"),
  });
}

async function testSetsPasswordAndIssuesCookieOnFirstVisit() {
  let savedHash = null;
  let savedEmail = null;

  const handler = makeHandler(
    { email: "new@example.com", entitled_tier: "Pro", subscription_status: "active", password_hash: null },
    {
      updatePasswordHash: async (email, hash) => { savedEmail = email; savedHash = hash; },
      createSessionCookie: (session) => {
        assert.equal(session.email, "new@example.com");
        assert.equal(session.tier, "Pro");
        return "textboss_session=new-cookie";
      },
    }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "new@example.com", password: "secure-pass-1", confirmPassword: "secure-pass-1" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, tier: "Pro", redirectTo: "/app-pro.html" });
  assert.equal(response.headers["set-cookie"], "textboss_session=new-cookie");
  assert.equal(savedEmail, "new@example.com");
  assert.ok(typeof savedHash === "string" && savedHash.includes(":"), "hash should be salt:hash format");
}

async function testRejectsPasswordMismatch() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active", password_hash: null }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "password1", confirmPassword: "password2" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_mismatch" });
}

async function testRejectsShortPassword() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active", password_hash: null }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "short", confirmPassword: "short" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_too_short" });
}

async function testRejectsIfPasswordAlreadySet() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active", password_hash: "existing:hash" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "new-password", confirmPassword: "new-password" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_already_set" });
}

async function testRejectsInactiveSubscription() {
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "canceled", password_hash: null }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "u@example.com", password: "validpass", confirmPassword: "validpass" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_active" });
}

async function testRejectsUnknownEmail() {
  const { createHandler } = require("../netlify/functions/set-password");
  const handler = createHandler({
    findEntitlementByEmail: async () => null,
    updatePasswordHash:     async () => {},
    createSessionCookie:    () => "cookie",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ email: "nobody@example.com", password: "validpass", confirmPassword: "validpass" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "not_found" });
}

async function run() {
  await testSetsPasswordAndIssuesCookieOnFirstVisit();
  await testRejectsPasswordMismatch();
  await testRejectsShortPassword();
  await testRejectsIfPasswordAlreadySet();
  await testRejectsInactiveSubscription();
  await testRejectsUnknownEmail();
  console.log("set-password tests passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
```

- [ ] **Step 2: Run test — verify it fails**

```bash
node tests/set-password.test.js
```

Expected: `Error: Cannot find module '../netlify/functions/set-password'`

- [ ] **Step 3: Implement `set-password.js`**

Create `netlify/functions/set-password.js`:

```js
const { createEntitlementStore } = require("./_lib/supabase");
const sessionLib = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");
const { hashPassword } = require("./_lib/password");

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

function createHandler(deps) {
  const { findEntitlementByEmail, updatePasswordHash, createSessionCookie } = deps;

  return async function handler(event) {
    try {
      if (event.httpMethod !== "POST") {
        return json(405, { ok: false, denied: true, reason: "method_not_allowed" });
      }

      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; } catch {
        return json(400, { ok: false, denied: true, reason: "invalid_json" });
      }

      const email           = String(body.email           || "").trim().toLowerCase();
      const password        = String(body.password        || "");
      const confirmPassword = String(body.confirmPassword || "");

      if (!email)    return json(400, { ok: false, denied: true, reason: "missing_email" });
      if (!password) return json(400, { ok: false, denied: true, reason: "missing_password" });
      if (password !== confirmPassword) return json(400, { ok: false, denied: true, reason: "password_mismatch" });
      if (password.length < 8) return json(400, { ok: false, denied: true, reason: "password_too_short" });

      const entitlement = await findEntitlementByEmail(email);
      if (!entitlement) return json(403, { ok: false, denied: true, reason: "not_found" });

      const tier = normalizeTier(entitlement.entitled_tier);
      if (!tier) return json(403, { ok: false, denied: true, reason: "invalid_tier" });

      const status = String(entitlement.subscription_status || "").trim().toLowerCase();
      if (status !== "active" && status !== "trialing") {
        return json(403, { ok: false, denied: true, reason: "not_active" });
      }

      if (entitlement.password_hash) {
        return json(403, { ok: false, denied: true, reason: "password_already_set" });
      }

      await updatePasswordHash(email, hashPassword(password));

      const setCookie = createSessionCookie({ email, tier });
      return json(200, { ok: true, tier, redirectTo: `/app-${tier.toLowerCase()}.html` }, { "set-cookie": setCookie });

    } catch {
      return json(500, { ok: false, denied: true, reason: "server_error" });
    }
  };
}

function createRuntimeHandler(overrides = {}) {
  const store             = overrides.store      || createEntitlementStore();
  const runtimeSessionLib = overrides.sessionLib || sessionLib;

  return createHandler({
    findEntitlementByEmail: (email) => store.findEntitlementByEmail(email),
    updatePasswordHash:     (email, hash) => store.updatePasswordHash(email, hash),
    createSessionCookie:    (session) => runtimeSessionLib.createSessionCookie(session),
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch {
    return json(500, { ok: false, denied: true, reason: "server_error" });
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/set-password.js tests/set-password.test.js
git commit -m "feat: set-password function for first-time account password setup"
```

---

## Task 6: `forgot-password` function + Resend

**Files:**
- Create: `netlify/functions/forgot-password.js`
- Create: `tests/forgot-password.test.js`
- Modify: `package.json` (via `npm install resend`)

- [ ] **Step 1: Install Resend**

```bash
npm install resend
```

Expected: `resend` added to `dependencies` in `package.json`.

- [ ] **Step 2: Write failing tests**

Create `tests/forgot-password.test.js`:

```js
const assert = require("node:assert/strict");

function makeHandler(entitlement, overrides = {}) {
  const { createHandler } = require("../netlify/functions/forgot-password");
  return createHandler({
    findEntitlementByEmail: async () => entitlement,
    deleteTokensByEmail:    overrides.deleteTokensByEmail ?? (async () => {}),
    createToken:            overrides.createToken         ?? (async () => {}),
    sendEmail:              overrides.sendEmail           ?? (async () => {}),
  });
}

async function testAlwaysReturnsSuccessForKnownEmail() {
  let tokenSaved = null;
  let emailSentTo = null;

  const handler = makeHandler(
    { email: "sub@example.com", entitled_tier: "Pro", subscription_status: "active" },
    {
      createToken: async (email, token, expiresAt) => {
        assert.equal(email, "sub@example.com");
        assert.ok(typeof token === "string" && token.length === 64, "token should be 32 bytes hex");
        assert.ok(expiresAt instanceof Date && expiresAt > new Date(), "expiresAt should be in the future");
        tokenSaved = token;
      },
      sendEmail: async (email, token) => {
        emailSentTo = email;
        assert.equal(token, tokenSaved);
      },
    }
  );

  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ email: "sub@example.com" }) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.ok(tokenSaved !== null, "token should have been created");
  assert.equal(emailSentTo, "sub@example.com");
}

async function testAlwaysReturnsSuccessForUnknownEmail() {
  let createTokenCalled = false;
  const handler = makeHandler(null, {
    createToken: async () => { createTokenCalled = true; },
    sendEmail:   async () => {},
  });

  const response = await handler({ httpMethod: "POST", body: JSON.stringify({ email: "nobody@example.com" }) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal(createTokenCalled, false, "should not create token for unknown email");
}

async function testDeletesExistingTokensBeforeCreating() {
  const deletedEmails = [];
  const handler = makeHandler(
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" },
    { deleteTokensByEmail: async (email) => deletedEmails.push(email) }
  );

  await handler({ httpMethod: "POST", body: JSON.stringify({ email: "u@example.com" }) });

  assert.ok(deletedEmails.includes("u@example.com"), "should delete existing tokens first");
}

async function testRejectsNonPost() {
  const handler = makeHandler(null);
  const response = await handler({ httpMethod: "GET", body: null });
  assert.equal(response.statusCode, 405);
}

async function testMissingEmailReturns400() {
  const handler = makeHandler(null);
  const response = await handler({ httpMethod: "POST", body: JSON.stringify({}) });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "missing_email" });
}

async function run() {
  await testAlwaysReturnsSuccessForKnownEmail();
  await testAlwaysReturnsSuccessForUnknownEmail();
  await testDeletesExistingTokensBeforeCreating();
  await testRejectsNonPost();
  await testMissingEmailReturns400();
  console.log("forgot-password tests passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
```

- [ ] **Step 3: Run test — verify it fails**

```bash
node tests/forgot-password.test.js
```

Expected: `Error: Cannot find module '../netlify/functions/forgot-password'`

- [ ] **Step 4: Implement `forgot-password.js`**

Create `netlify/functions/forgot-password.js`:

```js
const crypto = require("node:crypto");
const { createEntitlementStore, createPasswordResetTokenStore } = require("./_lib/supabase");

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

function createHandler(deps) {
  const { findEntitlementByEmail, deleteTokensByEmail, createToken, sendEmail } = deps;

  return async function handler(event) {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, denied: true, reason: "method_not_allowed" });
    }

    let body;
    try { body = event.body ? JSON.parse(event.body) : {}; } catch {
      return json(400, { ok: false, denied: true, reason: "invalid_json" });
    }

    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return json(400, { ok: false, denied: true, reason: "missing_email" });

    // Always return success — never reveal whether email is on file
    try {
      const entitlement = await findEntitlementByEmail(email);
      if (entitlement) {
        const status = String(entitlement.subscription_status || "").trim().toLowerCase();
        if (status === "active" || status === "trialing") {
          const token     = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
          await deleteTokensByEmail(email);
          await createToken(email, token, expiresAt);
          await sendEmail(email, token);
        }
      }
    } catch (err) {
      console.error("[forgot-password] error:", err?.message || err);
      // Still return success
    }

    return json(200, { ok: true });
  };
}

function createRuntimeHandler(overrides = {}) {
  let entitlementStore, tokenStore;
  try {
    entitlementStore = overrides.entitlementStore || createEntitlementStore();
    tokenStore       = overrides.tokenStore       || createPasswordResetTokenStore();
  } catch (err) {
    console.error("[forgot-password] store init failed:", err);
    return async () => json(500, { ok: false, denied: true, reason: "store_init_failed" });
  }

  const { Resend } = require("resend");

  return createHandler({
    findEntitlementByEmail: (email) => entitlementStore.findEntitlementByEmail(email),
    deleteTokensByEmail:    (email) => tokenStore.deleteTokensByEmail(email),
    createToken:            (email, token, expiresAt) => tokenStore.createToken(email, token, expiresAt),
    sendEmail: async (email, token) => {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const resetUrl = `https://textboss.com.au/reset-password.html?token=${token}`;
      await resend.emails.send({
        from:    "Text Boss <noreply@textboss.com.au>",
        to:      email,
        subject: "Reset your Text Boss password",
        html: `
          <div style="font-family:monospace;background:#020203;color:#e4ecf2;padding:32px;max-width:480px;margin:0 auto;border-radius:12px">
            <p style="color:#22c55e;font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:12px;margin:0 0 16px">TEXT BOSS</p>
            <h2 style="margin:0 0 16px;font-size:20px">Reset your password</h2>
            <p style="color:#8896a4;line-height:1.6;margin:0 0 24px">Click the button below to set a new password. This link expires in 1 hour.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#22c55e;color:#040e07;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-family:monospace">Reset password</a>
            <p style="color:#52606d;font-size:12px;margin:24px 0 0">If you didn't request this, ignore this email — your password won't change.</p>
          </div>
        `,
      });
    },
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    console.error("[forgot-password] unhandled error:", err?.message || err);
    return json(500, { ok: false, denied: true, reason: "server_error" });
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/forgot-password.js tests/forgot-password.test.js package.json package-lock.json
git commit -m "feat: forgot-password function sends reset link via Resend"
```

---

## Task 7: `reset-password` function

**Files:**
- Create: `netlify/functions/reset-password.js`
- Create: `tests/reset-password.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/reset-password.test.js`:

```js
const assert = require("node:assert/strict");

const FUTURE = new Date(Date.now() + 3600 * 1000).toISOString();
const PAST   = new Date(Date.now() - 3600 * 1000).toISOString();

function makeHandler(tokenRecord, entitlement, overrides = {}) {
  const { createHandler } = require("../netlify/functions/reset-password");
  return createHandler({
    findToken:              async () => tokenRecord,
    markTokenUsed:          overrides.markTokenUsed       ?? (async () => {}),
    findEntitlementByEmail: async () => entitlement,
    updatePasswordHash:     overrides.updatePasswordHash  ?? (async () => {}),
    createSessionCookie:    overrides.createSessionCookie ?? (() => "textboss_session=cookie"),
  });
}

async function testValidTokenResetsPasswordAndSignsIn() {
  let savedHash = null;
  let markedUsed = false;

  const handler = makeHandler(
    { token: "abc123", email: "u@example.com", expires_at: FUTURE, used_at: null },
    { email: "u@example.com", entitled_tier: "Black", subscription_status: "active" },
    {
      updatePasswordHash: async (email, hash) => { savedHash = hash; },
      markTokenUsed:      async () => { markedUsed = true; },
      createSessionCookie: (session) => {
        assert.equal(session.email, "u@example.com");
        assert.equal(session.tier, "Black");
        return "textboss_session=new-cookie";
      },
    }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "abc123", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, tier: "Black", redirectTo: "/app-black.html" });
  assert.equal(response.headers["set-cookie"], "textboss_session=new-cookie");
  assert.ok(typeof savedHash === "string" && savedHash.includes(":"), "should save hashed password");
  assert.equal(markedUsed, true, "should mark token used");
}

async function testRejectsExpiredToken() {
  const handler = makeHandler(
    { token: "expired", email: "u@example.com", expires_at: PAST, used_at: null },
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "expired", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "token_expired" });
}

async function testRejectsAlreadyUsedToken() {
  const handler = makeHandler(
    { token: "used", email: "u@example.com", expires_at: FUTURE, used_at: new Date().toISOString() },
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "used", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "token_used" });
}

async function testRejectsUnknownToken() {
  const { createHandler } = require("../netlify/functions/reset-password");
  const handler = createHandler({
    findToken:              async () => null,
    markTokenUsed:          async () => {},
    findEntitlementByEmail: async () => null,
    updatePasswordHash:     async () => {},
    createSessionCookie:    () => "cookie",
  });

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "bad", password: "new-pass-ok", confirmPassword: "new-pass-ok" }),
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "invalid_token" });
}

async function testRejectsPasswordMismatch() {
  const handler = makeHandler(
    { token: "t", email: "u@example.com", expires_at: FUTURE, used_at: null },
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "t", password: "password1", confirmPassword: "password2" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_mismatch" });
}

async function testRejectsShortPassword() {
  const handler = makeHandler(
    { token: "t", email: "u@example.com", expires_at: FUTURE, used_at: null },
    { email: "u@example.com", entitled_tier: "Core", subscription_status: "active" }
  );

  const response = await handler({
    httpMethod: "POST",
    body: JSON.stringify({ token: "t", password: "short", confirmPassword: "short" }),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { ok: false, denied: true, reason: "password_too_short" });
}

async function run() {
  await testValidTokenResetsPasswordAndSignsIn();
  await testRejectsExpiredToken();
  await testRejectsAlreadyUsedToken();
  await testRejectsUnknownToken();
  await testRejectsPasswordMismatch();
  await testRejectsShortPassword();
  console.log("reset-password tests passed");
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
```

- [ ] **Step 2: Run test — verify it fails**

```bash
node tests/reset-password.test.js
```

Expected: `Error: Cannot find module '../netlify/functions/reset-password'`

- [ ] **Step 3: Implement `reset-password.js`**

Create `netlify/functions/reset-password.js`:

```js
const { createEntitlementStore, createPasswordResetTokenStore } = require("./_lib/supabase");
const sessionLib = require("./_lib/session");
const { normalizeTier } = require("./_lib/tier-policy");
const { hashPassword } = require("./_lib/password");

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

function createHandler(deps) {
  const { findToken, markTokenUsed, findEntitlementByEmail, updatePasswordHash, createSessionCookie } = deps;

  return async function handler(event) {
    try {
      if (event.httpMethod !== "POST") {
        return json(405, { ok: false, denied: true, reason: "method_not_allowed" });
      }

      let body;
      try { body = event.body ? JSON.parse(event.body) : {}; } catch {
        return json(400, { ok: false, denied: true, reason: "invalid_json" });
      }

      const token           = String(body.token           || "").trim();
      const password        = String(body.password        || "");
      const confirmPassword = String(body.confirmPassword || "");

      if (!token)    return json(400, { ok: false, denied: true, reason: "missing_token" });
      if (!password) return json(400, { ok: false, denied: true, reason: "missing_password" });
      if (password !== confirmPassword) return json(400, { ok: false, denied: true, reason: "password_mismatch" });
      if (password.length < 8) return json(400, { ok: false, denied: true, reason: "password_too_short" });

      const tokenRecord = await findToken(token);
      if (!tokenRecord)         return json(403, { ok: false, denied: true, reason: "invalid_token" });
      if (tokenRecord.used_at)  return json(403, { ok: false, denied: true, reason: "token_used" });
      if (new Date(tokenRecord.expires_at) < new Date()) {
        return json(403, { ok: false, denied: true, reason: "token_expired" });
      }

      const entitlement = await findEntitlementByEmail(tokenRecord.email);
      if (!entitlement) return json(403, { ok: false, denied: true, reason: "not_found" });

      const tier = normalizeTier(entitlement.entitled_tier);
      if (!tier) return json(403, { ok: false, denied: true, reason: "invalid_tier" });

      const status = String(entitlement.subscription_status || "").trim().toLowerCase();
      if (status !== "active" && status !== "trialing") {
        return json(403, { ok: false, denied: true, reason: "not_active" });
      }

      await updatePasswordHash(tokenRecord.email, hashPassword(password));
      await markTokenUsed(token);

      const setCookie = createSessionCookie({ email: tokenRecord.email, tier });
      return json(200, { ok: true, tier, redirectTo: `/app-${tier.toLowerCase()}.html` }, { "set-cookie": setCookie });

    } catch {
      return json(500, { ok: false, denied: true, reason: "server_error" });
    }
  };
}

function createRuntimeHandler(overrides = {}) {
  let entitlementStore, tokenStore;
  try {
    entitlementStore = overrides.entitlementStore || createEntitlementStore();
    tokenStore       = overrides.tokenStore       || createPasswordResetTokenStore();
  } catch (err) {
    console.error("[reset-password] store init failed:", err);
    return async () => json(500, { ok: false, denied: true, reason: "store_init_failed" });
  }

  const runtimeSessionLib = overrides.sessionLib || sessionLib;

  return createHandler({
    findToken:              (token) => tokenStore.findToken(token),
    markTokenUsed:          (token) => tokenStore.markTokenUsed(token),
    findEntitlementByEmail: (email) => entitlementStore.findEntitlementByEmail(email),
    updatePasswordHash:     (email, hash) => entitlementStore.updatePasswordHash(email, hash),
    createSessionCookie:    (session) => runtimeSessionLib.createSessionCookie(session),
  });
}

async function handler(event, context) {
  try {
    return await createRuntimeHandler()(event, context);
  } catch (err) {
    console.error("[reset-password] unhandled error:", err?.message || err);
    return json(500, { ok: false, denied: true, reason: "server_error" });
  }
}

exports.createHandler        = createHandler;
exports.createRuntimeHandler = createRuntimeHandler;
exports.handler              = handler;
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/reset-password.js tests/reset-password.test.js
git commit -m "feat: reset-password validates token, updates password hash, issues session"
```

---

## Task 8: Update `access.html` — three-state form

**Files:**
- Modify: `access.html`

The form has three states managed purely in JS (no page navigations):

| State | Trigger | Fields shown | Button | Extra |
|---|---|---|---|---|
| `signin` | default | email + password | Sign in | "Forgot password?" link |
| `setup` | `needs_setup: true` response | email (locked) + create password + confirm | Set password & sign in | amber notice |
| `forgot` | click "Forgot password?" | email | Send reset link | "← Back" link |
| `forgot-sent` | success from `forgot-password` | — | — | confirmation message + "← Back" link |

- [ ] **Step 1: Replace `access.html`**

Replace the full contents of `access.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="icon" type="image/png" sizes="64x64" href="assets/favicon-64.png">
  <link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">
  <link rel="shortcut icon" href="assets/favicon-32.png">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Text Boss — Access</title>
  <style>
    :root {
      --bg:      #020203;
      --surface: #0c0e11;
      --line:    #191d22;
      --line-hi: #232830;
      --text:    #e4ecf2;
      --muted:   #52606d;
      --muted-hi:#8896a4;
      --green:   #22c55e;
      --amber:   #fbbf24;
      --danger:  #ef4444;
      --mono: Consolas, Monaco, 'Courier New', ui-monospace, monospace;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: var(--mono);
      font-size: 15px;
    }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background-image: radial-gradient(ellipse 60% 30% at 50% 0%, rgba(34,197,94,.07), transparent);
    }
    .wordmark { font-size: 11px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; color: var(--muted); margin-bottom: 28px; }
    .wordmark span { color: var(--green); }
    .card { width: min(100%, 480px); border: 1px solid var(--line-hi); border-radius: 20px; background: var(--surface); padding: 32px; box-shadow: 0 24px 80px rgba(0,0,0,.55); }
    .card-label { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px; }
    .card-label .sl { color: var(--green); font-weight: 700; }
    h1 { font-size: clamp(18px, 4vw, 22px); margin-bottom: 8px; }
    .subtitle { font-size: 13px; color: var(--muted-hi); line-height: 1.65; margin-bottom: 24px; }
    label { display: block; font-size: 12px; color: var(--muted-hi); margin-bottom: 8px; letter-spacing: .04em; }
    input {
      width: 100%; border: 1px solid var(--line-hi); border-radius: 12px;
      background: rgba(0,0,0,.25); color: var(--text); padding: 13px 16px;
      font: inherit; font-size: 14px; outline: none; caret-color: var(--green); transition: border-color .15s;
    }
    input:focus { border-color: rgba(34,197,94,.45); }
    input::placeholder { color: var(--muted); }
    input:read-only { opacity: .55; cursor: default; }
    .field { margin-bottom: 16px; }
    .field:last-of-type { margin-bottom: 0; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    button, .back-link {
      display: inline-flex; justify-content: center; align-items: center;
      min-height: 44px; border-radius: 10px; padding: 0 18px;
      border: 1px solid var(--line-hi); color: var(--text); background: var(--surface);
      font: inherit; font-size: 13px; cursor: pointer; text-decoration: none;
      transition: border-color .15s, filter .15s; white-space: nowrap;
    }
    button:hover, .back-link:hover { border-color: rgba(255,255,255,.2); }
    button.primary { background: var(--green); color: #040e07; border-color: transparent; font-weight: 700; }
    button.primary:hover { filter: brightness(1.08); }
    .notice { font-size: 12px; line-height: 1.5; padding: 10px 14px; border-radius: 10px; margin-bottom: 20px; }
    .notice.amber { color: var(--amber); background: rgba(251,191,36,.07); border: 1px solid rgba(251,191,36,.2); }
    .notice.green  { color: var(--green);  background: rgba(34,197,94,.07);  border: 1px solid rgba(34,197,94,.2);  }
    .status { margin-top: 16px; min-height: 20px; font-size: 12px; color: var(--muted-hi); line-height: 1.5; }
    .status.error { color: #fca5a5; }
    .forgot-link { display: inline-block; margin-top: 12px; font-size: 12px; color: var(--muted); background: none; border: none; cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }
    .forgot-link:hover { color: var(--text); }
    .back-link { margin-top: 24px; font-size: 12px; color: var(--muted); border: none; background: none; padding: 0; min-height: 0; }
    .back-link:hover { color: var(--text); border: none; }
    .hidden { display: none !important; }
    @media (max-width: 640px) { input { font-size: 16px; } }
    @media (max-width: 400px) {
      body { padding: 16px; }
      .card { padding: 24px 18px; }
      .actions { flex-direction: column; }
      .actions button { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="wordmark">Text <span>Boss</span></div>
  <div class="card">
    <div class="card-label"><span class="sl">//</span> subscriber access</div>

    <!-- SIGN IN STATE -->
    <div id="view-signin">
      <h1>Sign in.</h1>
      <p class="subtitle">Enter the email and password linked to your active Text Boss subscription.</p>
      <form id="signin-form" novalidate>
        <div class="field">
          <label for="signin-email">Subscription email</label>
          <input id="signin-email" type="email" autocomplete="email" placeholder="you@example.com" required>
        </div>
        <div class="field">
          <label for="signin-password">Password</label>
          <input id="signin-password" type="password" autocomplete="current-password" placeholder="••••••••" required>
        </div>
        <div class="actions">
          <button class="primary" type="submit">Sign in</button>
        </div>
      </form>
      <button class="forgot-link" id="forgot-link" type="button">Forgot password?</button>
      <div id="signin-status" class="status" aria-live="polite"></div>
    </div>

    <!-- SETUP STATE (first-time password creation) -->
    <div id="view-setup" class="hidden">
      <h1>Create your password.</h1>
      <div class="notice amber" id="setup-notice">No password set yet — secure your account to continue.</div>
      <form id="setup-form" novalidate>
        <div class="field">
          <label for="setup-email">Subscription email</label>
          <input id="setup-email" type="email" autocomplete="off" readonly>
        </div>
        <div class="field">
          <label for="setup-password">Create password <span style="color:var(--muted);font-size:11px">(min. 8 characters)</span></label>
          <input id="setup-password" type="password" autocomplete="new-password" placeholder="••••••••" required>
        </div>
        <div class="field">
          <label for="setup-confirm">Confirm password</label>
          <input id="setup-confirm" type="password" autocomplete="new-password" placeholder="••••••••" required>
        </div>
        <div class="actions">
          <button class="primary" type="submit">Set password &amp; sign in</button>
        </div>
      </form>
      <div id="setup-status" class="status" aria-live="polite"></div>
    </div>

    <!-- FORGOT STATE -->
    <div id="view-forgot" class="hidden">
      <h1>Reset password.</h1>
      <p class="subtitle">Enter your subscription email and we'll send you a reset link.</p>
      <form id="forgot-form" novalidate>
        <div class="field">
          <label for="forgot-email">Subscription email</label>
          <input id="forgot-email" type="email" autocomplete="email" placeholder="you@example.com" required>
        </div>
        <div class="actions">
          <button class="primary" type="submit">Send reset link</button>
        </div>
      </form>
      <div id="forgot-status" class="status" aria-live="polite"></div>
    </div>

    <!-- FORGOT SENT STATE -->
    <div id="view-forgot-sent" class="hidden">
      <div class="notice green">Reset link sent — check your inbox. It expires in 1 hour.</div>
      <p class="subtitle">Didn't receive it? Check your spam folder, or <button class="forgot-link" id="resend-link" type="button">send again</button>.</p>
    </div>
  </div>

  <a class="back-link" href="/index.html">← Back to pricing</a>

  <script>
  (function () {
    // ── State ──────────────────────────────────────────────────────────────────
    let currentEmail = "";

    // ── Views ─────────────────────────────────────────────────────────────────
    const views = ["signin", "setup", "forgot", "forgot-sent"];
    function showView(name) {
      views.forEach(v => document.getElementById("view-" + v).classList.toggle("hidden", v !== name));
    }

    // ── Status helpers ────────────────────────────────────────────────────────
    function setStatus(nodeId, msg, isError) {
      const el = document.getElementById(nodeId);
      el.textContent = msg;
      el.className = "status" + (isError ? " error" : "");
    }

    // ── Sign in form ──────────────────────────────────────────────────────────
    document.getElementById("signin-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const email    = document.getElementById("signin-email").value.trim();
      const password = document.getElementById("signin-password").value;
      setStatus("signin-status", "Signing in…", false);

      try {
        const res  = await fetch("/.netlify/functions/verify-email", {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json().catch(() => null);

        if (data && data.ok && data.needs_setup) {
          currentEmail = email;
          document.getElementById("setup-email").value = email;
          showView("setup");
          return;
        }
        if (data && data.ok && data.redirectTo) {
          window.location.href = data.redirectTo;
          return;
        }
        const reason = data && data.reason ? data.reason : `http_${res.status}`;
        const messages = {
          wrong_password:  "Incorrect password.",
          missing_password:"Please enter your password.",
          not_found:       "Email not found. Check your subscription email.",
          not_active:      "Subscription not active.",
        };
        setStatus("signin-status", messages[reason] || `Sign in failed (${reason}).`, true);
      } catch {
        setStatus("signin-status", "Sign in failed. Try again.", true);
      }
    });

    // ── Forgot link ───────────────────────────────────────────────────────────
    document.getElementById("forgot-link").addEventListener("click", function () {
      const email = document.getElementById("signin-email").value.trim();
      if (email) document.getElementById("forgot-email").value = email;
      showView("forgot");
    });

    // ── Setup form ────────────────────────────────────────────────────────────
    document.getElementById("setup-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const email           = document.getElementById("setup-email").value;
      const password        = document.getElementById("setup-password").value;
      const confirmPassword = document.getElementById("setup-confirm").value;
      setStatus("setup-status", "Setting password…", false);

      if (password !== confirmPassword) {
        setStatus("setup-status", "Passwords don't match.", true);
        return;
      }
      if (password.length < 8) {
        setStatus("setup-status", "Password must be at least 8 characters.", true);
        return;
      }

      try {
        const res  = await fetch("/.netlify/functions/set-password", {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, confirmPassword }),
        });
        const data = await res.json().catch(() => null);

        if (data && data.ok && data.redirectTo) {
          window.location.href = data.redirectTo;
          return;
        }
        const reason = data && data.reason ? data.reason : `http_${res.status}`;
        const messages = {
          password_mismatch: "Passwords don't match.",
          password_too_short:"Password must be at least 8 characters.",
          password_already_set: "A password is already set. Use 'Forgot password?' to reset it.",
        };
        setStatus("setup-status", messages[reason] || `Setup failed (${reason}).`, true);
      } catch {
        setStatus("setup-status", "Setup failed. Try again.", true);
      }
    });

    // ── Forgot form ───────────────────────────────────────────────────────────
    async function submitForgot(email) {
      setStatus("forgot-status", "Sending reset link…", false);
      try {
        await fetch("/.netlify/functions/forgot-password", {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        showView("forgot-sent");
      } catch {
        setStatus("forgot-status", "Failed to send. Try again.", true);
      }
    }

    document.getElementById("forgot-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      await submitForgot(document.getElementById("forgot-email").value.trim());
    });

    document.getElementById("resend-link").addEventListener("click", function () {
      showView("forgot");
    });
  })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Manual smoke test**

Run `npx netlify dev` and open `http://localhost:8888/access.html`. Verify:
- Email + password fields visible on load
- "Forgot password?" link visible
- Clicking "Forgot password?" switches to the reset form
- Back navigation works

- [ ] **Step 3: Commit**

```bash
git add access.html
git commit -m "feat: access.html multi-state form for signin, first-time setup, and forgot password"
```

---

## Task 9: `reset-password.html` — reset link landing page

**Files:**
- Create: `reset-password.html`

- [ ] **Step 1: Create the page**

Create `reset-password.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="icon" type="image/png" sizes="64x64" href="assets/favicon-64.png">
  <link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png">
  <link rel="shortcut icon" href="assets/favicon-32.png">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Text Boss — Reset Password</title>
  <style>
    :root {
      --bg:#020203;--surface:#0c0e11;--line:#191d22;--line-hi:#232830;
      --text:#e4ecf2;--muted:#52606d;--muted-hi:#8896a4;--green:#22c55e;--danger:#ef4444;
      --mono:Consolas,Monaco,'Courier New',ui-monospace,monospace;
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    html,body{min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--mono);font-size:15px;}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;
      background-image:radial-gradient(ellipse 60% 30% at 50% 0%,rgba(34,197,94,.07),transparent);}
    .wordmark{font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:28px;}
    .wordmark span{color:var(--green);}
    .card{width:min(100%,480px);border:1px solid var(--line-hi);border-radius:20px;background:var(--surface);padding:32px;box-shadow:0 24px 80px rgba(0,0,0,.55);}
    .card-label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:16px;}
    .card-label .sl{color:var(--green);font-weight:700;}
    h1{font-size:clamp(18px,4vw,22px);margin-bottom:8px;}
    .subtitle{font-size:13px;color:var(--muted-hi);line-height:1.65;margin-bottom:24px;}
    label{display:block;font-size:12px;color:var(--muted-hi);margin-bottom:8px;letter-spacing:.04em;}
    input{width:100%;border:1px solid var(--line-hi);border-radius:12px;background:rgba(0,0,0,.25);color:var(--text);
      padding:13px 16px;font:inherit;font-size:14px;outline:none;caret-color:var(--green);transition:border-color .15s;}
    input:focus{border-color:rgba(34,197,94,.45);}
    input::placeholder{color:var(--muted);}
    .field{margin-bottom:16px;}
    .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;}
    button{display:inline-flex;justify-content:center;align-items:center;min-height:44px;border-radius:10px;padding:0 18px;
      border:1px solid var(--line-hi);color:var(--text);background:var(--surface);font:inherit;font-size:13px;
      cursor:pointer;transition:border-color .15s,filter .15s;white-space:nowrap;}
    button:hover{border-color:rgba(255,255,255,.2);}
    button.primary{background:var(--green);color:#040e07;border-color:transparent;font-weight:700;}
    button.primary:hover{filter:brightness(1.08);}
    .status{margin-top:16px;min-height:20px;font-size:12px;color:var(--muted-hi);line-height:1.5;}
    .status.error{color:#fca5a5;}
    .back-link{margin-top:24px;font-size:12px;color:var(--muted);border:none;background:none;
      padding:0;min-height:0;text-decoration:none;display:inline-block;}
    .back-link:hover{color:var(--text);}
    .notice{font-size:13px;line-height:1.6;padding:14px 16px;border-radius:10px;margin-bottom:16px;}
    .notice.error{color:#fca5a5;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);}
    .hidden{display:none!important;}
    @media(max-width:640px){input{font-size:16px;}}
    @media(max-width:400px){body{padding:16px;}.card{padding:24px 18px;}.actions{flex-direction:column;}.actions button{width:100%;}}
  </style>
</head>
<body>
  <div class="wordmark">Text <span>Boss</span></div>
  <div class="card">
    <div class="card-label"><span class="sl">//</span> reset password</div>

    <!-- Invalid/expired token -->
    <div id="view-invalid" class="hidden">
      <div class="notice error" id="invalid-message">This reset link is invalid or has expired.</div>
      <a class="back-link" href="/access.html">← Back to sign in</a>
    </div>

    <!-- Reset form -->
    <div id="view-form" class="hidden">
      <h1>Set a new password.</h1>
      <p class="subtitle">Choose a new password for your Text Boss account.</p>
      <form id="reset-form" novalidate>
        <div class="field">
          <label for="new-password">New password <span style="color:var(--muted);font-size:11px">(min. 8 characters)</span></label>
          <input id="new-password" type="password" autocomplete="new-password" placeholder="••••••••" required>
        </div>
        <div class="field">
          <label for="confirm-password">Confirm new password</label>
          <input id="confirm-password" type="password" autocomplete="new-password" placeholder="••••••••" required>
        </div>
        <div class="actions">
          <button class="primary" type="submit">Set new password</button>
        </div>
      </form>
      <div id="reset-status" class="status" aria-live="polite"></div>
    </div>
  </div>

  <a class="back-link" href="/access.html">← Back to sign in</a>

  <script>
  (function () {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get("token") || "";

    function showView(name) {
      ["invalid", "form"].forEach(v =>
        document.getElementById("view-" + v).classList.toggle("hidden", v !== name)
      );
    }

    function setStatus(msg, isError) {
      const el = document.getElementById("reset-status");
      el.textContent = msg;
      el.className = "status" + (isError ? " error" : "");
    }

    if (!token) {
      document.getElementById("invalid-message").textContent = "No reset token found. Please request a new link.";
      showView("invalid");
    } else {
      showView("form");
    }

    document.getElementById("reset-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const password        = document.getElementById("new-password").value;
      const confirmPassword = document.getElementById("confirm-password").value;

      if (password !== confirmPassword) { setStatus("Passwords don't match.", true); return; }
      if (password.length < 8)          { setStatus("Password must be at least 8 characters.", true); return; }

      setStatus("Updating password…", false);

      try {
        const res  = await fetch("/.netlify/functions/reset-password", {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, password, confirmPassword }),
        });
        const data = await res.json().catch(() => null);

        if (data && data.ok && data.redirectTo) {
          window.location.href = data.redirectTo;
          return;
        }

        const reason = data && data.reason ? data.reason : `http_${res.status}`;
        const messages = {
          invalid_token:     "This reset link is invalid.",
          token_used:        "This reset link has already been used. Request a new one.",
          token_expired:     "This reset link has expired. Request a new one.",
          password_mismatch: "Passwords don't match.",
          password_too_short:"Password must be at least 8 characters.",
        };
        if (reason === "invalid_token" || reason === "token_used" || reason === "token_expired") {
          document.getElementById("invalid-message").textContent = messages[reason];
          showView("invalid");
        } else {
          setStatus(messages[reason] || `Reset failed (${reason}).`, true);
        }
      } catch {
        setStatus("Reset failed. Try again.", true);
      }
    });
  })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Manual smoke test**

Open `http://localhost:8888/reset-password.html` (no token). Verify the "no token" error message appears. Then open `http://localhost:8888/reset-password.html?token=anything` — verify the form appears.

- [ ] **Step 3: Commit**

```bash
git add reset-password.html
git commit -m "feat: reset-password.html landing page for password reset links"
```

---

## Task 10: Set `RESEND_API_KEY` in Netlify and deploy

- [ ] **Step 1: Create a Resend account and get an API key**

Go to resend.com → sign up → API Keys → Create API Key. Copy the key (starts with `re_`).

- [ ] **Step 2: Add sender domain or use Resend's shared domain for testing**

For immediate testing, Resend allows sending from `onboarding@resend.dev` without domain setup. For production, add `textboss.com.au` as a verified domain in Resend's dashboard and use `noreply@textboss.com.au` as the from address.

Until domain is verified, temporarily change the `from` field in `forgot-password.js`:

```js
from: "Text Boss <onboarding@resend.dev>",
```

- [ ] **Step 3: Set the env var on Netlify**

```bash
npx netlify env:set RESEND_API_KEY "re_your_key_here" --scope functions
```

- [ ] **Step 4: Push and deploy**

```bash
git push
```

Netlify will auto-deploy from main. Wait for the deploy to complete in the Netlify dashboard.

- [ ] **Step 5: End-to-end test**

1. Visit `https://textboss.com.au/access.html`
2. Enter your subscription email and any password → should show "Create your password" setup form
3. Set a password → should redirect to the app
4. Log out, return to `access.html`, enter email + wrong password → should show "Incorrect password."
5. Enter email + correct password → should redirect to the app
6. Click "Forgot password?" → enter email → check inbox for reset link
7. Click the link → set a new password → should redirect to the app

---

## Self-review notes

- All function signatures match across tasks (`updatePasswordHash(email, hash)`, `createToken(email, token, expiresAt)`, etc.)
- `verifyPassword` is injected as a dep in `verify-email` tests but imported directly at runtime — consistent with project pattern for pure functions
- The `forgot-password` always returns `200` even for unknown emails — enumeration protection preserved
- `set-password` guards `password_already_set` — reset flow is the only way to change an existing password
- Migration is additive (`ADD COLUMN IF NOT EXISTS`) — safe to run against existing data; existing subscribers get `password_hash = null` which triggers the setup flow on next login
