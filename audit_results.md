# TextBoss Full-Stack Audit Report

**Date**: 2026-04-20
**Auditor**: Full-Stack Audit Agent
**Scope**: Codebase feature mapping vs. marketing copy accuracy (index.html, core.html, pro.html, black.html)

---

## Executive Summary

The TextBoss codebase is a well-structured three-tier SaaS product with a substantial feature set. Marketing copy is generally accurate and well-written, but several significant implemented features are entirely absent from marketing: the To-Do system (all tiers), AI-powered follow-up sequencing (Pro/Black), public client-facing booking page (`book.html`), Web Push notifications, iCal import (as distinct from iCal export), and to-do reminders. Persistent scheduling memory is misrepresented — it is a **Black-exclusive** feature in the code, but `index.html` and the comparison table attribute it to both Pro and Black. This is the most material inaccuracy: Pro subscribers will expect persistent AI memory and will not get it. Two tier-limit facts stated in marketing copy are correct. No false claims of major severity were found beyond the memory misattribution. Proofreading is generally strong; a few clarity and specificity gaps are noted.

---

## 1. Feature Inventory

### CORE

- **AI messaging assistant** — tier-gated, drafts professional send-ready messages for everyday client communication (payment reminders, follow-ups, scope clarification, polite declines). 400 max output tokens, 4,000 char input limit. `netlify/functions/chat.js`, `_lib/tier-policy.js`
- **10 saved conversation threads** — thread persistence with AI-generated titles. Old threads auto-pruned beyond limit. `chat.js`, `netlify/functions/threads.js`
- **Named, browsable thread history** — threads listed by title and timestamp in sidebar. `app-client.js`
- **Tier-specific prompt library** — curated message templates rendered in the Prompts tab from `core_subscriber_prompts.html`. `prompts-client.js`
- **To-Do list** — create, mark done, toggle urgent, delete tasks. No reminders at Core tier. `netlify/functions/todos.js`, `todos-client.js`, `app-core.html`
- **Notes (localStorage)** — collapsible freeform notes stored locally. `todos-client.js`
- **Settings tab** — view account email, upload profile photo (shown on booking page if upgraded). `settings-client.js`
- **Auth flow** — email-based access with HMAC-signed session cookie. `verify-email.js`, `session-verify.js`, `_lib/session.js`
- **Password auth** — PBKDF2-based password with Resend email reset flow. `forgot-password.js`, `reset-password.js`, `set-password.js`
- **Stripe subscription lifecycle** — checkout, update, and cancellation handled via webhook. `stripe-webhook.js`
- **Newsletter opt-in (Beehiiv)** — email subscription on landing page. `subscribe.js`

### PRO (includes Core features)

- **AI messaging assistant** — higher tier; handles structured boundary enforcement, scope creep sequences, message sequencing (2–3 messages), retainer resets. 600 max output tokens, 6,000 char input limit. `_lib/tier-policy.js`
- **50 saved conversation threads** — same auto-pruning mechanism, higher cap. `chat.js`
- **AI Appointment Scheduler (conversational)** — chat-based scheduling with 7 tools: `resolve_service`, `find_available_slots`, `list_appointments`, `book_appointment`, `cancel_appointment`, `reschedule_appointment`, `add_busy_block`. `schedule-chat.js`
- **Working hours configuration** — per-day availability via onboarding wizard and settings. `business-profile.js`, `scheduler-client.js`
- **Services management** — CRUD for relational services table (title, duration, price, buffer time). `services.js`, `scheduler-client.js`
- **Business profile** — occupation, business name, owner name, phone, website, ABN, city, avatar, booking slug. `business-profile.js`
- **Busy blocks (max 200)** — manually block calendar time. `busy-blocks.js`
- **iCal import** — parse and import `.ics` files as busy blocks; 60-day import window; undo by batch ID. `ical-import.js`, `scheduler-client.js`
- **Per-appointment calendar links** — Google Calendar deep-link and Apple/Outlook `.ics` download after each booking. `scheduler-client.js`
- **Follow-up sequencing** — AI drafts a 2-message (Day 7 check-in + Day 14 rebooking) follow-up sequence per completed service job. Max 10 active jobs. Scheduled delivery tracked. `follow-up.js`, `followup-client.js`, `send-follow-ups.js`
- **Web Push notifications** — appointment reminders (24 h before, hourly check), follow-up daily digest (9am UTC), to-do reminders. `push-subscribe.js`, `vapid-key.js`, `send-reminders.js`, `send-follow-ups.js`, `send-todo-reminders.js`, `sw.js`
- **Public booking link** — shareable `book.html?owner=<slug>` page; AI handles client-side booking without owner involvement. Sends SMS (Mobile Message) + Resend email to both owner and client on confirmation. `public-booking.js`, `business-profile.js`
- **To-Do list with reminders** — same as Core plus `reminder_at` timestamp; Web Push + Resend email fallback on due. `todos.js`, `send-todo-reminders.js`
- **Scheduler badge** — shows count of upcoming confirmed appointments on the Scheduler tab button. `scheduler-client.js`, `app-pro.html`
- **4-step onboarding wizard** — collects personal/business info, occupation, services+pricing, buffer times; marks `onboarding_complete` on profile. `scheduler-client.js`

