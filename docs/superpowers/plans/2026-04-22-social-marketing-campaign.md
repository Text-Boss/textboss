# Social Media Marketing Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch a parallel-track social media marketing campaign for Text Boss across Reddit, LinkedIn, X/Twitter, and Instagram — with a 30-day pre-generated content calendar and a fully automated n8n posting pipeline.

**Architecture:** Two tracks run simultaneously. Track A generates all content via the growth operator agent and outputs a structured JSON content calendar. Track B sets up n8n as the orchestration layer and connects each platform via OAuth2. Both tracks converge when the approved content calendar is loaded into n8n and the first scheduled posts fire.

**Tech Stack:** n8n (self-hosted or n8n Cloud), Reddit API v2 (PRAW-compatible), LinkedIn API v2, Twitter API v2, Meta Graph API (Instagram), JSON content calendar, UTM-tagged links.

---

## File Structure

```
marketing/
  content-calendar/
    schema.json              # Content calendar JSON schema definition
    calendar.json            # Generated 30-day content calendar (output of Track A)
    approved/                # Approved posts copied here before n8n loads them
  n8n/
    workflows/
      reddit-warmup.json     # n8n workflow: Reddit comment engagement (weeks 1-2)
      reddit-post.json       # n8n workflow: Reddit promotional posts (week 3+)
      linkedin-post.json     # n8n workflow: LinkedIn company page posts
      x-post.json            # n8n workflow: X/Twitter posts
      instagram-post.json    # n8n workflow: Instagram media publish
      calendar-reader.json   # n8n workflow: reads calendar.json and routes to platform workflows
    credentials/
      README.md              # Instructions for setting up OAuth credentials in n8n (no secrets committed)
  scripts/
    validate-calendar.js     # Validates calendar.json against schema before loading into n8n
    generate-utm-bios.js     # Outputs bio copy with UTM links for each platform
```

---

## TRACK A — Content Pipeline

### Task 1: Define content calendar schema

**Files:**
- Create: `marketing/content-calendar/schema.json`

- [ ] **Step 1: Create the schema file**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TextBoss Content Calendar",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "platform", "pillar", "audience", "copy", "hashtags", "scheduled_time", "status"],
    "properties": {
      "id": { "type": "string", "description": "Unique post ID e.g. post-001" },
      "platform": { "type": "string", "enum": ["reddit", "linkedin", "x", "instagram"] },
      "pillar": {
        "type": "string",
        "enum": [
          "soft-reply-tax",
          "before-after",
          "language-problem",
          "no-show-chaos",
          "tier-awareness"
        ]
      },
      "audience": {
        "type": "string",
        "enum": ["freelancers-contractors", "tradespeople-service", "consultants-agency"]
      },
      "copy": { "type": "string", "description": "Full post copy ready to publish" },
      "hashtags": { "type": "array", "items": { "type": "string" } },
      "scheduled_time": { "type": "string", "format": "date-time", "description": "ISO 8601 UTC" },
      "status": { "type": "string", "enum": ["draft", "approved", "posted", "failed"] },
      "subreddit": { "type": "string", "description": "Required for reddit platform posts" },
      "instagram_layout_brief": { "type": "string", "description": "Carousel/quote tile design brief for Instagram" },
      "reddit_type": { "type": "string", "enum": ["comment", "post"], "description": "Reddit only: comment for warm-up, post for promotional" }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add marketing/content-calendar/schema.json
git commit -m "feat: add content calendar JSON schema"
```

---

### Task 2: Write calendar validation script

**Files:**
- Create: `marketing/scripts/validate-calendar.js`

- [ ] **Step 1: Write the validator**

```javascript
// Validates calendar.json against schema.json before loading into n8n
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '../content-calendar/schema.json');
const calendarPath = process.argv[2] || path.join(__dirname, '../content-calendar/calendar.json');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const calendar = JSON.parse(fs.readFileSync(calendarPath, 'utf8'));

const REQUIRED_FIELDS = ['id', 'platform', 'pillar', 'audience', 'copy', 'hashtags', 'scheduled_time', 'status'];
const VALID_PLATFORMS = ['reddit', 'linkedin', 'x', 'instagram'];
const VALID_PILLARS = ['soft-reply-tax', 'before-after', 'language-problem', 'no-show-chaos', 'tier-awareness'];
const VALID_AUDIENCES = ['freelancers-contractors', 'tradespeople-service', 'consultants-agency'];
const VALID_STATUSES = ['draft', 'approved', 'posted', 'failed'];

