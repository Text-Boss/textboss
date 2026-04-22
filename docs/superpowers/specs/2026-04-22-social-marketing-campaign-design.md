# Text Boss — Social Media Marketing Campaign Design
**Date:** 2026-04-22  
**Status:** Approved

---

## Overview

Parallel-track marketing campaign to establish Text Boss on Reddit, LinkedIn, X/Twitter, and Instagram. Two workstreams run simultaneously — content generation and automation infrastructure — converging at a single launch date with a full 30-day content queue loaded.

**Outcome:** Strategy + ready-to-post content AND full API-based automation stack.  
**Cadence:** Moderate (1 post/day across platforms combined), scaling to aggressive after 6 weeks.  
**Tone:** Consistent brand voice across all platforms — terminal aesthetic, no fluff, authoritative.

---

## Platform Strategy

| Platform | Account Status | Primary Audience | Content Type |
|---|---|---|---|
| Reddit | New | Freelancers, tradespeople, consultants | Value-add comments (weeks 1–2), then posts. Subreddits: r/freelance, r/entrepreneur, r/smallbusiness, r/consulting, r/Upwork, r/aussmallbusiness |
| LinkedIn | New | Consultants, agency owners, B2B service providers | Short-form punchy posts, before/after scenarios, "unpopular opinion" hooks. Company page + founder personal page. |
| X / Twitter | New | All three audiences | High-frequency short-form, threads, reply engagement |
| Instagram | Existing | All three audiences | Repurposed LinkedIn/X content as carousels + quote tiles via Meta Graph API |

**Reddit constraint:** New accounts face karma gates on most subreddits. Weeks 1–2 are comment-only warm-up. Automation does not fire promotional posts until karma threshold is met (100+ karma to begin posting; 6-week KPI target is 500+ to unlock the most gated subreddits).

**LinkedIn constraint:** Personal page auto-posting is not supported by LinkedIn's API terms — personal page posts are queued as drafts for manual publish. Company page posts are fully automated.

---

## Content Pillars

All content maps to one of five pillars:

**Pillar 1 — The Soft Reply Tax**  
The hidden cost of unstructured client communication. Real dollar/time cost of one weak sentence — scope creep, accidental discounts, no-shows. Speaks to all three audiences.

**Pillar 2 — Before / After**  
Same situation, two replies — improvised vs. controlled. Direct lift from homepage scenarios (scope creep, pricing pushback, no-show documentation). High-engagement format. Carousels on Instagram, threads on X, two-part posts on LinkedIn.

**Pillar 3 — You're Not Difficult, Your Language Is**  
Reframes client problems as language problems. Resonates with freelancers who feel guilty about setting boundaries. Positions Text Boss as a precision tool.

**Pillar 4 — The No-Show / Booking Chaos Problem**  
Targets Pro/Black scheduling pain. Posts about unconfirmed DM bookings, no-shows with no paper trail, back-and-forth scheduling threads. Drives awareness of AI scheduling angle for service-based businesses.

**Pillar 5 — Tier Awareness / Social Proof**  
Real scenarios mapped to tiers — "which tier is this?" posts, client situation quizzes, outcome showcases. Builds curiosity about the product without hard selling.

---

## Audience Segmentation by Platform

| Platform | Primary Segment | Secondary Segment |
|---|---|---|
| Reddit | Freelancers & contractors | Tradespeople & service businesses |
| LinkedIn | Consultants & agency owners | Freelancers & contractors |
| X / Twitter | All three equally | — |
| Instagram | Freelancers & contractors | Tradespeople & service businesses |

---

## Automation Stack

### Track A — Content Pipeline (Growth Operator Agent)
- Generates 30 days of pre-written posts per platform, mapped to content pillars and audience segments
- Output format: structured content calendar (JSON + markdown) with fields: `platform`, `pillar`, `audience`, `copy`, `hashtags`, `scheduled_time`
- Instagram content includes layout brief for carousel/quote tile design
- All content reviewed and approved before entering the automation queue

### Track B — Automation Infrastructure

**Orchestration:** n8n (self-hosted or n8n Cloud)  
- Reads the content calendar on schedule
- Routes posts to the correct platform API
- Logs post status (success/failure) per item

**Platform API connections:**

| Platform | API | Auth Method | Notes |
|---|---|---|---|
| Reddit | Reddit API v2 | OAuth2 (script app) | PRAW-compatible. Comment engagement on trending threads in target subreddits. |
| LinkedIn | LinkedIn API v2 | OAuth2 | Company page: fully automated. Personal page: draft creation only (manual publish per LinkedIn ToS). |
| X / Twitter | Twitter API v2 | OAuth2 (Free tier) | 1,500 posts/month limit — sufficient for moderate cadence. |
| Instagram | Meta Graph API | OAuth2 | Scheduled media publish to existing account. |

**UTM tracking:** Every bio/about section links to `textboss.com.au` with a platform-specific UTM parameter (`?utm_source=reddit`, `?utm_source=linkedin`, etc.) so signups are attributable by channel from day one.

---

## Launch Sequence

| Week | Activity |
|---|---|
| Week 1 | Create all platform accounts. Set up n8n. Connect Reddit, LinkedIn, X, and Instagram APIs. Generate 30-day content calendar. Content reviewed and approved before queue loads. |
| Week 2 | Reddit warm-up (comment-only). LinkedIn company + personal page go live. X goes live. Instagram reposts begin. |
| Week 3 | Reddit promotional posts begin (karma threshold met). Full cross-platform cadence running. Review engagement, cut underperformers. |
| Weeks 4–6 | Optimise based on traction. Double down on best-performing pillar per platform. Plan escalation to higher frequency. |

---

## KPIs (6-week targets)

| Metric | Target |
|---|---|
| Reddit karma | 500+ (unlocks gated subreddits) |
| LinkedIn post impressions | 1,000+ per post average by week 6 |
| X followers | 200+ organic |
| Instagram reach | 10% growth on existing following |
| Inbound signups from social | Trackable via UTM links |

---

## Constraints & Rules

- Reddit accounts that post too aggressively early get shadow-banned permanently — warm-up is non-negotiable
- LinkedIn personal page automation is blocked by ToS — drafts only, user publishes manually
- Twitter API Free tier caps at 1,500 posts/month — moderate cadence stays within this
- No soft, explanatory, or AI-giveaway language in any post — brand voice is consistent across all platforms
- All content reviewed and approved before entering the automated queue — no blind publishing