### BLACK (includes Pro features)

- **AI messaging assistant** — highest restraint tier; non-admission language, screenshot-safe phrasing, containment-over-persuasion, finality scripts, no fault concession. 700 max output tokens, 8,000 char input limit. `_lib/tier-policy.js`
- **Unlimited conversation threads** — no pruning. `chat.js`, `_lib/tier-policy.js`
- **Persistent AI scheduling memory** — `scheduler_memory` table stores a free-text memory blob per owner; injected as `=== MEMORY ===` into every scheduling prompt; `remember` AI tool writes updates back. **Black-exclusive** — Pro does NOT have this. `schedule-chat.js`
- **Busy blocks (unlimited)** — no cap vs. Pro's 200. `busy-blocks.js` (`BLOCK_LIMITS = { Pro: 200, Black: Infinity }`)
- **iCal import (90-day window)** — wider import window than Pro (60 days); higher block limit (500 vs 200). `ical-import.js`
- **Follow-up sequencing (4 messages, unlimited jobs)** — Black gets Day 3 thank-you, Day 7 review, Day 14 rebooking, Day 30 long-term check-in. Unlimited active jobs vs. Pro's 10. `_lib/tier-policy.js`, `follow-up.js`
- **Bulk .ics export** — export all confirmed appointments as a single `.ics` file. `scheduler-client.js` (`enableIcalExport: true` in `app-black.html`)

### CROSS-TIER / INFRASTRUCTURE

- **Session cookie auth (HMAC, 30-day TTL)** — `_lib/session.js`
- **Three-way entitlement check** — session + Supabase re-fetch + tier match on every authenticated request. All functions.
- **OpenAI Responses API** — `_lib/openai.js`; `gpt-4o` (configurable via `OPENAI_MODEL`)
- **Stripe webhook** — handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. `stripe-webhook.js`
- **SMS notifications** — Mobile Message API; booking confirmations sent to owner and client phone. `_lib/sms.js`, `public-booking.js`
- **Email notifications (Resend)** — booking confirmations to owner + client; password reset; to-do reminders. `public-booking.js`, `forgot-password.js`, `send-todo-reminders.js`
- **Service worker + app-shell caching** — offline fallback; push notification routing to tier-specific app page. `sw.js`
- **Scheduled functions** — send-reminders (hourly), send-follow-ups (daily 9am UTC), send-todo-reminders (every 15 min). `netlify.toml`
- **Supabase** — all data persistence; service role key with function-level access control. `_lib/supabase.js`

---

## 2. Marketing Claims Extracted

### index.html (main landing page)

**Hero / positioning:**
- "Text Boss replaces improvisation with precision — structured language for known patterns, tier-gated AI for the rest, and a scheduling system that books without the back-and-forth."
- "Pro/Black: AI that books appointments, confirms them, and documents what happens next."

**Scheduler spotlight section:**
- "Conversational booking — clients respond in plain language. The AI resolves it."
- "Persistent memory — nothing is repeated. Context carries across sessions." (attributed to Pro + Black together)
- "Confirmation + reminders — no-shows become harder to claim as accidents."
- "Rebooking flows — cancellations and reschedules handled cleanly. Full records kept."
- "Tier-calibrated tone — Pro is firm. Black is the kind of precise that holds up in disputes."

**Comparison table:**
- Core: 10 conversation threads, tier-gated AI assistant
- Pro: AI Appointment Scheduler ✓, Persistent scheduling memory ✓, Add to Calendar ✓, 50 threads
- Black: All Pro features + Bulk .ics export ✓, Legally defensible scheduling language ✓, No-show containment scripts ✓, Unlimited threads

