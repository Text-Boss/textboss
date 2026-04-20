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
| `BEEHIIV_PUBLICATION_ID` | Beehiiv publication ID for newsletter signups via `subscribe.js` |
| `BEEHIIV_API_KEY` | Beehiiv API key for newsletter signups |

## Architecture

### Tiers
Three subscription tiers — **Core**, **Pro**, **Black** — each with its own HTML app page (`app-core.html`, `app-pro.html`, `app-black.html`), token limits, input limits, and system prompt in `netlify/functions/_lib/tier-policy.js`.

System prompts instruct the AI to write in a natural human voice — no AI-giveaway phrases ("Certainly", "I hope this finds you well", etc.). Each tier has explicit escalation boundaries: Core handles basic comms, Pro handles authority/boundary enforcement, Black handles high-risk/legal-containment scenarios.

### Auth flow
1. User submits email on `access.html` → `POST /.netlify/functions/verify-email`
2. `verify-email` checks Supabase `entitlements` table, verifies `subscription_status` is `active`/`trialing`, then sets a signed `HttpOnly` cookie (`textboss_session`)
3. Each app page loads `app-client.js`, which calls `GET /.netlify/functions/session-verify` on boot and redirects to `denied.html` if the session is invalid or the tier doesn't match `data-app-tier` on the root element
4. `POST /.netlify/functions/chat` re-verifies the session cookie AND re-checks Supabase entitlements on every request before calling OpenAI

Password auth is also supported — `forgot-password.js` / `reset-password.js` / `set-password.js` handle the full PBKDF2 reset flow via Resend email.

### Session cookie
Implemented in `netlify/functions/_lib/session.js`. Format: `base64url(payload).hmac_signature`. Payload contains `email`, `tier`, `iat`, `exp` (30-day TTL). Uses `crypto.timingSafeEqual` for signature comparison. The `Secure` flag is always set unconditionally — do not gate it on `NODE_ENV`.

### Netlify Functions
All backend logic lives in `netlify/functions/`. Each function exports three things:
- `createHandler(deps)` — pure logic, accepts injected dependencies (used in tests)
- `createRuntimeHandler(overrides?)` — wires real dependencies; accepts partial overrides for testing
- `handler(event, context)` — the actual Netlify entry point

`_lib/http.js` exports two helpers: `json(statusCode, body, headers?)` and `denied(statusCode, reason, headers?)`. The `denied` helper always sets `{ ok: false, denied: true }` — clients use the `denied` flag to redirect to `denied.html`.

**Security invariant — every authenticated function must perform a three-way check:**
1. Verify the session cookie signature (`verifySessionCookie`)
2. Re-fetch the entitlement from Supabase (`findEntitlementByEmail`) and confirm `subscription_status` is `active`/`trialing`
3. Assert `normalizeTier(entitlement.entitled_tier) === normalizeTier(session.tier)` — prevents a stale session cookie from accessing a higher tier after a downgrade

Skipping step 3 is a security gap. All current functions enforce it.

### Supabase stores (`_lib/supabase.js`)
Exports store factories: `createEntitlementStore`, `createAvailabilityStore`, `createAppointmentStore`, `createBusinessProfileStore`, `createPushSubscriptionStore`, `createBusyBlockStore`, `createPublicBookingStore`, `createFollowUpStore`, `createSchedulerMemoryStore`, `createTodoStore`, `createServiceStore`. Each accepts an optional `{ client }` override for testing.

All tables are accessed via the service role key (bypasses RLS). RLS is intentionally not used — access control is enforced at the function level by verifying the session cookie before every DB operation.

### OpenAI integration
`netlify/functions/_lib/openai.js` uses the **Responses API** (`POST /v1/responses`), not the Chat Completions API. User turns use `{ type: "input_text", text }`, assistant turns use `{ type: "output_text", text }`. System instructions go in the top-level `instructions` field of the request body — **not** as a `role: "system"` item inside `input` (that is the Chat Completions format and is wrong for the Responses API). System content is injected per-request from `tier-policy.js`.