let errors = [];

if (!Array.isArray(calendar)) {
  errors.push('Calendar must be an array');
  report(errors);
  process.exit(1);
}

calendar.forEach((post, i) => {
  const prefix = `Post[${i}] (${post.id || 'no-id'})`;

  REQUIRED_FIELDS.forEach(f => {
    if (post[f] === undefined || post[f] === null || post[f] === '') {
      errors.push(`${prefix}: missing required field "${f}"`);
    }
  });

  if (post.platform && !VALID_PLATFORMS.includes(post.platform)) {
    errors.push(`${prefix}: invalid platform "${post.platform}"`);
  }
  if (post.pillar && !VALID_PILLARS.includes(post.pillar)) {
    errors.push(`${prefix}: invalid pillar "${post.pillar}"`);
  }
  if (post.audience && !VALID_AUDIENCES.includes(post.audience)) {
    errors.push(`${prefix}: invalid audience "${post.audience}"`);
  }
  if (post.status && !VALID_STATUSES.includes(post.status)) {
    errors.push(`${prefix}: invalid status "${post.status}"`);
  }
  if (post.platform === 'reddit' && !post.reddit_type) {
    errors.push(`${prefix}: reddit posts require "reddit_type" field ("comment" or "post")`);
  }
  if (post.platform === 'reddit' && post.reddit_type === 'post' && !post.subreddit) {
    errors.push(`${prefix}: reddit post type requires "subreddit" field`);
  }
  if (post.scheduled_time && isNaN(Date.parse(post.scheduled_time))) {
    errors.push(`${prefix}: "scheduled_time" is not a valid ISO 8601 date`);
  }
});

function report(errs) {
  if (errs.length === 0) {
    console.log(`✓ Calendar valid — ${calendar.length} posts`);
  } else {
    console.error(`✗ Calendar has ${errs.length} error(s):`);
    errs.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }
}

report(errors);
```

- [ ] **Step 2: Test with an invalid calendar to confirm it catches errors**

Create a temp file `marketing/content-calendar/test-bad.json`:
```json
[{ "id": "post-001", "platform": "twitter", "copy": "" }]
```

Run:
```bash
node marketing/scripts/validate-calendar.js marketing/content-calendar/test-bad.json
```

Expected output:
```
✗ Calendar has 7 error(s):
  - Post[0] (post-001): invalid platform "twitter"
  - Post[0] (post-001): missing required field "pillar"
  ...