**Pricing section — Pro includes:**
- Everything in Core, Pro-tier AI, Scope creep ladders, Persistent objection sequences, 50 threads, AI Appointment Scheduler, Persistent scheduling memory, Booking confirmations + push reminders, Add to Calendar (Google, Outlook, Apple)

**Pricing section — Black includes:**
- Everything in Pro, Black-tier AI, Dispute/chargeback restraint, Hostility containment, Unlimited threads, Legally defensible scheduling, No-show containment scripts, Bulk .ics export

**FAQ:**
- "Does the AI Scheduler integrate with my calendar? Yes. Every confirmed appointment includes one-click 'Add to Calendar' links... Black members also get bulk .ics export."
- "What happens if a client no-shows? Black members get no-show containment scripts... Pro members get standard rebooking flows."

---

### core.html

- Payment reminders, follow-up after silence, scope clarification, declining out-of-scope requests, send-ready output
- **"10 saved conversation threads"** — named, browsable chat history
- Price: $29 AUD/mo

---

### pro.html

- "Everything in Core, plus pattern control and AI scheduling."
- Message progression (soft → firm → close)
- Boundary and pricing responses
- Decision compression language
- Conversation stabilisation
- **"Follow-up sequencing"** — what to send when there's no response (described as the messaging AI's follow-up, not the dedicated AI follow-up module)
- **"AI Appointment Scheduler"** — "Set your availability once. The AI proposes slots, confirms bookings, and handles rescheduling — with one-click Add to Calendar for Google, Outlook, and Apple."
- **"50 saved conversation threads"** — with AI-generated titles
- Price: $79 AUD/mo

---

### black.html

- "Everything in Core + Pro, plus exposure control."
- AI Appointment Scheduler — "one-click calendar links and bulk .ics export. Every confirmation is drafted to be screenshot-safe and unambiguous."
- Hard resets, conflict enders, non-admission language, silence discipline, screenshot-safe language
- **"Unlimited conversation threads"** — named, browsable, unlimited
- Price: $199 AUD/mo

---

## 3. Feature Match Table

### Code Features → Marketing Coverage

| Feature (Code) | Mentioned in Marketing? | Marketing Page(s) | Notes |
|---|---|---|---|
| AI messaging assistant (Core, 400 tokens) | ✅ | index, core | Accurately described |
| AI messaging assistant (Pro, 600 tokens, sequences) | ✅ | index, pro | Accurately described |
| AI messaging assistant (Black, 700 tokens, containment) | ✅ | index, black | Accurately described |
| 10 conversation threads (Core) | ✅ | index, core | Accurate |
| 50 conversation threads (Pro) | ✅ | index, pro | Accurate |
| Unlimited threads (Black) | ✅ | index, black | Accurate |
| AI Appointment Scheduler (Pro/Black) | ✅ | index, pro, black | Accurate |
| Per-appointment Add to Calendar links | ✅ | index, pro, black | Accurate |
| Bulk .ics export (Black only) | ✅ | index, black | Accurate |
| **Persistent AI scheduling memory (Black ONLY)** | ⚠️ Misattributed | index | Listed as "Pro + Black" in index.html table and pricing card — **code confirms Black-only** |
| Follow-up sequencing module (Pro: 2 msgs, Black: 4 msgs) | ❌ Not mentioned | None | Entirely absent from all marketing pages |
| Public client booking page (book.html) | ❌ Not mentioned | None | Client-facing booking URL not referenced anywhere in marketing |
| Web Push notifications (appointment reminders) | ⚠️ Partial | index only | "Booking confirmations + push reminders" in Pro pricing card; no detail on what triggers them |
| Web Push for follow-ups (daily digest) | ❌ Not mentioned | None | Send-follow-ups.js delivers push; not in marketing |
| Web Push for to-dos | ❌ Not mentioned | None | send-todo-reminders.js delivers push + email; not in marketing |
| iCal import (Pro: 60-day, Black: 90-day) | ❌ Not mentioned | None | Distinct from export; not mentioned anywhere in marketing |
| Busy blocks — Pro: max 200, Black: unlimited | ❌ Not mentioned | None | Limit differential not advertised anywhere |
| To-Do list (all tiers) | ❌ Not mentioned | None | Fully functional feature on all tiers; absent from all marketing |
| Notes tab (localStorage, all tiers) | ❌ Not mentioned | None | Collapsible freeform notes; absent from all marketing |
| To-Do reminders (Pro/Black, Web Push + email) | ❌ Not mentioned | None | Scheduled every 15 min; not mentioned anywhere |
| Scheduler badge (upcoming count) | ❌ Not mentioned | None | Minor UI detail; low priority |
| 4-step onboarding wizard | ❌ Not mentioned | None | Not marketing-relevant per se; onboarding friction reduction could be mentioned |
| Business profile (name, phone, city, ABN, website) | ❌ Not mentioned | None | Part of public booking page but not called out |
| SMS booking notifications (owner + client) | ❌ Not mentioned | None | Mobile Message API; owner and client receive SMS on booking |
| Resend email booking confirmation (owner + client) | ❌ Not mentioned | None | Email on booking; not mentioned |
| Follow-up module — Black gets 4 messages vs Pro 2 | ❌ Not mentioned | None | Meaningful differentiation |
| Follow-up module — Black unlimited jobs vs Pro max 10 | ❌ Not mentioned | None | Meaningful limit differentiation |
| iCal import "undo" (delete by batch_id) | ❌ Not mentioned | None | Minor UX detail |
| Password auth (PBKDF2, email reset) | ✅ Implicit | access.html | Not a marketing feature; correctly not in marketing |
| Prompts tab / template library | ✅ | index, tier pages | Referenced as "categorised templates" |
| Stripe payment | ✅ | All pages | "Secure checkout via Stripe" |

