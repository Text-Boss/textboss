---
name: Client Follow-Up System
description: Design decisions for the automated client follow-up feature (Pro/Black) added 2026-04-10
type: project
---

Client follow-up system uses a two-table design (follow_up_jobs + follow_up_messages) with AI-generated message drafts at creation time, not at send time. This avoids OpenAI calls in the scheduled function.

**Why:** Generating drafts upfront means the subscriber can preview and edit before any notification fires. The scheduled function (send-follow-ups.js) is a simple query-and-notify loop with no AI dependency, matching the send-reminders.js pattern exactly.

**How to apply:** Future features that combine AI generation with scheduled delivery should follow this same pattern: generate at user action time, store results, then the scheduled function just reads and notifies. Keeps the cron job simple, testable, and free of external API failures.

Pro tier: 2 follow-up messages (7d, 14d), 10 active job limit. Black tier: 4 messages (3d, 7d, 14d, 30d), unlimited jobs. Both use the same follow-up.js endpoint with tier-gated limits from tier-policy.js.