### Stripe webhook
`stripe-webhook.js` handles `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Upserts `entitlements` using `email` as the conflict key.

### Scheduling subsystem (Pro/Black only)
All scheduling endpoints gate on `SCHEDULING_TIERS = {"Pro", "Black"}` — Core users are denied at the function level.

- `appointments.js` — CRUD for booked appointments
- `availability.js` — CRUD for weekly availability slots
- `schedule-chat.js` — AI conversational scheduling; tools: `find_available_slots`, `create_appointment`, `update_appointment`, `cancel_appointment`, `list_appointments`, `resolve_service`, plus `remember` (Black only)
- `business-profile.js` — GET/POST for business profile (occupation, working hours, buffer times, avatar, business details, booking slug). Also validates and saves: `business_name`, `owner_first_name`, `owner_full_name`, `business_phone`, `website`, `abn`, `city`, `avatar_data` (base64, max 200KB)
- `services.js` — CRUD for the relational `services` table (replaces old JSONB services field on `business_profiles`)
- `public-booking.js` — Unauthenticated client-facing booking via `book.html?owner=<slug>`. AI tools: `find_available_slots` + `confirm_booking`. Returns `.ics` on booking, sends Web Push to owner
- `busy-blocks.js` — Calendar busy blocks (Pro: max 200, Black: unlimited)
- `ical-import.js` — Parses `.ics` uploads into busy blocks; inline RFC 5545 parser, no external deps
- `follow-up.js` / `send-follow-ups.js` — AI-drafted follow-up messages; scheduled daily at 9am UTC
- `send-reminders.js` — Scheduled hourly; Web Push appointment reminders 24h before. Looks up owner tier to embed a tier-specific `url` in the push payload.
- `send-todo-reminders.js` — Scheduled every 15 min; Web Push + Resend email fallback for due to-do reminders. Same tier-lookup pattern for `url`.
- `push-subscribe.js` / `vapid-key.js` — Web Push subscription management
- `threads.js` — Conversation thread persistence

### Scheduler AI model (`_lib/scheduler.js`)
`findAvailableSlots({appointments, busyBlocks, workingHours, durationMinutes, preBuffer, postBuffer, startDate, endDate, maxSlotsPerDay, stepMinutes})` — pure function, no DB calls. `workingHoursToArray(jsonObj)` converts `business_profiles.working_hours` format (`{"1":{start,end}}`) to array form.

### Black tier persistent memory
`schedule-chat.js` loads a `memory_text` blob from `scheduler_memory` (one row per owner) and injects it as `=== MEMORY ===` into the system prompt. The `remember` tool lets the AI persist preference updates back to that row. Core/Pro do not get this tool or memory injection.

### Supabase tables
| Table | Migration | Notes |
|---|---|---|
| `entitlements` | — | Stripe-managed subscription state |
| `threads` / `messages` | 001 | Chat thread persistence |
| `availability` | 003 | Weekly availability slots |
| `appointments` | 003 | Booked appointments; `reminder_sent_at` added in 002 |
| `business_profiles` | 004 | Per-user scheduler config + avatar + business details |
| `push_subscriptions` | 004 | Web Push endpoint storage |
| `public_booking_links` | 005 | Public booking slug → owner mapping |
| `follow_up_jobs` | 006 | Queued follow-up messages |
| `busy_blocks` | 007 | Calendar blocks; `batch_id` for iCal import undo |
| `users` | 008 | PBKDF2 password credentials |
| `services` | 009 | Relational services (title, duration_min, price, buffer_time_min) |
| `scheduler_memory` | 010 | Black tier AI persistent memory (one row per owner) |
| `todos` | 011 | To-do items with urgency, reminders, done state |

### Client-side architecture
App pages (`app-pro.html`, `app-black.html`, `app-core.html`) are single-page shells with a scrollable tab bar. All tabs lazy-init on first click. Scripts loaded as plain `<script>` tags (no bundler):

| Script | Exported global | Purpose |
|---|---|---|
| `app-client.js` | — | Session verify, logout, char count, thread UI |
| `scheduler-client.js` | `window.initScheduler`, `window.checkOnboardingOnLoad` | Scheduler tab, calendar, wizard, services, working hours |
| `followup-client.js` | `window.initFollowUps` | Follow-ups tab |
| `prompts-client.js` | `window.initPrompts` | Prompts tab — fetches tier HTML file, parses with DOMParser, renders cards natively with `{{variable}}` auto-fill from profile |
| `todos-client.js` | `window.initTodos` | To-Do tab + collapsible Notes (localStorage) |
| `settings-client.js` | `window.initSettings` | Settings tab — avatar upload, business details, booking link generate/copy |

`app-pro.html` and `app-black.html` call `window.checkOnboardingOnLoad({ tier })` on DOMContentLoaded — shows the 4-step onboarding wizard immediately if `onboarding_complete` is false on the profile.

**Client fetch requirement:** Every `fetch()` call in client scripts that hits a Netlify Function must include `credentials: 'same-origin'` so the session cookie is sent. Omitting it causes silent 401s — the function sees no cookie and denies the request.

### Onboarding wizard (4 steps)
Defined in `scheduler-client.js`. Steps: (1) personal & business details, (2) occupation, (3) services + pricing, (4) buffer times. On finish, saves all fields to `business_profiles` and services to the relational `services` table.

### Public booking page (`book.html`)
Accessed via `book.html?owner=<slug>`. Unauthenticated. On load, calls `public-booking.js` with `message: "__init__"` to fetch `businessName`, `occupation`, `ownerName`, `city`, `avatarData`, and `services`. Renders a chat UI — clients select a service chip or type freely. AI handles availability checking and booking confirmation, returns `.ics`.

### `sw.js` (service worker)
Handles Web Push `push` events, app-shell caching (cache name `tb-shell-v3`), and offline fallback. On notification click, navigates to `data.url` from the push payload if present; falls back to `/access.html`. The send functions (`send-reminders.js`, `send-follow-ups.js`, `send-todo-reminders.js`) look up the owner's tier and include a tier-specific deep-link URL in every push payload. `APP_SHELL_FILES` caches all three app pages plus all client scripts — bump the cache name (`tb-shell-vN`) whenever cached static files change.

### Testing pattern
Tests use Node's built-in `assert/strict` — no test framework. Each test file is a self-executing async function. `npm test` discovers and runs all `tests/*.test.js`. Runtime-integration tests (`*-runtime.test.js`) require real env vars and are for manual runs only.

## Project rules
- Tiers must stay strictly separated — Core/Pro/Black behavior must not bleed across
- Denied users must never receive business advice (no OpenAI call without a valid, active entitlement)
- All backend logic goes in `netlify/functions/`; no secrets in committed code
- Do not modify `index.html`, `core.html`, `pro.html`, or `black.html` — these are marketing/landing pages, distinct from the subscriber app pages (`app-core.html`, `app-pro.html`, `app-black.html`)
- Services are stored in the relational `services` table — do not use the old `services` JSONB column on `business_profiles`
- `business-profile.js` is Pro/Black only — Core has no profile or scheduling features