---

### Marketing Claims → Code Verification

| Marketing Claim | Backed by Code? | Source File | Notes |
|---|---|---|---|
| "10 saved conversation threads" (Core) | ✅ | `_lib/tier-policy.js` `THREAD_LIMITS.Core = 10` | Accurate |
| "50 saved conversation threads" (Pro) | ✅ | `_lib/tier-policy.js` `THREAD_LIMITS.Pro = 50` | Accurate |
| "Unlimited conversation threads" (Black) | ✅ | `_lib/tier-policy.js` `THREAD_LIMITS.Black = Infinity` | Accurate |
| "AI proposes slots, confirms bookings, handles rescheduling" | ✅ | `schedule-chat.js` tools | Accurate |
| "One-click Add to Calendar for Google, Outlook, and Apple" | ✅ | `scheduler-client.js` — Google deep-link + `.ics` download | Accurate |
| "Bulk .ics export" (Black) | ✅ | `scheduler-client.js` `bindIcalExport()`, `enableIcalExport: true` in `app-black.html` | Accurate |
| "Persistent scheduling memory" listed as Pro + Black feature | ❌ INCORRECT | `schedule-chat.js` line 492: `isBlack && getMemory` — memory only loaded for Black | **Black-only in code** |
| "AI retains context across sessions" (Pro) | ❌ INCORRECT for Pro | `schedule-chat.js` | Pro gets NO persistent memory; only conversation threads |
| "Booking confirmations + push reminders" (Pro pricing card) | ✅ Partial | `send-reminders.js`, `push-subscribe.js` | Real, but push is an opt-in. No mention of SMS component |
| "No-show containment scripts" (Black) | ✅ | `_lib/tier-policy.js` Black scheduling instructions | Drafts factual, non-escalating no-show documentation |
| "$29 AUD/mo Core" | ✅ | `stripe-webhook.js`, `STRIPE_PRICE_CORE` env var | Plausible (Stripe price IDs match buy links) |
| "$79 AUD/mo Pro" | ✅ | Stripe checkout URL | Consistent across pages |
| "$199 AUD/mo Black" | ✅ | Stripe checkout URL | Consistent across pages |
| "Non-admission language" (Black) | ✅ | `_lib/tier-policy.js` Black instructions: "Non-admission language is mandatory" | Accurate |
| "Screenshot-safe language" (Black) | ✅ | `_lib/tier-policy.js` Black instructions: "Write as if a third party — a lawyer, a platform reviewer" | Accurate |
| "AI Appointment Scheduler... documents no-shows" (black.html) | ✅ Partial | `schedule-chat.js` Black instructions | The AI is instructed to document no-shows factually |
| "Follow-up sequencing" (pro.html) | ⚠️ Ambiguous | `_lib/tier-policy.js` Pro messaging system prompt | The pro.html text describes the messaging AI doing follow-ups, not the dedicated follow-up module. Both exist but aren't clearly differentiated |
| "15 word-for-word client messages" free playbook (index.html) | ⚠️ Unverified | `subscribe.js` → Beehiiv | subscribe.js adds to Beehiiv newsletter; whether Beehiiv automation sends the playbook is outside codebase scope |

