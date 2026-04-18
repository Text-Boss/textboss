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
| `RESEND_API_KEY` | Resend API key for sending password reset emails |
| `REMINDERS_SECRET` | Bearer token to authorize non-scheduled invocations of `send-reminders.js` |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key (generate: `npx web-push generate-vapid-keys`) |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key |
| `VAPID_SUBJECT` | Web Push VAPID subject (`mailto:you@domain.com`) |

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

`_lib/http.js` exports two helpers used across functions: `json(statusCode, body, headers?)` and `denied(statusCode, reason, headers?)`. The `denied` helper always sets `{ ok: false, denied: true }` in the response body — clients use the `denied` flag to redirect to `denied.html`.

`session-logout.js` clears the `textboss_session` cookie by setting it with `Max-Age=0`.

### Supabase `entitlements` table columns
`email`, `entitled_tier`, `subscription_status`, `current_period_end`, `stripe_customer_id`, `stripe_subscription_id`, `price_id`, `updated_at`

### OpenAI integration
`netlify/functions/_lib/openai.js` uses the **Responses API** (`POST /v1/responses`), not the Chat Completions API. The conversation history passed by the client maps directly to the `input` array. System instructions are injected per-request from `tier-policy.js` (not stored server-side between calls).

Message format in the `input` array: user turns use `{ type: "input_text", text }`, assistant turns use `{ type: "output_text", text }`. This differs from Chat Completions format and is specific to the Responses API.

### Stripe webhook
`stripe-webhook.js` handles `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. It upserts the `entitlements` table using `email` as the conflict key.

### Scheduling subsystem (Pro/Black only)
Three additional functions handle appointment scheduling:
- `availability.js` — CRUD for a user's weekly availability slots (`availability` table: `owner_email`, `day_of_week`, `start_time`, `end_time`, `is_active`)
- `appointments.js` — CRUD for booked appointments (`appointments` table: `owner_email`, `client_name`, `client_contact`, `title`, `scheduled_date`, `scheduled_time`, `duration_minutes`, `status`, `notes`)
- `schedule-chat.js` — AI-powered conversational scheduling; reads availability + appointments and uses OpenAI to create/update appointments via natural language
- `threads.js` — manages conversation thread persistence (`threads`/`messages` tables; schema in `migrations/001_create_threads_and_messages.sql`; scheduling tables in `003`, reminder column in `002`)
- `send-reminders.js` — scheduled function (runs hourly per `netlify.toml`) that finds confirmed appointments within the next 24 h with no `reminder_sent_at`, delivers Web Push notifications via `web-push` (VAPID), marks them reminded. Authorized by Netlify's `x-nf-event: schedule` header or `REMINDERS_SECRET` bearer token.
- `business-profile.js` — GET/POST for a user's business profile (`business_profiles` table: occupation, services with durations, buffer times, working hours, onboarding flag). Pro/Black only.
- `push-subscribe.js` — POST to save a Web Push subscription, DELETE to remove one (`push_subscriptions` table). Pro/Black only.

`sw.js` at the project root is the service worker — handles `push` events and shows notifications. Must be registered from the scheduler app pages via `navigator.serviceWorker.register('/sw.js')`.

### Supabase additional tables
- `business_profiles` — per-user scheduler config (see `migrations/004`)
- `push_subscriptions` — Web Push endpoint/key storage (see `migrations/004`)

### Scheduler AI model (`_lib/scheduler.js`)
`findAvailableSlots({appointments, workingHours, durationMinutes, preBuffer, postBuffer, startDate, endDate, maxSlotsPerDay})` — pure function, no DB calls. `workingHoursToArray(jsonObj)` converts `business_profiles.working_hours` format (`{"1":{start,end}}`) to the array format `findAvailableSlots` expects. Used by `schedule-chat.js` for the `find_available_slots` AI tool.

All scheduling endpoints gate on `SCHEDULING_TIERS = {"Pro", "Black"}` — Core users are denied at the function level.

Thread limits per tier (defined in `tier-policy.js`): Core = 10, Pro = 50, Black = unlimited.

### Supabase stores (`_lib/supabase.js`)
Exports `createEntitlementStore`, `createAvailabilityStore`, `createAppointmentStore`, `createBusinessProfileStore`, `createPushSubscriptionStore`. Each factory accepts an optional `{ client }` override for testing without real Supabase credentials.

### Scheduler client (`scheduler-client.js`)
Shared IIFE loaded by `app-pro.html` and `app-black.html`. Call `window.initScheduler({ tier, inputLimit, enableIcalExport })` when the Scheduler tab is first activated. Manages scheduling conversation state, calendar UI, appointment cache, and the onboarding wizard. Not a module — loads as a plain `<script>` tag.

### Testing pattern
Tests use Node's built-in `assert/strict` — no test framework. Each test file exports nothing; tests are self-executing async functions. The `npm test` script discovers and runs all `tests/*.test.js` files. Runtime-integration tests (e.g. `*-runtime.test.js`) require real env vars and are meant for manual runs.

## Project rules
- Tiers must stay strictly separated — Core/Pro/Black behavior must not bleed across
- Denied users must never receive business advice (no OpenAI call without a valid, active entitlement)
- All backend logic goes in `netlify/functions/`; no secrets in committed code
- Do not modify `index.html`, `core.html`, `pro.html`, or `black.html` unless intentionally replacing them — these are the marketing/landing pages, distinct from the subscriber app pages (`app-core.html`, `app-pro.html`, `app-black.html`)