```

Delete the test file after verifying.

- [ ] **Step 3: Commit**

```bash
git add marketing/scripts/validate-calendar.js
git commit -m "feat: add content calendar validation script"
```

---

### Task 3: Generate 30-day content calendar via growth operator agent

**Files:**
- Create: `marketing/content-calendar/calendar.json` (agent output)

- [ ] **Step 1: Launch the textboss-growth-operator agent**

In Claude Code, trigger the `textboss-growth-operator` agent with this brief:

> "Generate a 30-day content calendar for Text Boss in JSON format matching the schema at `marketing/content-calendar/schema.json`. Requirements:
> - 30 days of posts, roughly 1 post/day distributed across reddit, linkedin, x, instagram
> - Reddit posts weeks 1-2 must be `reddit_type: "comment"` (warm-up phase) — no promotional reddit posts until day 15+
> - Distribute across all 5 content pillars: soft-reply-tax, before-after, language-problem, no-show-chaos, tier-awareness
> - Segment audiences per platform: reddit=freelancers-contractors + tradespeople-service, linkedin=consultants-agency + freelancers-contractors, x=all three, instagram=freelancers-contractors + tradespeople-service
> - Brand voice: terminal aesthetic, no fluff, authoritative, confrontational. No soft language. No AI-giveaway phrases.
> - All scheduled_times start from today and spread across 30 days, posting at peak times: LinkedIn 8am AEST, X 12pm AEST, Reddit 7pm AEST, Instagram 6pm AEST
> - All statuses set to "draft"
> - Include subreddit field for all reddit entries. Target subreddits: r/freelance, r/entrepreneur, r/smallbusiness, r/consulting, r/Upwork, r/aussmallbusiness
> - Instagram entries must include instagram_layout_brief
> Save the output to `marketing/content-calendar/calendar.json`"

- [ ] **Step 2: Validate the generated calendar**

```bash
node marketing/scripts/validate-calendar.js marketing/content-calendar/calendar.json
```

Expected:
```
✓ Calendar valid — 30 posts
```

If errors appear, fix the calendar JSON manually or re-run the agent with corrections.

- [ ] **Step 3: Review all 30 posts manually**

Open `marketing/content-calendar/calendar.json` and read every post. Check:
- Brand voice is consistent (no soft language, no "I hope this helps", no "Certainly")
- Reddit comment posts (days 1-14) don't mention Text Boss by name — they're value-add only
- Reddit promotional posts (days 15+) have a clear hook and link in bio reference
- LinkedIn posts end with a pattern-interrupt question or statement, not a soft CTA
- X posts are under 280 characters

- [ ] **Step 4: Update approved posts to status "approved"**

For any post you approve, change its `status` from `"draft"` to `"approved"`. Posts not approved stay as `"draft"` and n8n will skip them.

- [ ] **Step 5: Copy approved calendar to approved folder**

```bash
cp marketing/content-calendar/calendar.json marketing/content-calendar/approved/calendar.json
```

- [ ] **Step 6: Commit**

```bash
git add marketing/content-calendar/calendar.json marketing/content-calendar/approved/calendar.json
git commit -m "feat: add approved 30-day content calendar"
```

---

### Task 4: Generate UTM bio copy for all platforms

**Files:**
- Create: `marketing/scripts/generate-utm-bios.js`

- [ ] **Step 1: Write the bio generator**

```javascript
// Outputs platform bio copy with UTM-tagged links ready to paste
const bios = [
  {
    platform: 'Reddit',
    handle: 'u/textboss_au',
    bio: 'Structured language for client communication. Stop improvising, start controlling. → textboss.com.au',
    url: 'https://textboss.com.au?utm_source=reddit&utm_medium=social&utm_campaign=organic'
  },
  {
    platform: 'LinkedIn (Company Page)',
    handle: 'Text Boss',
    bio: 'Client communication for people who are done improvising. Tier-gated AI + structured language for freelancers, consultants, and service providers.',
    url: 'https://textboss.com.au?utm_source=linkedin&utm_medium=social&utm_campaign=organic'
  },
  {
    platform: 'X / Twitter',
    handle: '@textboss_au',
    bio: 'Say less. Mean more. Leave nothing open. // Client comms + AI scheduling for people who stopped being "nice" about it.',
    url: 'https://textboss.com.au?utm_source=x&utm_medium=social&utm_campaign=organic'
  },
  {
    platform: 'Instagram',
    handle: '@textboss.au',
    bio: 'Controlled client communication.\nScope creep ends here.\nLink →',
    url: 'https://textboss.com.au?utm_source=instagram&utm_medium=social&utm_campaign=organic'
  }
];

bios.forEach(b => {
  console.log(`\n── ${b.platform} (${b.handle}) ──`);
  console.log(`Bio: ${b.bio}`);
  console.log(`URL: ${b.url}`);
});
```

- [ ] **Step 2: Run it and save the output**

```bash
node marketing/scripts/generate-utm-bios.js
```

Paste the output into each platform's bio/about section when setting up accounts in Task 5.

- [ ] **Step 3: Commit**

```bash
git add marketing/scripts/generate-utm-bios.js
git commit -m "feat: add UTM bio generator script"
```

---

## TRACK B — Automation Infrastructure

### Task 5: Create platform accounts and OAuth apps

**Files:**
- Create: `marketing/n8n/credentials/README.md`

- [ ] **Step 1: Create social media accounts**

Create accounts on each platform. Use a consistent handle across all platforms (`textboss_au` or `textboss.au`):

| Platform | URL | Notes |
|---|---|---|
| Reddit | reddit.com/register | Personal account first, then create subreddit presence |
| LinkedIn | linkedin.com/company/new | Company page — requires personal LinkedIn account |
| X / Twitter | twitter.com/i/flow/signup | Standard signup |
| Instagram | Already exists | Use existing account |

- [ ] **Step 2: Create Reddit OAuth app**

1. Go to `https://www.reddit.com/prefs/apps`
2. Click "create another app"
3. Name: `TextBoss Scheduler`
4. Type: **script**
5. Redirect URI: `http://localhost:8080`
6. Save the **client_id** (under app name) and **client_secret**