---

## 4. Forgotten Features (Add to Marketing Immediately)

### Priority 1 — HIGH COMMERCIAL VALUE

**1. AI Follow-Up Sequencing (Pro and Black)**

The follow-up module (`follow-up.js`, `followup-client.js`) is a substantial Pro/Black feature. After completing a service, the owner enters the client name, service performed, and date. The AI drafts a timed sequence of personalised follow-up messages and schedules them automatically: Pro gets 2 messages (Day 7 check-in + review request, Day 14 rebooking nudge), Black gets 4 messages (Day 3 thank-you, Day 7 review, Day 14 rebooking, Day 30 long-term check-in). Owners review and mark as sent or skipped.

This feature is absent from all four marketing pages. The pro.html page has a feature called "Follow-up sequencing" but describes it as the messaging AI's general follow-up capability — not the dedicated AI-generated, date-scheduled client follow-up system.

Suggested copy for pro.html feature card:
> **AI Follow-Up Sequences** — After you complete a service, enter the client name and job. The AI drafts 2 timed messages — a Day 7 check-in with a review request and a Day 14 rebooking nudge — personalised by client and service. You approve and send. No chasing. No forgotten clients.

Suggested copy for black.html feature card:
> **Extended Follow-Up Sequences (4 messages)** — Black members get a 4-message sequence: Day 3 quality check, Day 7 review request, Day 14 rebooking prompt, and Day 30 relationship maintenance. Unlimited active campaigns. Precise, non-desperate, intentional.

**2. Public Client Booking Page (`book.html`)**

Pro and Black subscribers receive a shareable booking URL (`textboss.com.au/book.html?owner=<slug>`). Clients visit this page, select a service from the owner's configured menu, and are guided through booking by an AI assistant that checks availability in real time. On confirmation: the client's phone number is captured (mandatory), SMS confirmations go to both owner and client, and email confirmations are sent via Resend. The client receives Add to Calendar buttons (Google and Apple/Outlook). The owner receives a Web Push notification with a deep-link back to the app.

This is not mentioned anywhere in marketing despite being a major differentiator. `settings-client.js` reveals the live URL is `textboss.com.au/book.html?owner=<slug>`.

Suggested copy for pro.html feature card:
> **Public Booking Link** — Share one link on your website, Instagram bio, or email signature. Clients tap it, pick a service, and book themselves — no back-and-forth. They get an SMS and email confirmation. You get a push notification and a confirmed appointment. The AI does the rest.

**3. SMS Booking Notifications**

When a client books via `book.html`, both the owner and the client receive an SMS confirmation via Mobile Message API (`_lib/sms.js`). The owner also receives a Resend email and a Web Push notification. This is a concrete, reassuring capability that is not mentioned anywhere in marketing.

Suggested addition to existing Pro/Black scheduler feature bullets:
> "SMS confirmation sent to you and your client the moment a booking is made."

---

### Priority 2 — MEDIUM COMMERCIAL VALUE

**4. To-Do List (All Tiers)**

A full CRUD to-do list is available on Core, Pro, and Black. It includes urgency flags, done/not-done toggling, and a collapsible Notes section (local storage). Pro and Black additionally support `reminder_at` timestamps with Web Push and email reminders delivered by `send-todo-reminders.js` (runs every 15 minutes).

Core users get a useful organiser tool that is never mentioned. Pro/Black users get a task manager with timed reminders that is never mentioned.

Suggested addition to Core feature list:
> **To-Do list** — Manage tasks and follow-ups without switching apps. Mark urgent, mark done, keep freeform notes alongside your client conversations.

Suggested addition for Pro/Black:
> **To-Do reminders** — Set a time on any task and get a push notification (and email fallback) when it's due. Runs every 15 minutes.

**5. iCal Import (Pro and Black)**

Pro and Black users can upload a `.ics` file from Google Calendar, Apple Calendar, or Outlook to automatically populate busy blocks. Pro gets a 60-day import window; Black gets 90 days. Imports can be undone batch-by-batch from the UI. This feature exists entirely in `ical-import.js` but is never mentioned in marketing (the comparison table in `index.html` mentions "bulk .ics export" but says nothing about import).

Suggested addition:
> **Calendar Import (.ics)** — Upload your Google Calendar, Outlook, or Apple Calendar export and your existing schedule is blocked off automatically. Pro: 60-day window. Black: 90-day window. One-click undo if you change your mind.

