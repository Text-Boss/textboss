---
name: Text Boss Product Overview
description: Core product facts, tiers, pricing, and tech stack — foundational context for all growth work
type: project
---

Text Boss is a live, subscription-based AI product for professional communication in high-stakes situations.

**Why:** The product is fully built and deployed on Netlify with Stripe billing and Supabase auth. Marketing needs to drive signups into an already-functional product.

**How to apply:** All growth work should be conversion-focused — the funnel endpoint is a Stripe checkout. There is no free trial or freemium layer, so messaging must justify price and create urgency from awareness all the way to purchase.

## Tiers and Pricing (AUD)
- Core — $29/mo: Everyday client communication, send-ready messages, 10 threads. Target: solo operators, individuals.
- Pro — $79/mo: Everything in Core + AI appointment scheduler, message sequences, pattern control, 50 threads. Target: freelancers, consultants, account managers, coaches.
- Black — $199/mo: Everything in Pro + exposure control, non-admission language, screenshot-safe responses, legally defensible scheduling, unlimited threads. Target: agencies, high-ticket operators, anyone with chargeback/dispute risk.

## Stripe checkout links (do not expose in public-facing content)
- Core: buy.stripe.com/cNibJ03WQcVS68legm2Ji03
- Pro: buy.stripe.com/cNicN4gJC2he40d7RY2Ji04
- Black: buy.stripe.com/6oU7sK9hacVS8gtfkq2Ji05

## Tech stack
- Netlify (static hosting + serverless functions in netlify/functions/)
- Supabase (auth/entitlements)
- OpenAI Responses API
- Stripe (billing)
- No CMS, no blog infrastructure as of session 1 (April 2026)

## Marketing pages
- index.html — main landing page with hero, before/after demos, scheduler spotlight, tier comparison table, pricing cards, FAQ
- core.html — Core tier page
- pro.html — Pro tier page
- black.html — Black tier page
- access.html — subscriber login entry point
- privacy.html, terms.html, contact.html — legal/support pages