- [ ] **Step 3: Create Twitter OAuth app**

1. Go to `https://developer.twitter.com/en/portal/dashboard`
2. Create a new Project → App
3. Set App Permissions to **Read and Write**
4. Generate **API Key**, **API Secret**, **Access Token**, **Access Token Secret**
5. Note: Free tier allows 1,500 tweets/month

- [ ] **Step 4: Create LinkedIn OAuth app**

1. Go to `https://www.linkedin.com/developers/apps/new`
2. Create app linked to your company page
3. Request the `w_member_social` and `w_organization_social` permissions
4. Note **Client ID** and **Client Secret**

- [ ] **Step 5: Create Meta/Instagram API app**

1. Go to `https://developers.facebook.com/apps/`
2. Create app → Business type
3. Add Instagram Graph API product
4. Generate a long-lived **Page Access Token** for the Instagram account
5. Note the **Instagram Business Account ID**

- [ ] **Step 6: Write credentials README (no secrets committed)**

```markdown
# n8n Platform Credentials Setup

Store all credentials in n8n's built-in credential store — never commit secrets to git.

## Reddit
- Credential type: `Reddit OAuth2 API`
- Client ID: (from reddit.com/prefs/apps)
- Client Secret: (from reddit.com/prefs/apps)
- Username: your Reddit username
- Password: your Reddit password

## LinkedIn
- Credential type: `LinkedIn OAuth2 API`
- Client ID: (from developers.linkedin.com)
- Client Secret: (from developers.linkedin.com)
- Scopes: `w_member_social`, `w_organization_social`

## X / Twitter
- Credential type: `Twitter OAuth1 API`
- API Key: (from developer.twitter.com)
- API Secret: (from developer.twitter.com)
- Access Token: (from developer.twitter.com)
- Access Token Secret: (from developer.twitter.com)

## Instagram (Meta Graph API)
- Credential type: `HTTP Header Auth`
- Name: `Authorization`
- Value: `Bearer <long-lived-page-access-token>`
- Instagram Business Account ID: stored as n8n variable `INSTAGRAM_ACCOUNT_ID`
```

- [ ] **Step 7: Commit**

```bash
git add marketing/n8n/credentials/README.md
git commit -m "docs: add n8n credentials setup guide"
```

---

### Task 6: Install and configure n8n

- [ ] **Step 1: Install n8n**

Option A — Cloud (recommended for simplicity):
Sign up at `https://app.n8n.cloud` — free tier supports up to 5 active workflows.
**Note:** n8n Cloud does not allow file system access in Code/Function nodes. If using Cloud, skip the "mark as posted" function nodes in Tasks 8-12 and update calendar statuses manually at end of each day.

Option B — Self-hosted (required for full file write-back):
```bash
npm install -g n8n
NODE_FUNCTION_ALLOW_BUILTIN=* n8n start
```
n8n runs at `http://localhost:5678`. The `NODE_FUNCTION_ALLOW_BUILTIN=*` flag enables `require('fs')` inside Code/Function nodes — required for the status write-back in Tasks 8–12.

- [ ] **Step 2: Add all platform credentials in n8n**

In n8n UI → Credentials → Add Credential. Add one credential for each platform using the README in `marketing/n8n/credentials/README.md`. Test each connection using n8n's built-in "Test" button.

Expected: all four platforms show green "Connection successful".

- [ ] **Step 3: Add content calendar path as n8n variable**

In n8n UI → Settings → Variables → Add:
- Name: `CALENDAR_PATH`
- Value: absolute path to `marketing/content-calendar/approved/calendar.json`

---

### Task 7: Build content calendar reader workflow

**Files:**
- Create: `marketing/n8n/workflows/calendar-reader.json`

This is the master workflow. It runs on a schedule, reads `calendar.json`, finds posts where `status = "approved"` and `scheduled_time` is within the next 5 minutes, and routes them to the correct platform sub-workflow.