**6. Busy Block Tier Limits**

Marketing says nothing about the cap on busy blocks. Pro is capped at 200, Black is unlimited. For high-volume operators, this is a meaningful differentiator. The comparison table could add a row:

> **Calendar busy blocks** — Pro: up to 200. Black: unlimited.

**7. Follow-Up Module Tier Differentiation**

The follow-up module works differently at Pro vs Black (2 vs 4 messages; 10 active jobs vs unlimited). None of this is currently visible in marketing. If the follow-up module is added to marketing copy (Priority 1), these limits should be clearly stated.

---

### Priority 3 — LOWER COMMERCIAL VALUE

**8. Scheduler Badge**
The Scheduler tab in app-pro and app-black shows a live count of upcoming confirmed appointments as a badge. Minor UX detail worth a brief mention in scheduler copy.

**9. 4-Step Onboarding Wizard**
The wizard smooths initial setup for new Pro/Black subscribers. Not a marketing feature per se, but mentioning "guided setup" could reduce friction for purchase hesitancy.

---

## 5. False or Unverified Claims (Fix Immediately)

### Severity: HIGH

**Claim: "Persistent scheduling memory" is listed as a Pro + Black feature**

Location: `index.html` — comparison table row, Pro pricing card (`price-includes` list), and "What you get" feature grid (badge says "Pro + Black").

Reality in code (`schedule-chat.js`, line 492):
```
isBlack && getMemory ? getMemory(session.email) : Promise.resolve(null)
```
And line 508:
```
const tools = isBlack ? [...SCHEDULING_TOOLS, REMEMBER_TOOL] : SCHEDULING_TOOLS;
```

The `remember` tool and memory injection are strictly Black-only. Pro gets no persistent memory; it only gets session-scoped conversation threading (threads table). The `=== MEMORY ===` block is never injected for Pro.

**Impact**: A Pro subscriber who purchased based on "persistent scheduling memory" will open the scheduler and find the AI does not retain anything between sessions. This is a material misrepresentation that could drive refund requests or chargebacks — the exact thing the product is designed to prevent.

**Required fix**: Remove "Persistent scheduling memory" from the Pro pricing card and from the "Pro + Black" badge in the comparison table. Move it to Black-only in the table. Update the "What you get" section to mark this as Black-only. A Pro-specific memory description would be: "Conversation history within each thread is preserved; the scheduling AI starts fresh per session."

---

### Severity: MEDIUM

**Claim: black.html states "bulk .ics export" in the AI Appointment Scheduler feature description**

Location: `black.html` feature card: "Set your availability. The AI proposes slots, confirms bookings, and documents no-shows — with one-click calendar links and bulk .ics export."

The code confirms bulk .ics export IS Black-only (`app-black.html` passes `enableIcalExport: true` to `initScheduler`, `app-pro.html` does not). This claim is accurate for Black.

However, the same sentence says "one-click calendar links" — these are per-appointment Google and Apple links, which are also available on Pro. The black.html description is acceptable, but slightly misleading by bundling both features as Black-only. No action required; this is cosmetic.

---

### Severity: MEDIUM

**Claim: "15 word-for-word client messages — scope creep, late payments, no-shows, ghosting. Free. Instant delivery." (index.html lead magnet)**

The `subscribe.js` function adds the email to Beehiiv. Whether the Beehiiv automation actually delivers a 15-message playbook is outside the codebase and cannot be verified. If the automation exists in Beehiiv, the claim is valid. If it does not, visitors are entering their email and receiving nothing specific. This should be confirmed against the Beehiiv account.

---

### Severity: LOW

**Claim: "Follow-up sequencing" on pro.html is vague and possibly conflates two distinct systems**

The pro.html feature card "Follow-up sequencing — What to send next when there's no response. No more improvising the chase." describes general follow-up message drafting by the messaging AI, which Core also handles. The dedicated AI follow-up module (timed, client-specific, scheduled by job) is the actual Pro-exclusive feature. The current copy could describe Core capability and does not convey the distinct value of the follow-up module.

---

## 6. Proofreading Suggestions

### index.html

**Section 04 (Scheduler Spotlight) — "Persistent memory" bullet:**
> Original: "Persistent memory — nothing is repeated. Context carries across sessions."
> Problem: Attributed to Pro+Black in context, but only Black has it. Misleading.
> Suggested revision: "Persistent memory (Black) — standing preferences and notes saved between sessions. The AI knows your schedule without being told again."

