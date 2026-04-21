---
name: Tier Gating Patterns
description: How each tier boundary is enforced in the codebase — patterns for future audits
type: project
---

**Scheduling features** (appointments, availability, schedule-chat, busy-blocks, ical-import, business-profile, services, public-booking): `SCHEDULING_TIERS = new Set(["Pro", "Black"])` — Core is denied at function level.

**Follow-up features** (follow-up.js): `FOLLOW_UP_TIERS = new Set(["Pro", "Black"])` — Core denied. Pro: max 10 active jobs. Black: unlimited.

**Persistent AI memory** (schedule-chat.js): `isBlack` check — strictly Black-only. The `remember` tool is only added to `tools` array for Black. Pro does NOT get memory.

**Thread limits**: Core=10, Pro=50, Black=Infinity — enforced by `enforceThreadLimit()` in `chat.js` which auto-prunes oldest threads.

**To-do reminders**: `canRemind = tier === "Pro" || tier === "Black"` — Core can create todos but not set reminders.

**Busy block limits**: Pro=200, Black=Infinity — `BLOCK_LIMITS` in `busy-blocks.js`. Note: `ical-import.js` uses its own BLOCK_LIMITS ({Pro: 200, Black: 500}) which differs from the main endpoint (Black=Infinity). Inconsistency to watch.

**iCal import windows**: Pro=60 days, Black=90 days — `IMPORT_WINDOW_DAYS` in `ical-import.js`.

**Token/input limits**: Core=400 tokens / 4000 chars. Pro=600 tokens / 6000 chars. Black=700 tokens / 8000 chars. `_lib/tier-policy.js`.

**Follow-up message counts**: Pro=2 messages (Day 7+14). Black=4 messages (Day 3, 7, 14, 30). Same file.

**Public booking**: gated to SCHEDULING_TIERS but also requires `booking_slug` on profile. Any Pro/Black user can generate a slug in Settings.
