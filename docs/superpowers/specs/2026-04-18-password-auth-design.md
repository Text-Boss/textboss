# Password Authentication Design

**Date:** 2026-04-18
**Status:** Approved

## Overview

Add password-based authentication to Text Boss so subscriber accounts are protected by a password in addition to the existing email-based entitlement check. New subscribers are prompted to set a password on their first sign-in attempt. Existing subscribers without a password are also prompted on their next visit. A "Forgot password" flow allows self-service recovery via a one-time email link.

---

## User Flows

### Flow 1 — Returning subscriber (has password)

1. Subscriber visits `access.html`, enters email + password, clicks **Sign in**
2. `verify-email` checks entitlement (active/trialing), then verifies password hash
3. On success: session cookie set, redirected to `app-[tier].html`
4. On wrong password: error shown inline, no cookie issued

### Flow 2 — New subscriber (no password set)

1. Subscriber visits `access.html`, enters email + any password, clicks **Sign in**
2. `verify-email` finds active entitlement but `password_hash` is null → returns `{ needs_setup: true }`
3. Frontend transforms the form in-place: shows amber notice "No password set yet", replaces password field with **Create password** + **Confirm password** fields
4. Subscriber sets password, clicks **Set password & sign in**
5. `set-password` hashes and stores the password, issues session cookie
6. Redirected to `app-[tier].html`

### Flow 3 — Forgot password

1. Subscriber clicks **Forgot password?** on `access.html`
2. Form switches to a single email field with a **Send reset link** button
3. `forgot-password` generates a secure random token, stores it with a 1-hour expiry, sends an email via Resend with a link to `reset-password.html?token=<token>`
4. Response is always success (does not reveal whether the email is on file)
5. Subscriber clicks the link in their inbox → `reset-password.html`
6. Enters new password + confirm, submits to `reset-password`
7. `reset-password` validates token (exists, not expired, not used), hashes and stores new password, marks token used, issues session cookie
8. Redirected to `app-[tier].html`

---

## Architecture

### Password hashing

New `netlify/functions/_lib/password.js` using Node's built-in `crypto` (no new npm dependency):

- **Algorithm:** PBKDF2-SHA256, 100,000 iterations, 32-byte output, 16-byte random salt
- `hashPassword(plaintext)` → returns a single string `"<hex-salt>:<hex-hash>"` suitable for storing in one column
- `verifyPassword(plaintext, stored)` → returns boolean, uses `crypto.timingSafeEqual`

### Database changes

**Migration 008** — two changes:

```sql
-- Add password column to entitlements
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Token store for password resets
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token       TEXT        PRIMARY KEY,
  email       TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_prt_email ON password_reset_tokens (email);
```

### Netlify Functions

#### Modified: `verify-email.js`

- Accepts `{ email, password }` in request body
- If `password_hash` is null → return `200 { ok: true, needs_setup: true }` (no cookie, entitlement confirmed but password not yet set)
- If `password_hash` exists and no `password` provided → return `400 { reason: "missing_password" }`
- If `password` provided and `verifyPassword` returns false → return `403 { reason: "wrong_password" }`
- If `password` matches → issue cookie as before

#### New: `set-password.js`

- `POST { email, password, confirmPassword }`
- Verifies entitlement is active and `password_hash` is null (prevents overwrite via this endpoint — password changes go through reset flow)
- Validates `password === confirmPassword` and `password.length >= 8`
- Hashes and stores password in `entitlements.password_hash`
- Re-reads the full entitlement to get `entitled_tier`, issues session cookie, returns redirect target

#### New: `forgot-password.js`

- `POST { email }`
- Always returns `200 { ok: true }` regardless of whether email is found (prevents enumeration)
- If entitlement found: deletes any existing unused tokens for that email, generates a fresh `crypto.randomBytes(32)` token (hex), stores in `password_reset_tokens` with `expires_at = now() + 1 hour`
- Sends email via Resend: subject "Reset your Text Boss password", body contains reset link `https://textboss.com.au/reset-password.html?token=<token>`

#### New: `reset-password.js`

- `POST { token, password, confirmPassword }`
- Looks up token in `password_reset_tokens` — returns `403` if not found, expired, or already used
- Validates password match and minimum length
- Hashes and stores new password, marks token `used_at = now()`
- Re-reads the full entitlement to get `entitled_tier`, issues session cookie, returns redirect target

### Supabase store additions (`_lib/supabase.js`)

Add `createPasswordResetTokenStore` factory with methods:
- `createToken(email, token, expiresAt)`
- `findToken(token)` — returns row or null
- `markTokenUsed(token)`
- `deleteTokensByEmail(email)` — removes all tokens for that email (called before creating a new one)

### Frontend changes

#### Modified: `access.html`

Three UI states managed in JavaScript (no page navigations):

1. **Sign in state** (default): email + password fields, Sign in button, "Forgot password?" link below
2. **Setup state** (triggered by `needs_setup: true`): amber notice, email locked, Create password + Confirm password fields, "Set password & sign in" button
3. **Forgot state** (triggered by link click): email field only, "Send reset link" button, back link

#### New: `reset-password.html`

Minimal page matching `access.html` visual style. Reads `?token=` from URL on load. Shows new password + confirm fields. On submit calls `reset-password`. On success redirects to app. On invalid/expired token shows clear error with link back to `access.html`.

### New dependency

```bash
npm install resend
```

New env var: `RESEND_API_KEY`

---

## Security

| Concern | Mitigation |
|---|---|
| Password storage | PBKDF2-SHA256, 100k iterations, per-user salt |
| Timing attacks on verify | `crypto.timingSafeEqual` in `verifyPassword` |
| Reset token guessing | 32 bytes of `crypto.randomBytes` (256-bit entropy) |
| Token reuse | `used_at` set on first use; subsequent attempts rejected |
| Token expiry | 1-hour TTL enforced server-side |
| Email enumeration via forgot-password | Always returns success regardless of email lookup result |
| Password overwrite via set-password | `set-password` only works when `password_hash` is null |
| Minimum password strength | 8 character minimum enforced on both client and server |

---

## Testing

Each new function gets a unit test file in `tests/` following the existing `createHandler(deps)` injection pattern:

- `tests/set-password.test.js`
- `tests/forgot-password.test.js`
- `tests/reset-password.test.js`
- `tests/verify-email.test.js` — extended with password cases
- `tests/password.test.js` — hash/verify helper unit tests

---

## Out of scope

- Email verification on sign-up (Stripe already validates email at checkout)
- Password change from within the app (can add later via reset flow)
- Rate limiting on login attempts (Netlify does not expose IP at function level without additional middleware)
- Multi-factor authentication