**Section 05 (What you get) — Pro+Black badge on "Persistent scheduling memory":**
> Original: `<span class="tier-badge pro">Pro + Black</span> Persistent scheduling memory`
> Fix: Change badge to `<span class="tier-badge black">Black only</span>`

**Section 06 (Comparison table) — "Persistent scheduling memory" row:**
> Original: Pro ✓, Black ✓
> Fix: Pro —, Black ✓

**Section 09 (FAQ) — "How does the AI Appointment Scheduler work?":**
> "It's a persistent conversational AI."
> Problem: "Persistent" implies memory retention. For Pro, it is not persistent in the memory sense — only in the thread sense.
> Suggested revision: "It's a conversational AI. It finds a time, locks the booking, sends confirmation, and handles changes — without you in the back-and-forth. Available to Pro and Black members. Black members also get persistent AI memory that retains your scheduling preferences and client notes across sessions."

**Pro pricing card (`<span class="pi-dot cyan">` items) — no visible issue; HTML is clean.**

---

### pro.html

**Feature card "Follow-up sequencing":**
> Original: "What to send next when there's no response. No more improvising the chase."
> Problem: Describes the messaging AI's generic follow-up drafting, not the dedicated AI-powered client follow-up module. Both exist. The current copy is not wrong, but it misses the Pro-exclusive follow-up feature entirely.
> Suggested revision: "AI Follow-Up Sequences — Log a completed service and the AI drafts a timed 2-message follow-up sequence, personalised to the client and job. Day 7 check-in + review request. Day 14 rebooking nudge. You approve and send — no chasing, no blank page."

**"Why you benefit" card:**
> "a built-in AI scheduling assistant that books and manages client appointments alongside your communication."
> Suggestion: Add "including a shareable booking link your clients can use to self-book." This surfaces the public booking page.

---

### black.html

**Feature card "AI Appointment Scheduler":**
> Original: "Set your availability. The AI proposes slots, confirms bookings, and documents no-shows — with one-click calendar links and bulk .ics export. Every confirmation is drafted to be screenshot-safe and unambiguous."
> No errors. Strong copy. Consider adding: "Clients book themselves via your public booking link — no back-and-forth required."

**Missing features section:** Black has no mention of: extended follow-up sequences (4 messages), unlimited follow-up jobs, public booking link, SMS notifications. These are substantive omissions for the highest-value tier.

---

### core.html

**Feature list — Missing:** To-Do list and Notes features are absent. Core users have access to these and may find them useful.

Suggested addition:
> **To-Do list + Notes** — Manage tasks and track notes alongside your client conversations. Mark urgent, mark done, keep freeform notes for context.

**"What it does" card:**
> "Scheduling confirmations, payment reminders, scope clarifications, follow-ups, and polite declines"
> Note: Core does NOT have scheduling (no access to schedule-chat.js). "Scheduling confirmations" means drafting a message that confirms a schedule — the AI writes the message, not manages a calendar. This is technically accurate but could confuse visitors who expect a calendar. It is defensible but worth monitoring for support confusion.

---

## 7. Technical Recommendations

### 1. Fix "Persistent scheduling memory" attribution immediately

File: `/c/Users/ADMIN/Desktop/tb/textboss/index.html`

Three locations require changes:
- Line ~1117: Change `<span class="tier-badge pro">Pro + Black</span>` to `<span class="tier-badge black">Black only</span>` on the "Persistent scheduling memory" feature card.
- Line ~1179: Change the comparison table row for "Persistent scheduling memory" — remove the Pro `✓`, set Pro to `—`.
- Line ~1292: Remove "Persistent scheduling memory" from the Pro pricing card `price-includes` list.

**Note**: Do not change the description — only the tier attribution. The `schedule-chat.js` code is correct; the marketing needs to align with it.

### 2. Add follow-up module to marketing

The follow-up module is fully implemented (`follow-up.js`, `followup-client.js`, `send-follow-ups.js`) and scheduled for daily delivery. It is a strong Pro/Black differentiator that is currently invisible to prospective buyers. Add feature cards to `pro.html` and `black.html`, and add a row to the comparison table in `index.html`.

### 3. Surface the public booking link in marketing

`public-booking.js` is production-ready. The booking page (`book.html`) is fully functional. The settings tab already contains the "Generate booking link" UI. Marketing copy mentioning "shareable booking link" would drive both conversions and active Pro/Black feature usage.

### 4. Verify Beehiiv playbook automation

