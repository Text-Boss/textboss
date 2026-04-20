---
name: Booking tier enforcement system
description: How TextBoss enforces Pro/Black-only scheduling access, the shared booking-auth middleware, and Black tier premium UI additions
type: project
---

Booking tier enforcement is implemented via a shared middleware at `netlify/functions/_lib/booking-auth.js`.

All scheduling endpoints must use `verifyBookingAccess(event, deps)` which:
1. Verifies the HMAC-signed session cookie (never trusts client-side tier)
2. Re-reads Supabase entitlements on every request to catch lapsed subscriptions
3. Cross-checks cookie tier against DB tier — mismatch returns 403 `invalid_tier`
4. Gates on `SCHEDULING_TIERS = {"Pro", "Black"}` — Core returns 403 `tier_not_entitled`

**Why:** Per CLAUDE.md, tiers must stay strictly separated. The pattern in appointments.js was previously inlined; now it's centralised so new scheduling endpoints get the same checks for free.

**How to apply:** Any new scheduling Netlify Function should import from `_lib/booking-auth.js` instead of reimplementing the verify flow.

Appointment history limits by tier (in `booking-auth.js`):
- Pro: 5 past appointments
- Black: 10 past appointments

`appointments.js` GET response now includes `history_limit` and `is_black_tier` so `scheduler-client.js` can adjust without a separate request.

**Black tier UI additions in `app-black.html`:**
- Gold/brass CSS custom properties (`--gold: #B5A642`) scoped to `:root`
- All gold overrides are scoped to `#panel-scheduler` so the violet messaging UI is unaffected
- A `black-greeting` bar inside the scheduler panel shows personalised email (local part only)
- The email is sourced from `window.__tbSession` set by `app-client.js` after session-verify

**Core upsell in `app-core.html`:**
- A locked Scheduler tab (lock emoji, 55% opacity) opens a `.upsell-panel` with `.upsell-card`
- Lists 5 feature bullets: AI scheduler, public booking link, push reminders, iCal import, follow-up sequences
- CTA links to `/pro.html#pricing`
- No JS, no network call — purely presentational