- [ ] **Step 1: Build the workflow in n8n UI**

Create a new workflow named `TextBoss — Calendar Reader`:

Nodes:
1. **Schedule Trigger** — runs every 5 minutes (`*/5 * * * *`)
2. **Read Binary File** — reads `{{ $vars.CALENDAR_PATH }}`
3. **Function** — parses JSON and filters for posts due now:
```javascript
const calendar = JSON.parse(items[0].binary.data.toString());
const now = new Date();
const windowMs = 5 * 60 * 1000; // 5 minutes

const due = calendar.filter(post => {
  if (post.status !== 'approved') return false;
  const postTime = new Date(post.scheduled_time);
  return postTime >= now && postTime <= new Date(now.getTime() + windowMs);
});

return due.map(post => ({ json: post }));
```
4. **Switch** — routes on `{{ $json.platform }}`:
   - `reddit` → Reddit Warmup or Post workflow (based on `reddit_type`)
   - `linkedin` → LinkedIn Post workflow
   - `x` → X Post workflow
   - `instagram` → Instagram Post workflow

- [ ] **Step 2: Export the workflow**

In n8n UI → workflow menu → Download → save to `marketing/n8n/workflows/calendar-reader.json`.

- [ ] **Step 3: Commit**

```bash
git add marketing/n8n/workflows/calendar-reader.json
git commit -m "feat: add n8n calendar reader workflow"
```

---

### Task 8: Build Reddit warm-up workflow (comment engagement)

**Files:**
- Create: `marketing/n8n/workflows/reddit-warmup.json`

This workflow posts a comment to a Reddit thread. It is triggered by the calendar reader when `platform = "reddit"` and `reddit_type = "comment"`.

- [ ] **Step 1: Build the workflow in n8n UI**

Create workflow named `TextBoss — Reddit Comment`:

Nodes:
1. **Webhook trigger** (called by calendar reader via HTTP Request node)
   - Input: `{ id, copy, subreddit, thread_url }`
   - Note: for comment posts, the `subreddit` field in the calendar entry holds the target thread URL, e.g. `https://www.reddit.com/r/freelance/comments/xyz/title/`
2. **HTTP Request** — POST to Reddit API:
   - URL: `https://oauth.reddit.com/api/comment`
   - Auth: Reddit OAuth2 credential
   - Body (form):
     ```
     thing_id: {{ extract thread ID from thread_url, format: t3_<id> }}
     text: {{ $json.copy }}
     ```
3. **Function** — update post status to "posted" in calendar file:
```javascript
// Read, update, write back
const fs = require('fs');
const calPath = process.env.CALENDAR_PATH;
const calendar = JSON.parse(fs.readFileSync(calPath, 'utf8'));
const post = calendar.find(p => p.id === $json.id);
if (post) post.status = 'posted';
fs.writeFileSync(calPath, JSON.stringify(calendar, null, 2));
return items;
```

- [ ] **Step 2: Test with a real Reddit thread**

Pick a live thread in r/freelance. In n8n, manually trigger the workflow with:
```json
{
  "id": "test-001",
  "copy": "The moment you explain your pricing is the moment the negotiation starts. Don't explain it.",
  "subreddit": "r/freelance",
  "thread_url": "https://www.reddit.com/r/freelance/comments/<real-thread-id>/<thread-title>/"
}
```

Expected: comment appears on the thread within 30 seconds.

- [ ] **Step 3: Export and commit**

```bash
git add marketing/n8n/workflows/reddit-warmup.json
git commit -m "feat: add Reddit comment warm-up n8n workflow"
```

---

### Task 9: Build Reddit post workflow

**Files:**
- Create: `marketing/n8n/workflows/reddit-post.json`

Triggered when `platform = "reddit"` and `reddit_type = "post"`. Only fires for posts scheduled on day 15+.

- [ ] **Step 1: Build workflow in n8n UI**

Create workflow named `TextBoss — Reddit Post`:

Nodes:
1. **Webhook trigger** — Input: `{ id, copy, subreddit }`
2. **HTTP Request** — POST to Reddit API:
   - URL: `https://oauth.reddit.com/api/submit`
   - Auth: Reddit OAuth2 credential
   - Body (form):
     ```
     sr: {{ $json.subreddit }}
     kind: self
     title: {{ first line of $json.copy, max 300 chars }}
     text: {{ $json.copy }}
     resubmit: true
     nsfw: false
     spoiler: false
     ```