The `subscribe.js` function correctly calls Beehiiv, but whether the 15-message playbook automation is configured in Beehiiv is unverifiable from the codebase. Confirm the Beehiiv automation exists before the landing page drives significant volume to it.

### 5. To-do reminders tier gate is backend-only — confirm UI reflects this

`todos.js` correctly gates `reminder_at` to Pro/Black: `const canRemind = tier === "Pro" || tier === "Black"`. The `todos-client.js` reads `canRemind` from a data attribute. Verify `app-core.html` passes `tier: 'Core'` and that the reminder input is hidden or disabled for Core in the rendered UI.

### 6. iCal import window discrepancy in comments vs. busy-blocks cap

`ical-import.js` header comment states "Black: 90-day import window, 500 total busy blocks". However, `busy-blocks.js` sets `BLOCK_LIMITS = { Pro: 200, Black: Infinity }` (unlimited). The `ical-import.js` hardcodes `BLOCK_LIMITS = { Pro: 200, Black: 500 }`. These two files use different Black limits. This is a minor inconsistency: the direct busy-blocks endpoint allows unlimited for Black, but iCal import caps Black at 500. Decide the intended behavior and align both files.

### 7. Thread limit enforcement — Core pruning is aggressive

`chat.js` auto-deletes the oldest threads when a user exceeds their tier limit. For Core users (limit 10), the 11th thread causes the oldest to be permanently deleted. Marketing says "10 saved conversation threads" which implies a rolling cap. Consider a more explicit UI warning before deletion occurs, and ensure `app-core.html` shows thread count status.

---

## 8. Appendix: Tech Stack Summary

### Runtime Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@supabase/supabase-js` | ^2.95.3 | Database client (PostgreSQL via Supabase) |
| `resend` | ^6.12.0 | Transactional email (booking confirmations, password reset, to-do reminders) |
| `stripe` | ^20.3.1 | Payment processing and subscription lifecycle |
| `web-push` | ^3.6.7 | VAPID-signed Web Push notifications |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `netlify-cli` | ^24.9.0 | Local development server |
| `sharp` | ^0.34.5 | Image processing (avatar uploads) |

### Scheduled Functions (netlify.toml)

| Function | Schedule | Purpose |
|---|---|---|
| `send-reminders` | Hourly (`0 * * * *`) | Web Push appointment reminders 24h before |
| `send-follow-ups` | Daily 9am UTC (`0 9 * * *`) | Notify owners of due follow-up messages |
| `send-todo-reminders` | Every 15 min (`*/15 * * * *`) | Web Push + email for due to-do items |

### External Services

| Service | Integration File | Purpose |
|---|---|---|
| OpenAI (Responses API) | `_lib/openai.js` | AI message drafting and scheduling |
| Stripe | `stripe-webhook.js` | Subscription management |
| Supabase | `_lib/supabase.js` | All persistent data storage |
| Resend | `public-booking.js`, `forgot-password.js`, `send-todo-reminders.js` | Transactional email |
| Mobile Message | `_lib/sms.js` | SMS for booking confirmations (AU) |
| Beehiiv | `subscribe.js` | Newsletter / lead magnet delivery |
| Web Push (VAPID) | `push-subscribe.js`, `vapid-key.js` | Browser push notifications |

### Supabase Tables

| Table | Key Purpose |
|---|---|
| `entitlements` | Stripe-synced subscription state; gating source |
| `threads` / `messages` | Chat thread persistence |
| `availability` | Weekly working hours per owner |
| `appointments` | Booked appointments with reminder tracking |
| `business_profiles` | Scheduler config, avatar, booking slug |
| `push_subscriptions` | Web Push endpoint storage |
| `public_booking_links` | Slug → owner email mapping |
| `follow_up_jobs` | AI follow-up campaigns |
| `busy_blocks` | Calendar blocks (iCal import + manual + AI) |
| `users` | PBKDF2 password credentials |
| `services` | Relational service catalogue (title, duration, price, buffer) |
| `scheduler_memory` | Black tier AI persistent memory |
| `todos` | To-do items with urgency and reminder fields |

### Environment Variables Required

`TEXTBOSS_SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CORE`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BLACK`, `RESEND_API_KEY`, `MOBILEMESSAGE_USERNAME`, `MOBILEMESSAGE_PASSWORD`, `MOBILEMESSAGE_SENDER`, `REMINDERS_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `BEEHIIV_PUBLICATION_ID`, `BEEHIIV_API_KEY`
