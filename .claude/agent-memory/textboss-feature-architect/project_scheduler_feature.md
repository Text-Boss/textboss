---
name: AI Scheduler Feature Implementation
description: Design decisions for the conversational appointment scheduler — tool calling pattern, tier separation, thread persistence, and reminder system
type: project
---

The AI Appointment Scheduler was implemented on 2026-04-08 with tool-calling via the OpenAI Responses API.

**Why:** Homepage promises conversational booking with persistent memory, confirmations, reminders, and rebooking. The original schedule-chat.js was a simple pass-through to OpenAI with no tool calling and no appointment CRUD from chat.

**How to apply:**
- schedule-chat.js uses a multi-round tool-calling loop (max 5 rounds) with tools: get_availability, list_appointments, book_appointment, cancel_appointment, reschedule_appointment
- The createSchedulingResponse dep in the runtime handler is a custom OpenAI call (not the shared openai.js client) because it needs to pass `tools` in the request body and parse function_call outputs
- Tier-differentiated scheduling prompts exist in tier-policy.js SCHEDULING_INSTRUCTIONS — Pro is professional/efficient, Black is legally defensible/screenshot-safe
- send-reminders.js is gated by either x-nf-event:schedule header or REMINDERS_SECRET bearer token, not user session cookies
- reminder_sent_at column added in migrations/002_scheduler_enhancements.sql
- Black tier gets iCal export (.ics download) in the frontend; Pro does not
