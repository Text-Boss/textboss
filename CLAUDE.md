# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Live site

Production URL: **https://textboss.com.au/**

## Commands

```bash
# Run all tests
npm test

# Run a single test file
node tests/<name>.test.js

# Local dev server (Netlify CLI)
npx netlify dev

# Build the Capacitor `www/` bundle from the static site
npm run build:app

# Sync the built web bundle into the native iOS/Android Capacitor projects
npm run cap:sync

# Regenerate prompts-data.json from pro_subscriber_prompts.html (run after editing prompt templates)
node scripts/extract-prompts.js
```

`netlify dev` serves static files from `.` and Netlify Functions from `netlify/functions/` on port 8888.

## Required environment variables

| Variable | Purpose |
|---|---|
| `TEXTBOSS_SESSION_SECRET` | HMAC key for signing session cookies |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_MODEL` | Anthropic model name (optional, defaults to `claude-opus-4-7`) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_CORE` | Stripe price ID for Core tier |
| `STRIPE_PRICE_PRO` | Stripe price ID for Pro tier |
| `STRIPE_PRICE_BLACK` | Stripe price ID for Black tier |
| `RESEND_API_KEY` | Resend API key for sending password reset emails and booking confirmations |
| `MOBILEMESSAGE_USERNAME` | Mobile Message API username (SMS notifications) |
| `MOBILEMESSAGE_PASSWORD` | Mobile Message API password |
| `MOBILEMESSAGE_SENDER` | Mobile Message sender ID (default: `TEXT BOSS`) |
| `REMINDERS_SECRET` | Bearer token to authorize non-scheduled invocations of `send-reminders.js` |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key (generate: `npx web-push generate-vapid-keys`) |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key |
| `VAPID_SUBJECT` | Web Push VAPID subject (`mailto:you@domain.com`) |
| `BEEHIIV_PUBLICATION_ID` | Beehiiv publication ID for newsletter signups via `subscribe.js` |
| `BEEHIIV_API_KEY` | Beehiiv API key for newsletter signups |
| `ONESIGNAL_APP_ID` | OneSignal application ID — used by web SDK (frontend) and REST API (backend push delivery) |
| `ONESIGNAL_REST_API_KEY` | OneSignal REST API key — authorises server-side push via `_lib/onesignal.js` |

## Architecture

### Tiers
Three subscription tiers — **Core**, **Pro**, **Black** — each with its own HTML app page (`app-core.html`, `app-pro.html`, `app-black.html`), token limits, input limits, and system prompt in `netlify/functions/_lib/tier-policy.js`.

System prompts instruct the AI to write in a natural human voice — no AI-giveaway phrases ("Certainly", "I hope this finds you well", etc.). Each tier has explicit escalation boundaries: Core handles basic comms, Pro handles authority/boundary enforcement, Black handles high-risk/legal-containment scenarios.

### Auth flow
1. User submits email on `access.html` → `POST /.netlify/functions/verify-email`
2. `verify-email` checks Supabase `entitlements` table, verifies `subscription_status` is `active`/`trialing`, then sets a signed `HttpOnly` cookie (`textboss_session`)
3. Each app page loads `app-client.js`, which calls `GET /.netlify/functions/session-verify` on boot and redirects to `denied.html` if the session is invalid or the tier doesn't match `data-app-tier` on the root element
4. `POST /.netlify/functions/chat` re-verifies the session cookie AND re-checks Supabase entitlements on every request before calling Anthropic

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

### Shared `_lib` utilities
- `anthropic.js` — Anthropic Messages API client (see above)
- `booking-auth.js` — `verifyBookingAccess(event, deps)` implements the three-way auth check + scheduling-tier gate in one call; returns `{ session, tier }` or `{ error }`. Also exports `getHistoryLimit(tier)` (Pro: 50, Black: unlimited) and `isBlackTier(tier)`. All scheduling functions use this instead of duplicating the auth logic.
- `password.js` — `hashPassword(plaintext)` and `verifyPassword(plaintext, stored)` using PBKDF2-SHA256 (100k iterations). Format: `salt_hex:hash_hex`.
- `ical.js` — RFC 5545 iCal parser extracted from `ical-import.js` (no external deps).
- `onesignal.js` — `sendPushToUser(externalUserId, { title, body, data })` — sends push via OneSignal REST API targeting by external user ID (email). Returns `{ skipped: true }` if `ONESIGNAL_APP_ID` / `ONESIGNAL_REST_API_KEY` are unset (safe in local dev). Used by scheduling notification functions as the push delivery layer.
- `session.js`, `http.js`, `tier-policy.js`, `scheduler.js`, `sms.js`, `supabase.js` — documented below.

