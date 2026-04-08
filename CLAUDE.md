# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run all tests
npm test

# Run a single test file
node tests/<name>.test.js

# Local dev server (Netlify CLI)
npx netlify dev
```

`netlify dev` serves static files from `.` and Netlify Functions from `netlify/functions/` on port 8888.

## Required environment variables

| Variable | Purpose |
|---|---|
| `TEXTBOSS_SESSION_SECRET` | HMAC key for signing session cookies |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | OpenAI model name (e.g. `gpt-4o`) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_CORE` | Stripe price ID for Core tier |
| `STRIPE_PRICE_PRO` | Stripe price ID for Pro tier |
| `STRIPE_PRICE_BLACK` | Stripe price ID for Black tier |

## Architecture

### Tiers
Three subscription tiers — **Core**, **Pro**, **Black** — each with its own HTML app page (`app-core.html`, `app-pro.html`, `app-black.html`), token limits, input limits, and system prompt in `netlify/functions/_lib/tier-policy.js`.

### Auth flow
1. User submits email on `access.html` → `POST /.netlify/functions/verify-email`
2. `verify-email` checks Supabase `entitlements` table, verifies `subscription_status` is `active`/`trialing`, then sets a signed `HttpOnly` cookie (`textboss_session`)
3. Each app page loads `app-client.js`, which calls `GET /.netlify/functions/session-verify` on boot and redirects to `denied.html` if the session is invalid or the tier doesn't match `data-app-tier` on the root element
4. `POST /.netlify/functions/chat` re-verifies the session cookie AND re-checks Supabase entitlements on every request before calling OpenAI

### Session cookie
Implemented in `netlify/functions/_lib/session.js`. Format: `base64url(payload).hmac_signature`. Payload contains `email`, `tier`, `iat`, `exp` (30-day TTL). Uses `crypto.timingSafeEqual` for signature comparison.

### Netlify Functions
All backend logic lives in `netlify/functions/`. Each function exports three things:
- `createHandler(deps)` — pure logic, accepts injected dependencies (used in tests)
- `createRuntimeHandler(overrides?)` — wires real dependencies; accepts partial overrides for testing
- `handler(event, context)` — the actual Netlify entry point

### Supabase `entitlements` table columns
`email`, `entitled_tier`, `subscription_status`, `current_period_end`, `stripe_customer_id`, `stripe_subscription_id`, `price_id`, `updated_at`

### OpenAI integration
`netlify/functions/_lib/openai.js` uses the **Responses API** (`POST /v1/responses`), not the Chat Completions API. The conversation history passed by the client maps directly to the `input` array. System instructions are injected per-request from `tier-policy.js` (not stored server-side between calls).

### Stripe webhook
`stripe-webhook.js` handles `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. It upserts the `entitlements` table using `email` as the conflict key.

### Scheduling subsystem (Pro/Black only)
Three additional functions handle appointment scheduling:
- `availability.js` — CRUD for a user's weekly availability slots (`availability` table: `owner_email`, `day_of_week`, `start_time`, `end_time`, `is_active`)
- `appointments.js` — CRUD for booked appointments (`appointments` table: `owner_email`, `client_name`, `client_contact`, `title`, `scheduled_date`, `scheduled_time`, `duration_minutes`, `status`, `notes`)
- `schedule-chat.js` — AI-powered conversational scheduling; reads availability + appointments and uses OpenAI to create/update appointments via natural language
- `threads.js` — manages conversation thread persistence (`threads`/`messages` tables; schema in `migrations/001_create_threads_and_messages.sql`)

All scheduling endpoints gate on `SCHEDULING_TIERS = {"Pro", "Black"}` — Core users are denied at the function level.

### Supabase stores (`_lib/supabase.js`)
Exports `createEntitlementStore`, `createAvailabilityStore`, `createAppointmentStore`. Each factory accepts an optional `{ client }` override for testing without real Supabase credentials.

### Testing pattern
Tests use Node's built-in `assert/strict` — no test framework. Each test file exports nothing; tests are self-executing async functions. The `npm test` script discovers and runs all `tests/*.test.js` files. Runtime-integration tests (e.g. `*-runtime.test.js`) require real env vars and are meant for manual runs.

## Project rules
- Tiers must stay strictly separated — Core/Pro/Black behavior must not bleed across
- Denied users must never receive business advice (no OpenAI call without a valid, active entitlement)
- All backend logic goes in `netlify/functions/`; no secrets in committed code
- Do not modify `index.html`, `core.html`, `pro.html`, or `black.html` unless intentionally replacing them
