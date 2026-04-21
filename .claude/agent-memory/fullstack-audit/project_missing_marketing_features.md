---
name: Features Built But Not in Marketing
description: Substantial features absent from all marketing pages as of 2026-04-20 audit
type: project
---

As of the 2026-04-20 audit, the following fully-implemented features are not mentioned in any marketing page (index.html, core.html, pro.html, black.html):

1. **AI Follow-Up Sequencing** (Pro/Black) — `follow-up.js`, `followup-client.js`, `send-follow-ups.js`. Pro: 2-message timed sequence (Day 7 + Day 14), max 10 jobs. Black: 4-message (Day 3, 7, 14, 30), unlimited jobs. Highest-value missing marketing claim.

2. **Public Client Booking Page** (`book.html`) — Pro/Black. Shareable URL `textboss.com.au/book.html?owner=<slug>`. AI-assisted client self-booking. Sends SMS + email to owner and client. Owner gets Web Push with deep-link. `public-booking.js`, `settings-client.js`.

3. **SMS Booking Notifications** — Mobile Message API. Both owner and client get SMS on booking. `_lib/sms.js`.

4. **To-Do List** — All tiers. Full CRUD. Urgency flag. Notes (localStorage). Pro/Black get `reminder_at` with Web Push + email delivery. `todos.js`, `send-todo-reminders.js`.

5. **iCal Import** — Pro/Black. Parse .ics from Google/Apple/Outlook. Pro: 60-day window. Black: 90-day. Batch undo. `ical-import.js`.

6. **Busy block tier limits** — Pro: max 200. Black: unlimited. `busy-blocks.js`.

7. **Follow-up module differentiation** — Pro: 2 messages, max 10 jobs. Black: 4 messages, unlimited jobs. Not stated anywhere.

**Why:** Likely features built post-launch without marketing update cycle.

**How to apply:** When asked to add/change marketing copy, lead with these omissions as the highest-ROI changes. Do not add copy for features that don't exist — these are real.