### Supabase stores (`_lib/supabase.js`)
Exports store factories: `createEntitlementStore`, `createAvailabilityStore`, `createAppointmentStore`, `createBusinessProfileStore`, `createPushSubscriptionStore`, `createBusyBlockStore`, `createPublicBookingStore`, `createFollowUpStore`, `createSchedulerMemoryStore`, `createTodoStore`, `createServiceStore`. Each accepts an optional `{ client }` override for testing.

All tables are accessed via the service role key (bypasses RLS). RLS is intentionally not used — access control is enforced at the function level by verifying the session cookie before every DB operation.

### Anthropic integration
`netlify/functions/_lib/anthropic.js` wraps the **Messages API** (`POST /v1/messages`). Conversations use the standard `{ role, content }` messages array format — `role` is `"user"` or `"assistant"`, `content` is a plain string. System instructions go in the top-level `system` field of the request body. `createAnthropicClient()` exposes `createResponse({ tier, message, conversation, policy, extraSystemContext })` which assembles the system string from `tier-policy.js` instructions, builds the messages array, and returns `{ output, usage }`. Default model is `claude-opus-4-7`.

### Stripe webhook
`stripe-webhook.js` handles `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Upserts `entitlements` using `email` as the conflict key.

### Scheduling subsystem (Pro/Black only)
All scheduling endpoints gate on `SCHEDULING_TIERS = {"Pro", "Black"}` — Core users are denied at the function level.

- `appointments.js` — CRUD for booked appointments
- `availability.js` — CRUD for weekly availability slots
- `schedule-chat.js` — AI conversational scheduling; tools: `resolve_service`, `find_available_slots`, `list_appointments`, `book_appointment`, `cancel_appointment`, `reschedule_appointment`, `add_busy_block`, plus `remember` (Pro/Black). Uses `max_tokens: 4096` hardcoded — do not replace with `policy.responseMaxTokens`, which is too low for tool-call round-trips.
- `business-profile.js` — GET/POST for business profile (occupation, working hours, buffer times, avatar, business details, booking slug). Also validates and saves: `business_name`, `owner_first_name`, `owner_full_name`, `business_phone`, `website`, `abn`, `city`, `avatar_data` (base64, max 200KB)
- `services.js` — CRUD for the relational `services` table (replaces old JSONB services field on `business_profiles`)
- `public-booking.js` — Unauthenticated client-facing booking via `book.html?owner=<slug>`. AI tools: `find_available_slots` + `confirm_booking`. `confirm_booking` requires `client_phone` (mandatory) and accepts optional `client_email`. On confirmation: sends SMS to owner (`business_phone`) + client via Mobile Message; sends Resend email to owner + client (if email provided); sends Web Push to owner with deep-link URL. Uses `_lib/sms.js` for SMS delivery.
- `busy-blocks.js` — Calendar busy blocks (Pro: max 200, Black: unlimited)
- `ical-import.js` — Parses `.ics` uploads into busy blocks; inline RFC 5545 parser, no external deps
- `follow-up.js` / `send-follow-ups.js` — AI-drafted follow-up messages; scheduled daily at 9am UTC
- `send-reminders.js` — Scheduled hourly; Web Push appointment reminders 24h before. Looks up owner tier to embed a tier-specific `url` in the push payload.
- `send-todo-reminders.js` — Scheduled every 15 min; Web Push + Resend email fallback for due to-do reminders. Same tier-lookup pattern for `url`.
- `todos.js` — CRUD for the `todos` table (urgency, reminders, done state); gated on Pro/Black
- `push-subscribe.js` / `vapid-key.js` — Web Push subscription management
- `subscribe.js` — Beehiiv newsletter signup (unauthenticated; uses `BEEHIIV_PUBLICATION_ID` + `BEEHIIV_API_KEY`)
- `onesignal-config.js` — Unauthenticated GET; returns `{ appId }` from `ONESIGNAL_APP_ID` so the frontend OneSignal Web SDK can initialise without hardcoding the app ID. Returns 503 `{ error: "not_configured" }` if unset.
- `threads.js` — Conversation thread persistence

### SMS utility (`_lib/sms.js`)
`sendSms({ to, body })` — sends via Mobile Message REST API (`POST https://api.mobilemessage.com.au/v1/messages`, Basic Auth). Normalises AU mobile numbers (`04xx` → `61xx`). Reads `MOBILEMESSAGE_USERNAME`, `MOBILEMESSAGE_PASSWORD`, `MOBILEMESSAGE_SENDER` from env — returns silently if credentials are missing (safe in local dev).