3. **Function** — mark post as "posted" in calendar file (same as Task 8 Step 1 function node)

- [ ] **Step 2: Test in a private subreddit first**

Create a private test subreddit (e.g. r/textboss_test) and run a test post before pointing at live subreddits.

- [ ] **Step 3: Export and commit**

```bash
git add marketing/n8n/workflows/reddit-post.json
git commit -m "feat: add Reddit post n8n workflow"
```

---

### Task 10: Build LinkedIn company page post workflow

**Files:**
- Create: `marketing/n8n/workflows/linkedin-post.json`

- [ ] **Step 1: Get your LinkedIn Organization URN**

```bash
curl -H "Authorization: Bearer <your-linkedin-access-token>" \
  "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee"
```

Note the `organization` URN from the response — format: `urn:li:organization:XXXXXXX`. Store it as n8n variable `LINKEDIN_ORG_URN`.

- [ ] **Step 2: Build workflow in n8n UI**

Create workflow named `TextBoss — LinkedIn Post`:

Nodes:
1. **Webhook trigger** — Input: `{ id, copy, hashtags }`
2. **Function** — build LinkedIn post body:
```javascript
const hashtags = $json.hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ');
const fullCopy = $json.copy + '\n\n' + hashtags;

return [{
  json: {
    author: $vars.LINKEDIN_ORG_URN,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: fullCopy },
        shareMediaCategory: 'NONE'
      }
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
  }
}];
```
3. **HTTP Request** — POST to LinkedIn:
   - URL: `https://api.linkedin.com/v2/ugcPosts`
   - Auth: LinkedIn OAuth2 credential
   - Body: JSON from function node
4. **Function** — mark post as "posted" in calendar file

- [ ] **Step 3: Test with a draft post**

Manually trigger with:
```json
{
  "id": "test-li-001",
  "copy": "One unconfirmed DM booking cost me three hours last Tuesday.\n\nNot the no-show. The back-and-forth before it, the gap it created, and the awkward follow-up after.\n\nThe scheduling system was the problem. Not the client.",
  "hashtags": ["freelance", "clientmanagement", "scheduling"]
}
```

Expected: post appears on company page LinkedIn feed within 60 seconds.

- [ ] **Step 4: Export and commit**

```bash
git add marketing/n8n/workflows/linkedin-post.json
git commit -m "feat: add LinkedIn company page post n8n workflow"
```

**LinkedIn personal page note:** LinkedIn's ToS prohibits fully automated posting to personal profiles via API. Personal page posts are not automated — when a calendar entry is intended for your personal LinkedIn page, set its `status` to `"draft"` and publish it manually from the LinkedIn app. The workflow above handles company page posts only.

---

### Task 11: Build X/Twitter post workflow

**Files:**
- Create: `marketing/n8n/workflows/x-post.json`

- [ ] **Step 1: Build workflow in n8n UI**

Create workflow named `TextBoss — X Post`:

Nodes:
1. **Webhook trigger** — Input: `{ id, copy }`
2. **HTTP Request** — POST to Twitter API v2:
   - URL: `https://api.twitter.com/2/tweets`
   - Auth: Twitter OAuth1 credential
   - Body (JSON):
     ```json
     { "text": "{{ $json.copy }}" }
     ```
   - Note: Twitter API Free tier — verify copy is under 280 characters in the calendar
3. **Function** — mark post as "posted" in calendar file

- [ ] **Step 2: Test**

Manually trigger with:
```json
{
  "id": "test-x-001",
  "copy": "The discount request isn't the problem.\n\nThe sentence you wrote back is.\n\n// textboss.com.au"
}
```

Expected: tweet appears on profile within 30 seconds.

- [ ] **Step 3: Export and commit**

```bash
git add marketing/n8n/workflows/x-post.json
git commit -m "feat: add X/Twitter post n8n workflow"
```

---

### Task 12: Build Instagram post workflow

**Files:**
- Create: `marketing/n8n/workflows/instagram-post.json`

Instagram requires a two-step publish: first create a media container, then publish it. Text-only posts are not supported — Instagram requires an image. Use a pre-generated quote tile image URL or a static branded image URL hosted on your server.