### Scheduler AI model (`_lib/scheduler.js`)
`findAvailableSlots({appointments, busyBlocks, workingHours, durationMinutes, preBuffer, postBuffer, startDate, endDate, maxSlotsPerDay, stepMinutes})` — pure function, no DB calls. `workingHoursToArray(jsonObj)` converts `business_profiles.working_hours` format (`{"1":{start,end}}`) to array form.

### Pro/Black persistent memory
`schedule-chat.js` loads a `memory_text` blob from `scheduler_memory` (one row per owner) and injects it as `=== MEMORY ===` into the system prompt for both Pro and Black. The `remember` tool lets the AI persist preference updates back to that row. Core does not get this tool or memory injection.

### Supabase tables
SQL migrations live in `migrations/` at the repo root (not `supabase/migrations/`). `migrations/supabase_full_setup.sql` is a consolidated bootstrap script for fresh projects.

| Table | Migration | Notes |
|---|---|---|
| `entitlements` | — | Stripe-managed subscription state |
| `threads` / `messages` | 001 | Chat thread persistence |
| `availability` | 003 | Weekly availability slots |
| `appointments` | 003 | Booked appointments; `reminder_sent_at` added in 002; `client_phone` added in 012 |
| `business_profiles` | 004 | Per-user scheduler config + avatar + business details |
| `push_subscriptions` | 004 | Web Push endpoint storage |
| `public_booking_links` | 005 | Public booking slug → owner mapping |
| `follow_up_jobs` | 006 | Queued follow-up messages |
| `busy_blocks` | 007 | Calendar blocks; `batch_id` for iCal import undo |
| `users` | 008 | PBKDF2 password credentials |
| `services` | 009 | Relational services (title, duration_min, price, buffer_time_min) |
| `scheduler_memory` | 010 | Pro/Black AI persistent memory (one row per owner) |
| `todos` | 011 | To-do items with urgency, reminders, done state |
| `appointments.client_phone` | 012 | Client mobile number (mandatory on public bookings) |

### Client-side architecture
There are two app shell architectures:
- **`app-core.html` / `app-pro.html` / `app-black.html`** — tier-specific single-page shells with a scrollable tab bar. Each reads its tier from the `data-app-tier` attribute and loads the matching tier policy at boot. These are the primary subscriber app pages.
- **`app.html`** — the primary app shell all users land on after login (`verify-email.js` redirects here). Serves all tiers dynamically — fetches the session tier at boot and applies it via `applyTier()`. Uses a horizontal scrollable `#tab-bar` (tabs: Chat, Schedule, Prompts, Threads, Settings) for navigation. Does not use `data-app-tier` in HTML — the attribute is set programmatically, so `app-client.js` is a no-op on this page. Navigation uses inline JS in `app.html` bound to `.tab-btn[data-section]` buttons; do not restore the old sidebar drawer.

App pages (`app-pro.html`, `app-black.html`, `app-core.html`) are single-page shells with a scrollable tab bar. All tabs lazy-init on first click. Scripts loaded as plain `<script>` tags (no bundler). `app-mobile.css` is the shared stylesheet for `app.html` — it defines CSS custom properties for tier accent colours (`--accent`, `--accent-bg`) via `[data-tier="Core/Pro/Black"]` selectors, and also contains the `#tab-bar` / `.tab-btn` styles used by `app.html`.

There is no sidebar drawer in `app.html`. The `#sidebar-toggle` is `display: none` and the drawer HTML has been removed — the tab bar is the sole navigation. Do not re-enable the sidebar drawer. On Pro/Black, the scheduler panel's `.sched-sidebar` (calendar/hours/services/settings) slides off-screen at ≤700px; it is revealed by the `.sched-mobile-toggle` button (`#sched-mobile-toggle`) which is only visible at that breakpoint. The backdrop (`#sidebar-backdrop`) is a hidden stub kept for `app-client.js` null-guard compatibility.