- [ ] **Step 1: Host a branded image**

Upload a simple branded Text Boss quote tile image to `assets/instagram-tile.png` on your live site so it's accessible at `https://textboss.com.au/assets/instagram-tile.png`. This is used as the fallback image for all Instagram posts until individual tiles are designed.

- [ ] **Step 2: Build workflow in n8n UI**

Create workflow named `TextBoss — Instagram Post`:

Nodes:
1. **Webhook trigger** — Input: `{ id, copy, hashtags, instagram_layout_brief }`
2. **HTTP Request (Step 1 — Create container)**:
   - URL: `https://graph.facebook.com/v19.0/{{ $vars.INSTAGRAM_ACCOUNT_ID }}/media`
   - Method: POST
   - Auth: HTTP Header Auth (Instagram Bearer token)
   - Body (form):
     ```
     image_url: https://textboss.com.au/assets/instagram-tile.png
     caption: {{ $json.copy }}\n\n{{ $json.hashtags.join(' ') }}
     ```
3. **HTTP Request (Step 2 — Publish container)**:
   - URL: `https://graph.facebook.com/v19.0/{{ $vars.INSTAGRAM_ACCOUNT_ID }}/media_publish`
   - Method: POST
   - Auth: HTTP Header Auth
   - Body (form):
     ```
     creation_id: {{ $node["HTTP Request"].json.id }}
     ```
4. **Function** — mark post as "posted" in calendar file

- [ ] **Step 3: Test**

Manually trigger with:
```json
{
  "id": "test-ig-001",
  "copy": "Same client. Same request.\n\nDifferent sentence. Different outcome.\n\nThe language was always the variable.",
  "hashtags": ["#freelance", "#clientcommunication", "#textboss"],
  "instagram_layout_brief": "Quote tile: white text on dark terminal background"
}
```

Expected: post appears on Instagram feed within 60 seconds.

- [ ] **Step 4: Export and commit**

```bash
git add marketing/n8n/workflows/instagram-post.json
git commit -m "feat: add Instagram post n8n workflow"
```

---

## CONVERGENCE — Launch

### Task 13: End-to-end test and go-live

- [ ] **Step 1: Run calendar validation one final time**

```bash
node marketing/scripts/validate-calendar.js marketing/content-calendar/approved/calendar.json
```

Expected:
```
✓ Calendar valid — 30 posts
```

- [ ] **Step 2: Verify all n8n workflows are active**

In n8n UI, confirm these workflows are toggled ON:
- `TextBoss — Calendar Reader` (scheduled every 5 min)
- `TextBoss — Reddit Comment`
- `TextBoss — Reddit Post`
- `TextBoss — LinkedIn Post`
- `TextBoss — X Post`
- `TextBoss — Instagram Post`

- [ ] **Step 3: Update all platform bios**

Run:
```bash
node marketing/scripts/generate-utm-bios.js
```

Paste the bio copy and UTM URL into each platform's profile/about section.

- [ ] **Step 4: Set the first post's scheduled_time to 5 minutes from now**

In `marketing/content-calendar/approved/calendar.json`, find `post-001` and update its `scheduled_time` to 5 minutes from now (ISO 8601 UTC). This triggers the first real post and confirms the full pipeline is working end-to-end.

- [ ] **Step 5: Monitor n8n execution log for 10 minutes**

In n8n UI → Executions. Watch for the calendar reader to fire and route the first post. Confirm:
- Calendar reader fires on schedule
- Correct platform workflow is triggered
- Post appears on the target platform
- Post status is updated to "posted" in calendar.json

- [ ] **Step 6: Final commit**

```bash
git add marketing/content-calendar/approved/calendar.json
git commit -m "feat: go-live — social media automation pipeline active"
```

---

## Week 3+ — Reddit Karma Gate Check

Before any `reddit_type: "post"` entries fire (day 15+), verify karma threshold is met.

- [ ] **Check Reddit account karma**

Log into the Reddit account. If karma is below 100, push all `reddit_type: "post"` entries' `scheduled_time` forward by 7 days and re-validate the calendar.

```bash
node marketing/scripts/validate-calendar.js marketing/content-calendar/approved/calendar.json
```