| Script | Exported global | Purpose |
|---|---|---|
| `app-client.js` | — | Session verify, logout, char count, thread UI |
| `scheduler-client.js` | `window.initScheduler`, `window.checkOnboardingOnLoad`, `window.refreshScheduler` | Scheduler tab, calendar, wizard, services, working hours; badge shows upcoming confirmed count; auto-refreshes on `visibilitychange` |
| `followup-client.js` | `window.initFollowUps` | Follow-ups tab |
| `prompts-client.js` | `window.initPrompts` | Prompts tab — fetches the tier-specific prompts HTML (`core_subscriber_prompts.html`, `pro_subscriber_prompts.html`, `black_subscriber_prompts.html`), parses with DOMParser, renders cards natively with `{{variable}}` auto-fill from profile |
| `todos-client.js` | `window.initTodos` | To-Do tab + collapsible Notes (localStorage) |
| `settings-client.js` | `window.initSettings` | Settings tab — avatar upload, business details, booking link generate/copy |

`app-pro.html` and `app-black.html` call `window.checkOnboardingOnLoad({ tier })` on DOMContentLoaded — shows the 4-step onboarding wizard immediately if `onboarding_complete` is false on the profile.

**Client fetch requirement:** Every `fetch()` call in client scripts that hits a Netlify Function must include `credentials: 'same-origin'` so the session cookie is sent. Omitting it causes silent 401s — the function sees no cookie and denies the request.

### Onboarding wizard (4 steps)
Defined in `scheduler-client.js`. Steps: (1) personal & business details, (2) occupation, (3) services + pricing, (4) buffer times. On finish, saves all fields to `business_profiles` and services to the relational `services` table.

### Public booking page (`book.html`)
Accessed via `book.html?owner=<slug>`. Unauthenticated. On load, calls `public-booking.js` with `message: "__init__"` to fetch `businessName`, `occupation`, `ownerName`, `city`, `avatarData`, and `services`. Renders a chat UI — clients select a service chip or type freely. AI handles availability checking and booking confirmation. On confirmation, the client sees "Add to Google Calendar" (deep-link) and "Add to Apple / Outlook Calendar" (.ics download) buttons — do not label these as ".ics" to the user. Client phone is collected as mandatory; email is optional.

### `sw.js` (service worker)
Handles Web Push `push` events, app-shell caching (cache name `tb-shell-v5`), and offline fallback. On notification click, navigates to `data.url` from the push payload if present; falls back to `/access.html`. The send functions (`send-reminders.js`, `send-follow-ups.js`, `send-todo-reminders.js`) look up the owner's tier and include a tier-specific deep-link URL in every push payload. `APP_SHELL_FILES` caches all three app pages plus all client scripts — bump the cache name (`tb-shell-vN`, currently `tb-shell-v5`) whenever cached static files change.

### Native app (Capacitor)
`capacitor.config.json` configures a Capacitor 7 wrapper (`appId: "com.textboss.app"`, `webDir: "www"`). The `server.url` field points to the live Netlify deployment — update it before building. Push notifications use OneSignal's native SDK on-device (not the web VAPID stack). The `www/` directory is a build artefact produced by `npm run build:app` (`scripts/build-www.js`) — it is gitignored, regenerated on demand, and not used by the Netlify/browser deployment. Run `npm run cap:sync` after `build:app` to push the bundle into the native iOS/Android projects.

### Testing pattern
Tests use Node's built-in `assert/strict` — no test framework. Each test file is a self-executing async function. `npm test` discovers and runs all `tests/*.test.js`. Runtime-integration tests (`*-runtime.test.js`) require real env vars and are for manual runs only.

## Project rules
- Tiers must stay strictly separated — Core/Pro/Black behavior must not bleed across
- Denied users must never receive business advice (no Anthropic call without a valid, active entitlement)
- All backend logic goes in `netlify/functions/`; no secrets in committed code
- `index.html`, `core.html`, `pro.html`, and `black.html` are marketing/landing pages — keep them separate from the subscriber app pages (`app-core.html`, `app-pro.html`, `app-black.html`). Do not confuse the two sets
- Services are stored in the relational `services` table — do not use the old `services` JSONB column on `business_profiles`
- `business-profile.js` is Pro/Black only — Core has no profile or scheduling features
