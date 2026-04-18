# Text Boss Mobile PWA Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first PWA shell (`app.html`) that delivers a proper phone experience for all Text Boss subscribers, with a drawer nav, tier colour theming, and native Prompts section.

**Architecture:** A new `app.html` serves all tiers. It reads the session tier, applies the tier's CSS accent variable, and renders Chat / Schedule / Prompts / Threads / Settings. `app-client.js` and `scheduler-client.js` are reused unchanged — `app.html` exposes the same element IDs they expect, mapped to the new mobile components. The three desktop pages (`app-core/pro/black.html`) are untouched.

**Tech Stack:** Vanilla HTML/CSS/JS, Netlify Functions (unchanged), Web App Manifest, Service Worker, Node.js (one-off prompt extraction script).

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `netlify/functions/verify-email.js` | Change redirect from tier page to `/app.html` |
| Create | `scripts/extract-prompts.js` | One-off: parse prompts HTML → JSON |
| Create | `prompts-data.json` | 100 prompt templates, categorised |
| Create | `icons/icon-192.png` | PWA home screen icon |
| Create | `icons/icon-512.png` | PWA splash icon |
| Create | `icons/icon-512-maskable.png` | Maskable variant for Android |
| Create | `manifest.json` | PWA manifest |
| Create | `app-mobile.css` | All mobile styles (shell, drawer, tier themes, sections) |
| Create | `app.html` | Mobile shell — HTML, inline JS, section layouts |
| Modify | `sw.js` | Add app shell cache for offline load |
| Create | `tests/verify-email-redirect.test.js` | Unit test for redirect change |

---

## Task 1: Change login redirect to /app.html

**Files:**
- Modify: `netlify/functions/verify-email.js:16`
- Create: `tests/verify-email-redirect.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/verify-email-redirect.test.js`:

```js
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/functions/verify-email.js';

// Minimal stubs
const makeEntitlementStore = (tier) => ({
  getByEmail: async () => ({
    entitled_tier: tier,
    subscription_status: 'active',
    current_period_end: new Date(Date.now() + 86400000).toISOString(),
  }),
});

const makeSessionStore = () => ({
  create: async () => 'signed-token',
});

async function testRedirect(tier) {
  const handler = createHandler({
    entitlementStore: makeEntitlementStore(tier),
    sessionStore: makeSessionStore(),
  });
  const event = {
    httpMethod: 'POST',
    body: JSON.stringify({ email: 'test@test.com' }),
    headers: {},
  };
  const res = await handler(event, {});
  const body = JSON.parse(res.body);
  assert.equal(body.redirectTo, '/app.html', `${tier} should redirect to /app.html`);
}

await testRedirect('Core');
await testRedirect('Pro');
await testRedirect('Black');
console.log('verify-email redirect: all pass');
```

- [ ] **Step 2: Run test — expect failure**

```bash
node tests/verify-email-redirect.test.js
```

Expected: AssertionError — redirectTo is `/app-core.html`, not `/app.html`

- [ ] **Step 3: Change the redirect**

In `netlify/functions/verify-email.js`, line 16:

```js
// Before:
function getRedirectForTier(tier) { return `/app-${tier.toLowerCase()}.html`; }

// After:
function getRedirectForTier(_tier) { return '/app.html'; }
```

- [ ] **Step 4: Run test — expect pass**

```bash
node tests/verify-email-redirect.test.js
```

Expected: `verify-email redirect: all pass`

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/verify-email.js tests/verify-email-redirect.test.js
git commit -m "feat: redirect all tiers to /app.html after login"
```

---

## Task 2: Extract prompts to prompts-data.json

**Files:**
- Create: `scripts/extract-prompts.js` (dev-only, not deployed)
- Create: `prompts-data.json`

- [ ] **Step 1: Create the extraction script**

Create `scripts/extract-prompts.js`:

```js
// Run once: node scripts/extract-prompts.js
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('pro_subscriber_prompts.html', 'utf8');
const prompts = [];
let currentCategory = 'General';

// Extract section headers
const sectionRe = /<div class="section-header"[^>]*><h2>([^<]+)<span/g;
// Extract prompt cards
const cardRe = /<div class="prompt-card" data-category="([^"]+)"[\s\S]*?<span class="card-num">(#\d+)<\/span><span class="card-title">([^<]+)<\/span>[\s\S]*?<div class="card-body">([^<]+)<\/div>/g;

let cardMatch;
while ((cardMatch = cardRe.exec(html)) !== null) {
  prompts.push({
    category: cardMatch[1].trim(),
    num: cardMatch[2].trim(),
    title: cardMatch[3].trim(),
    body: cardMatch[4].trim(),
  });
}

// Group by category
const grouped = {};
for (const p of prompts) {
  if (!grouped[p.category]) grouped[p.category] = [];
  grouped[p.category].push({ num: p.num, title: p.title, body: p.body });
}

const output = { categories: Object.keys(grouped), prompts: grouped };
writeFileSync('prompts-data.json', JSON.stringify(output, null, 2));
console.log(`Extracted ${prompts.length} prompts across ${Object.keys(grouped).length} categories`);
```

- [ ] **Step 2: Run the extraction**

```bash
node scripts/extract-prompts.js
```

Expected output: `Extracted 100 prompts across 15 categories`

- [ ] **Step 3: Verify the output**

```bash
node -e "const d=JSON.parse(require('fs').readFileSync('prompts-data.json','utf8')); console.log('Categories:', d.categories.length); console.log('Total prompts:', Object.values(d.prompts).flat().length); console.log('First prompt:', JSON.stringify(d.prompts[d.categories[0]][0], null, 2));"
```

Expected: categories count matches sections in `pro_subscriber_prompts.html`, first prompt has `num`, `title`, `body` fields.

- [ ] **Step 4: Commit**

```bash
git add prompts-data.json scripts/extract-prompts.js
git commit -m "feat: extract prompt templates to prompts-data.json"
```

---

## Task 3: PWA icons

**Files:**
- Create: `icons/icon-192.png`
- Create: `icons/icon-512.png`
- Create: `icons/icon-512-maskable.png`

- [ ] **Step 1: Install canvas and generate placeholder icons**

```bash
npm install canvas --save-dev
```

Create `scripts/generate-icons.js`:

```js
import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('icons', { recursive: true });

function makeIcon(size, maskable = false) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const pad = maskable ? size * 0.1 : 0;

  // Background
  ctx.fillStyle = '#0a0d10';
  ctx.fillRect(0, 0, size, size);

  // "TB" text centred
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `bold ${Math.round((size - pad * 2) * 0.38)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TB', size / 2, size / 2);

  return canvas.toBuffer('image/png');
}

writeFileSync('icons/icon-192.png', makeIcon(192));
writeFileSync('icons/icon-512.png', makeIcon(512));
writeFileSync('icons/icon-512-maskable.png', makeIcon(512, true));
console.log('Icons generated in icons/');
```

- [ ] **Step 2: Run icon generation**

```bash
node scripts/generate-icons.js
```

Expected: three PNG files appear in `icons/`. These are placeholders — replace with proper brand icons before launch.

- [ ] **Step 3: Commit**

```bash
git add icons/ scripts/generate-icons.js
git commit -m "feat: add PWA placeholder icons (replace before launch)"
```

---

## Task 4: manifest.json

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Create the manifest**

Create `manifest.json` at the project root:

```json
{
  "name": "Text Boss",
  "short_name": "TextBoss",
  "description": "AI-powered client communication for freelancers",
  "start_url": "/app.html",
  "display": "standalone",
  "background_color": "#0a0d10",
  "theme_color": "#0a0d10",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

- [ ] **Step 2: Verify JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest.json: valid');"
```

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: add PWA manifest"
```

---

## Task 5: app-mobile.css — shell styles

**Files:**
- Create: `app-mobile.css`

- [ ] **Step 1: Create app-mobile.css**

Create `app-mobile.css`:

```css
/* ── Reset & base ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #0a0d10;
  --panel:    #0d1014;
  --surface:  #1a1d22;
  --border:   #1e2530;
  --border-hi:#2a3040;
  --text:     #e2e8f0;
  --muted:    #6b7280;

  /* Tier accent — overridden per tier in app.html */
  --accent:   #e2e8f0;
  --accent-bg:#1a1d22;
}

/* Tier accent overrides */
[data-tier="Core"]  { --accent: #f59e0b; --accent-bg: #1c1400; }
[data-tier="Pro"]   { --accent: #06b6d4; --accent-bg: #001a1f; }
[data-tier="Black"] { --accent: #a855f7; --accent-bg: #150025; }

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 15px;
  overflow: hidden;
  -webkit-text-size-adjust: 100%;
}

/* ── App shell ── */
#app {
  display: flex;
  flex-direction: column;
  height: 100%;
  height: 100dvh;
}

/* ── Header ── */
#app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  padding-top: calc(10px + env(safe-area-inset-top));
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  z-index: 10;
}

#sidebar-toggle {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
}
#sidebar-toggle span {
  display: block;
  width: 20px;
  height: 2px;
  background: var(--muted);
  border-radius: 1px;
  transition: background 0.2s;
}
#sidebar-toggle:hover span { background: var(--text); }

#header-center {
  text-align: center;
  line-height: 1.2;
}
#header-center .wordmark {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text);
  text-transform: uppercase;
}
#header-center .section-label {
  font-size: 10px;
  color: var(--accent);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

#header-action {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border: 1px solid var(--border-hi);
  border-radius: 8px;
  color: var(--muted);
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
  transition: color 0.2s;
}
#header-action:hover { color: var(--text); }
#header-action.hidden { visibility: hidden; }

/* ── Thread chip strip ── */
#thread-chips {
  display: flex;
  gap: 6px;
  padding: 6px 12px;
  overflow-x: auto;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  scrollbar-width: none;
}
#thread-chips::-webkit-scrollbar { display: none; }

.thread-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  background: var(--surface);
  color: var(--muted);
  border: 1px solid var(--border);
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.thread-chip.active {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent);
}
.thread-chip:hover:not(.active) { color: var(--text); }

/* ── Content area ── */
#content-area {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.section-panel {
  display: none;
  flex-direction: column;
  height: 100%;
}
.section-panel.active { display: flex; }

/* ── Chat section ── */
#chat-thread {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
#chat-thread:empty::before {
  content: 'Describe your client situation — I\'ll draft the message.';
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  margin-top: 40px;
}

.msg { display: flex; flex-direction: column; max-width: 85%; }
.msg-user { align-self: flex-end; align-items: flex-end; }
.msg-ai { align-self: flex-start; }

.msg-label {
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--muted);
  margin-bottom: 3px;
}

.msg-bubble {
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.5;
}
.msg-user .msg-bubble {
  background: var(--accent-bg);
  color: var(--text);
  border-bottom-right-radius: 4px;
  border: 1px solid var(--accent);
}
.msg-ai .msg-bubble {
  background: var(--surface);
  color: var(--text);
  border-bottom-left-radius: 4px;
  border: 1px solid var(--border);
}

/* ── Input bar (shared: chat + schedule AI) ── */
#input-bar {
  padding: 8px 12px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
  background: var(--panel);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

#chat-form {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

#chat-message {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border-hi);
  border-radius: 20px;
  padding: 10px 16px;
  font-size: 14px;
  color: var(--text);
  resize: none;
  max-height: 120px;
  min-height: 42px;
  outline: none;
  font-family: inherit;
}
#chat-message::placeholder { color: var(--muted); }
#chat-message:focus { border-color: var(--accent); }

#chat-submit {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.2s;
}
#chat-submit:disabled { opacity: 0.4; cursor: default; }
#chat-submit svg { width: 18px; height: 18px; fill: #0a0d10; }

#char-count {
  font-size: 11px;
  color: var(--muted);
  text-align: right;
  padding: 2px 4px 0;
}
#app-status {
  font-size: 12px;
  color: var(--muted);
  padding: 4px 4px 0;
  min-height: 18px;
}

/* ── Prompts section ── */
#prompts-panel { overflow: hidden; }

#prompts-search-bar {
  padding: 8px 12px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
#prompts-search {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border-hi);
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 14px;
  color: var(--text);
  outline: none;
  font-family: inherit;
}
#prompts-search::placeholder { color: var(--muted); }
#prompts-search:focus { border-color: var(--accent); }

#prompts-cat-strip {
  display: flex;
  gap: 6px;
  padding: 6px 12px;
  overflow-x: auto;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  scrollbar-width: none;
}
#prompts-cat-strip::-webkit-scrollbar { display: none; }

.cat-chip {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  background: var(--surface);
  color: var(--muted);
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.cat-chip.active {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent);
}

#prompts-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-card-mobile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.prompt-card-mobile-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  cursor: pointer;
}
.prompt-card-mobile-head h4 {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
}
.prompt-card-mobile-head .prompt-num {
  font-size: 11px;
  color: var(--muted);
  margin-right: 8px;
}
.prompt-card-mobile-head .expand-icon {
  font-size: 12px;
  color: var(--muted);
  transition: transform 0.2s;
}
.prompt-card-mobile.expanded .expand-icon { transform: rotate(180deg); }

.prompt-card-mobile-body {
  display: none;
  padding: 0 14px 12px;
  flex-direction: column;
  gap: 10px;
}
.prompt-card-mobile.expanded .prompt-card-mobile-body { display: flex; }

.prompt-text {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
.prompt-text .var-highlight { color: var(--accent); }

.prompt-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.prompt-copy-btn {
  background: var(--accent);
  color: #0a0d10;
  border: none;
  border-radius: 8px;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}
.prompt-send-btn {
  background: var(--surface);
  color: var(--muted);
  border: 1px solid var(--border-hi);
  border-radius: 8px;
  padding: 10px;
  font-size: 13px;
  cursor: pointer;
  text-align: center;
}

.profile-nudge {
  background: var(--accent-bg);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--accent);
  display: none;
}
.profile-nudge.visible { display: block; }

/* ── Threads section ── */
#threads-panel { overflow: hidden; }

#threads-search-bar {
  padding: 8px 12px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
#threads-search {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--border-hi);
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 14px;
  color: var(--text);
  outline: none;
  font-family: inherit;
}
#threads-search:focus { border-color: var(--accent); }
#threads-search::placeholder { color: var(--muted); }

#threads-full-list {
  flex: 1;
  overflow-y: auto;
}

.thread-row {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.thread-row:active { background: var(--surface); }
.thread-row-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.thread-row-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.thread-row-time {
  font-size: 11px;
  color: var(--muted);
}
.thread-row-preview {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Schedule section ── */
#schedule-panel { overflow: hidden; }

.sched-sub-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  flex-shrink: 0;
}
.sched-sub-tab {
  flex: 1;
  padding: 10px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.2s;
}
.sched-sub-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.sched-sub-panel { display: none; flex: 1; flex-direction: column; overflow: hidden; }
.sched-sub-panel.active { display: flex; }

/* ── Settings section ── */
#settings-panel {
  overflow-y: auto;
  padding: 16px;
  gap: 20px;
}

.settings-group {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.settings-group-title {
  padding: 10px 16px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.settings-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.settings-row:last-child { border-bottom: none; }
.settings-row label {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}
.settings-row input {
  background: var(--bg);
  border: 1px solid var(--border-hi);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text);
  outline: none;
  font-family: inherit;
}
.settings-row input:focus { border-color: var(--accent); }

.settings-save-btn {
  background: var(--accent);
  color: #0a0d10;
  border: none;
  border-radius: 10px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
}

.sign-out-btn {
  background: none;
  border: 1px solid var(--border-hi);
  border-radius: 10px;
  padding: 12px 20px;
  font-size: 14px;
  color: var(--muted);
  cursor: pointer;
  width: 100%;
  transition: color 0.2s, border-color 0.2s;
}
.sign-out-btn:hover { color: var(--text); border-color: var(--muted); }

.tier-badge-settings {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: var(--accent-bg);
  color: var(--accent);
  border: 1px solid var(--accent);
}

/* ── Drawer ── */
#threads-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 75%;
  max-width: 280px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 100;
  transform: translateX(-100%);
  transition: transform 0.25s ease;
  padding-top: env(safe-area-inset-top);
}
#threads-sidebar.open { transform: translateX(0); }

.drawer-header {
  padding: 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.drawer-wordmark { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; color: var(--text); }
.drawer-tier {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--accent-bg);
  color: var(--accent);
  border: 1px solid var(--accent);
}

#sidebar-close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}
#sidebar-close:hover { color: var(--text); }

.drawer-nav {
  flex: 1;
  padding: 8px 0;
  overflow-y: auto;
}

.drawer-nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  font-size: 15px;
  color: var(--muted);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  border-left: 2px solid transparent;
}
.drawer-nav-item:hover { color: var(--text); background: var(--surface); }
.drawer-nav-item.active {
  color: var(--accent);
  background: var(--accent-bg);
  border-left-color: var(--accent);
}
.drawer-nav-item .nav-icon { font-size: 18px; width: 24px; text-align: center; }
.drawer-nav-item .nav-label { font-weight: 500; }

.drawer-divider { height: 1px; background: var(--border); margin: 8px 0; }

.drawer-footer {
  padding: 12px 18px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
}

/* ── Backdrop ── */
#sidebar-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 99;
  display: none;
  opacity: 0;
  transition: opacity 0.25s ease;
}
#sidebar-backdrop.visible {
  display: block;
  opacity: 1;
}

/* ── Offline banner ── */
#offline-banner {
  display: none;
  background: #7c2d12;
  color: #fed7aa;
  text-align: center;
  font-size: 12px;
  padding: 6px;
}
#offline-banner.visible { display: block; }

/* ── Hidden plumbing (IDs expected by app-client.js) ── */
#threads-list { display: none; }
```

- [ ] **Step 2: Commit**

```bash
git add app-mobile.css
git commit -m "feat: add mobile CSS shell with tier theming"
```

---

## Task 6: app.html — shell HTML + tier detection

**Files:**
- Create: `app.html`

- [ ] **Step 1: Create app.html with shell structure and inline boot script**

Create `app.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="theme-color" content="#0a0d10">
  <title>Text Boss</title>
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">
  <link rel="stylesheet" href="/app-mobile.css">
  <!-- VAPID key for push (Pro/Black) — populated by server or left blank for Core -->
  <meta name="vapid-public-key" content="">
</head>
<body>

<div id="offline-banner">You're offline — messages cannot be sent until your connection is restored.</div>

<!-- ── Main app shell (data-app-tier set by boot script) ── -->
<div id="app">

  <!-- Header -->
  <header id="app-header">
    <button id="sidebar-toggle" aria-label="Open menu">
      <span></span><span></span><span></span>
    </button>
    <div id="header-center">
      <div class="wordmark">Text Boss</div>
      <div class="section-label" id="section-label">Chat</div>
    </div>
    <button id="header-action" aria-label="New chat">+</button>
  </header>

  <!-- Thread chip strip (Chat section only) -->
  <div id="thread-chips" style="display:none;"></div>

  <!-- Hidden threads-list (used by app-client.js internally) -->
  <div id="threads-list" aria-hidden="true"></div>

  <!-- Content area -->
  <main id="content-area">

    <!-- Chat section -->
    <div class="section-panel active" id="panel-chat">
      <div id="app-output" id="chat-thread"></div>
      <div id="input-bar">
        <form id="chat-form" autocomplete="off">
          <textarea
            id="chat-message"
            placeholder="Describe the situation..."
            rows="1"
            maxlength="4000"
          ></textarea>
          <button type="submit" id="chat-submit" aria-label="Send">
            <svg viewBox="0 0 24 24"><path d="M2 12L22 2 12 22 10 14z"/></svg>
          </button>
        </form>
        <div id="char-count"></div>
        <div id="app-status"></div>
      </div>
    </div>

    <!-- Schedule section (Pro/Black) -->
    <div class="section-panel" id="panel-schedule">
      <div class="sched-sub-tabs">
        <div class="sched-sub-tab active" data-sched="chat">AI Chat</div>
        <div class="sched-sub-tab" data-sched="calendar">Calendar</div>
        <div class="sched-sub-tab" data-sched="settings">Settings</div>
      </div>

      <!-- AI Chat sub-panel -->
      <div class="sched-sub-panel active" id="sched-chat-panel">
        <div id="sched-thread" style="flex:1;overflow-y:auto;padding:12px;"></div>
        <div id="input-bar" style="padding:8px 12px;padding-bottom:calc(8px + env(safe-area-inset-bottom));background:var(--panel);border-top:1px solid var(--border);">
          <form id="sched-form" autocomplete="off" style="display:flex;gap:8px;align-items:flex-end;">
            <textarea id="sched-message" placeholder="Tell me what to book..." rows="1"
              style="flex:1;background:var(--surface);border:1px solid var(--border-hi);border-radius:20px;padding:10px 16px;font-size:14px;color:var(--text);resize:none;max-height:120px;outline:none;font-family:inherit;"></textarea>
            <button type="submit"
              style="width:40px;height:40px;border-radius:50%;background:var(--accent);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:#0a0d10;"><path d="M2 12L22 2 12 22 10 14z"/></svg>
            </button>
          </form>
        </div>
      </div>

      <!-- Calendar sub-panel -->
      <div class="sched-sub-panel" id="sched-calendar-panel" style="overflow-y:auto;padding:12px;">
        <!-- Populated by scheduler-client.js -->
        <div id="cal-month-label" style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:8px;"></div>
        <div id="cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;"></div>
        <div id="day-detail" style="margin-top:12px;"></div>
      </div>

      <!-- Scheduler settings sub-panel -->
      <div class="sched-sub-panel" id="sched-settings-panel" style="overflow-y:auto;padding:12px;">
        <!-- Working hours and availability — populated by scheduler-client.js -->
        <div id="wh-list"></div>
        <form id="wh-add-form" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <select name="wh-day" style="background:var(--surface);border:1px solid var(--border-hi);border-radius:8px;padding:6px;color:var(--text);font-size:13px;">
            <option value="1">Mon</option><option value="2">Tue</option>
            <option value="3">Wed</option><option value="4">Thu</option>
            <option value="5">Fri</option><option value="6">Sat</option>
            <option value="0">Sun</option>
          </select>
          <input type="time" name="wh-start" style="background:var(--surface);border:1px solid var(--border-hi);border-radius:8px;padding:6px;color:var(--text);font-size:13px;">
          <input type="time" name="wh-end" style="background:var(--surface);border:1px solid var(--border-hi);border-radius:8px;padding:6px;color:var(--text);font-size:13px;">
          <button type="submit" style="background:var(--accent);color:#0a0d10;border:none;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;">Add</button>
        </form>
        <div id="svc-list" style="margin-top:16px;"></div>
        <div id="booking-link-section" style="margin-top:16px;"></div>
        <!-- ICS import -->
        <div id="import-status" style="font-size:12px;color:var(--muted);margin-top:8px;"></div>
        <div style="margin-top:12px;">
          <label style="font-size:13px;color:var(--muted);display:block;margin-bottom:6px;">Import .ics calendar</label>
          <input type="file" id="ical-import-file" accept=".ics" style="display:none;">
          <button id="ical-import-btn" style="background:var(--surface);border:1px solid var(--border-hi);border-radius:8px;padding:8px 14px;font-size:13px;color:var(--muted);cursor:pointer;">Choose .ics file</button>
        </div>
        <div id="busy-block-list" style="margin-top:12px;"></div>
        <!-- Notification prompt -->
        <div id="notify-prompt" style="display:none;margin-top:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;">
          <p style="font-size:13px;color:var(--text);margin-bottom:8px;">Get reminders before your appointments.</p>
          <div style="display:flex;gap:8px;">
            <button id="notify-enable" style="background:var(--accent);color:#0a0d10;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;">Enable</button>
            <button id="notify-dismiss" style="background:none;border:1px solid var(--border-hi);border-radius:8px;padding:8px 14px;font-size:13px;color:var(--muted);cursor:pointer;">Dismiss</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Prompts section (Pro/Black) -->
    <div class="section-panel" id="panel-prompts">
      <div id="prompts-search-bar">
        <input id="prompts-search" type="search" placeholder="Search 100 templates...">
      </div>
      <div id="prompts-cat-strip"></div>
      <div id="prompts-list"></div>
    </div>

    <!-- Threads section -->
    <div class="section-panel" id="panel-threads">
      <div id="threads-search-bar">
        <input id="threads-search" type="search" placeholder="Search threads...">
      </div>
      <div id="threads-full-list"></div>
    </div>

    <!-- Settings section -->
    <div class="section-panel" id="panel-settings">
      <div id="settings-scroll" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;">
        <div class="settings-group">
          <div class="settings-group-title">Your Profile</div>
          <div class="settings-row">
            <label>First name</label>
            <input type="text" id="settings-fname" placeholder="Alex">
          </div>
          <div class="settings-row">
            <label>Business name</label>
            <input type="text" id="settings-biz" placeholder="Bright Studio">
          </div>
          <div class="settings-row">
            <label>Phone</label>
            <input type="tel" id="settings-phone" placeholder="04xx xxx xxx">
          </div>
          <div class="settings-row">
            <label>ABN (optional)</label>
            <input type="text" id="settings-abn" placeholder="12 345 678 901">
          </div>
          <div class="settings-row">
            <label>Location (optional)</label>
            <input type="text" id="settings-location" placeholder="Melbourne">
          </div>
        </div>
        <button class="settings-save-btn" id="settings-save">Save profile</button>
        <div id="settings-status" style="font-size:12px;color:var(--muted);text-align:center;"></div>

        <div class="settings-group">
          <div class="settings-group-title">Subscription</div>
          <div class="settings-row">
            <label>Tier</label>
            <div><span class="tier-badge-settings" id="tier-badge">—</span></div>
          </div>
        </div>

        <button class="sign-out-btn" id="logout-button">Sign out</button>
      </div>
    </div>

  </main>
</div>

<!-- ── Drawer ── -->
<nav id="threads-sidebar" role="dialog" aria-label="Navigation">
  <div class="drawer-header">
    <span class="drawer-wordmark">TEXT BOSS</span>
    <span class="drawer-tier" id="drawer-tier">—</span>
    <button id="sidebar-close" aria-label="Close menu">×</button>
  </div>
  <div class="drawer-nav" id="drawer-nav">
    <div class="drawer-nav-item active" data-section="chat">
      <span class="nav-icon">💬</span><span class="nav-label">Chat</span>
    </div>
    <div class="drawer-nav-item pro-only" data-section="schedule" style="display:none;">
      <span class="nav-icon">📅</span><span class="nav-label">Schedule</span>
    </div>
    <div class="drawer-nav-item pro-only" data-section="prompts" style="display:none;">
      <span class="nav-icon">📋</span><span class="nav-label">Prompts</span>
    </div>
    <div class="drawer-nav-item" data-section="threads">
      <span class="nav-icon">🗂️</span><span class="nav-label">Threads</span>
    </div>
    <div class="drawer-divider"></div>
    <div class="drawer-nav-item" data-section="settings">
      <span class="nav-icon">⚙️</span><span class="nav-label">Settings</span>
    </div>
  </div>
  <div class="drawer-footer">
    <div style="font-size:12px;color:var(--muted);" id="drawer-email"></div>
  </div>
</nav>

<!-- Dim overlay -->
<div id="sidebar-backdrop"></div>

<!-- Onboarding wizard (scheduler-client.js manages this) -->
<div class="wizard-overlay hidden" id="wizard-overlay">
  <div class="wizard">
    <div class="wizard-header">
      <div class="wizard-step-indicator" id="wizard-steps"></div>
      <h2 id="wizard-title"></h2>
      <p class="wizard-sub" id="wizard-sub"></p>
    </div>
    <div class="wizard-body" id="wizard-body"></div>
    <div class="wizard-footer">
      <button class="wizard-next" id="wizard-next">Next</button>
    </div>
  </div>
</div>

<script src="/app-client.js"></script>
<script src="/scheduler-client.js"></script>
<script>
(function () {
  const PRO_TIERS = new Set(['Pro', 'Black']);
  let currentSection = 'chat';
  let appTier = null;
  let appEmail = null;
  let schedulerInitialised = false;
  let promptsLoaded = false;

  // ── Boot: verify session ──────────────────────────────────────────────────
  async function boot() {
    try {
      const res = await fetch('/.netlify/functions/session-verify', { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.ok) { window.location.href = '/access.html'; return; }
      appTier  = data.tier;
      appEmail = data.email;
      applyTier(appTier, appEmail);
      initShell();
    } catch (e) {
      // Network error — if service worker has cached app shell we're here offline
      handleOffline();
    }
  }

  function applyTier(tier, email) {
    const app = document.getElementById('app');
    app.setAttribute('data-app-tier', tier);
    app.setAttribute('data-tier', tier);
    app.setAttribute('data-input-limit', tier === 'Black' ? 8000 : tier === 'Pro' ? 6000 : 4000);

    document.getElementById('drawer-tier').textContent = tier;
    document.getElementById('tier-badge').textContent  = tier;
    document.getElementById('drawer-email').textContent = email || '';
    document.title = `Text Boss · ${tier}`;

    if (PRO_TIERS.has(tier)) {
      document.querySelectorAll('.pro-only').forEach(el => el.style.display = '');
      document.getElementById('prompts-search').placeholder = `Search ${tier === 'Black' ? '150' : '100'} templates...`;
    }
  }

  // ── Shell init ────────────────────────────────────────────────────────────
  function initShell() {
    initDrawer();
    initSectionNav();
    initThreadChips();
    initOfflineBanner();
    // Load settings profile if saved
    loadSettingsProfile();
    // app-client.js boots itself via its own IIFE — no call needed
  }

  // ── Drawer ────────────────────────────────────────────────────────────────
  function initDrawer() {
    const toggle   = document.getElementById('sidebar-toggle');
    const drawer   = document.getElementById('threads-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const closeBtn = document.getElementById('sidebar-close');

    function openDrawer() {
      drawer.classList.add('open');
      backdrop.classList.add('visible');
      document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
      drawer.classList.remove('open');
      backdrop.classList.remove('visible');
      document.body.style.overflow = '';
    }

    toggle.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
  }

  // ── Section navigation ────────────────────────────────────────────────────
  function initSectionNav() {
    document.querySelectorAll('.drawer-nav-item[data-section]').forEach(item => {
      item.addEventListener('click', () => {
        switchSection(item.dataset.section);
        // Close drawer
        document.getElementById('threads-sidebar').classList.remove('open');
        document.getElementById('sidebar-backdrop').classList.remove('visible');
        document.body.style.overflow = '';
      });
    });

    // Schedule sub-tabs
    document.querySelectorAll('.sched-sub-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sched-sub-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sched-sub-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('sched-' + tab.dataset.sched + '-panel').classList.add('active');
      });
    });
  }

  function switchSection(section) {
    currentSection = section;

    // Update section label in header
    const labels = { chat: 'Chat', schedule: 'Schedule', prompts: 'Prompts', threads: 'Threads', settings: 'Settings' };
    document.getElementById('section-label').textContent = labels[section] || section;

    // Toggle header action button (+)
    const headerAction = document.getElementById('header-action');
    headerAction.classList.toggle('hidden', section !== 'chat' && section !== 'threads');

    // Toggle thread chip strip
    document.getElementById('thread-chips').style.display = section === 'chat' ? 'flex' : 'none';

    // Switch panels
    document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('panel-' + section);
    if (target) target.classList.add('active');

    // Update drawer active state
    document.querySelectorAll('.drawer-nav-item[data-section]').forEach(item => {
      item.classList.toggle('active', item.dataset.section === section);
    });

    // Lazy-init Schedule and Prompts
    if (section === 'schedule' && !schedulerInitialised && PRO_TIERS.has(appTier)) {
      schedulerInitialised = true;
      const inputLimit = appTier === 'Black' ? 8000 : 6000;
      window.initScheduler({ tier: appTier, inputLimit, enableIcalExport: true });
    }
    if (section === 'prompts' && !promptsLoaded) {
      promptsLoaded = true;
      initPromptsSection();
    }
    if (section === 'threads') {
      renderThreadsList('');
    }
  }

  // Header + button
  document.getElementById('header-action').addEventListener('click', () => {
    if (currentSection === 'chat' || currentSection === 'threads') {
      document.getElementById('new-chat-button') && document.getElementById('new-chat-button').click();
    }
  });

  // ── Thread chip strip ─────────────────────────────────────────────────────
  function initThreadChips() {
    const threadsList = document.getElementById('threads-list');
    const chipsStrip  = document.getElementById('thread-chips');

    function renderChips() {
      const items = threadsList.querySelectorAll('[data-thread-id]');
      chipsStrip.innerHTML = '';
      items.forEach(item => {
        const chip = document.createElement('div');
        chip.className = 'thread-chip' + (item.classList.contains('active') ? ' active' : '');
        chip.textContent = item.querySelector('.thread-name')?.textContent || item.dataset.threadId;
        chip.dataset.threadId = item.dataset.threadId;
        chip.addEventListener('click', () => item.click());
        chipsStrip.appendChild(chip);
      });
      // + New chip
      const newChip = document.createElement('div');
      newChip.className = 'thread-chip';
      newChip.textContent = '+ New';
      newChip.addEventListener('click', () => document.getElementById('new-chat-button')?.click());
      chipsStrip.appendChild(newChip);
    }

    // Watch threads-list for mutations (app-client.js updates it)
    const observer = new MutationObserver(renderChips);
    observer.observe(threadsList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    renderChips();
  }

  // ── Threads section ───────────────────────────────────────────────────────
  function renderThreadsList(query) {
    const threadsList = document.getElementById('threads-list');
    const fullList    = document.getElementById('threads-full-list');
    const items       = Array.from(threadsList.querySelectorAll('[data-thread-id]'));
    const q = query.toLowerCase();

    fullList.innerHTML = '';
    const filtered = items.filter(item => !q || item.textContent.toLowerCase().includes(q));

    if (filtered.length === 0) {
      fullList.innerHTML = '<p style="padding:20px;color:var(--muted);font-size:14px;text-align:center;">No threads yet.</p>';
      return;
    }

    filtered.forEach(item => {
      const name    = item.querySelector('.thread-name')?.textContent || 'Thread';
      const preview = item.querySelector('.thread-preview')?.textContent || '';
      const time    = item.querySelector('.thread-time')?.textContent || '';
      const row = document.createElement('div');
      row.className = 'thread-row';
      row.innerHTML = `
        <div class="thread-row-top">
          <span class="thread-row-name">${name}</span>
          <span class="thread-row-time">${time}</span>
        </div>
        <div class="thread-row-preview">${preview}</div>
      `;
      row.addEventListener('click', () => {
        item.click();
        switchSection('chat');
      });
      fullList.appendChild(row);
    });
  }

  document.getElementById('threads-search').addEventListener('input', e => {
    renderThreadsList(e.target.value);
  });

  // ── Prompts section ───────────────────────────────────────────────────────
  async function initPromptsSection() {
    const list = document.getElementById('prompts-list');
    list.innerHTML = '<p style="padding:20px;color:var(--muted);text-align:center;">Loading...</p>';

    let data;
    try {
      const res = await fetch('/prompts-data.json');
      data = await res.json();
    } catch (e) {
      list.innerHTML = '<p style="padding:20px;color:var(--muted);text-align:center;">Could not load templates.</p>';
      return;
    }

    // Category chips
    const catStrip = document.getElementById('prompts-cat-strip');
    let activeCat = 'All';
    const allChip = document.createElement('div');
    allChip.className = 'cat-chip active';
    allChip.textContent = 'All';
    allChip.dataset.cat = 'All';
    catStrip.appendChild(allChip);

    data.categories.forEach(cat => {
      const chip = document.createElement('div');
      chip.className = 'cat-chip';
      chip.textContent = cat;
      chip.dataset.cat = cat;
      catStrip.appendChild(chip);
    });

    catStrip.addEventListener('click', e => {
      const chip = e.target.closest('.cat-chip');
      if (!chip) return;
      activeCat = chip.dataset.cat;
      catStrip.querySelectorAll('.cat-chip').forEach(c => c.classList.toggle('active', c === chip));
      renderPrompts(data, activeCat, '');
      document.getElementById('prompts-search').value = '';
    });

    document.getElementById('prompts-search').addEventListener('input', e => {
      renderPrompts(data, activeCat, e.target.value);
    });

    renderPrompts(data, 'All', '');
  }

  function renderPrompts(data, cat, query) {
    const list = document.getElementById('prompts-list');
    list.innerHTML = '';
    const q = query.toLowerCase();

    const cats = cat === 'All' ? data.categories : [cat];
    cats.forEach(c => {
      const prompts = (data.prompts[c] || []).filter(p =>
        !q || p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q)
      );
      if (prompts.length === 0) return;

      if (cat === 'All') {
        const heading = document.createElement('div');
        heading.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:8px 0 4px;';
        heading.textContent = c;
        list.appendChild(heading);
      }

      prompts.forEach(p => {
        const card = document.createElement('div');
        card.className = 'prompt-card-mobile';
        const bodyHtml = p.body.replace(/\{\{([^}]+)\}\}/g, '<span class="var-highlight">{{$1}}</span>');
        card.innerHTML = `
          <div class="prompt-card-mobile-head">
            <span class="prompt-num">${p.num}</span>
            <h4>${p.title}</h4>
            <span class="expand-icon">▾</span>
          </div>
          <div class="prompt-card-mobile-body">
            <div class="prompt-text">${bodyHtml}</div>
            <div class="prompt-actions">
              <button class="prompt-copy-btn">Copy to clipboard</button>
              <button class="prompt-send-btn">Send to Chat</button>
            </div>
          </div>
        `;
        card.querySelector('.prompt-card-mobile-head').addEventListener('click', () => {
          card.classList.toggle('expanded');
        });
        card.querySelector('.prompt-copy-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          await navigator.clipboard.writeText(p.body);
          const btn = card.querySelector('.prompt-copy-btn');
          btn.textContent = 'Copied!';
          setTimeout(() => btn.textContent = 'Copy to clipboard', 1500);
        });
        card.querySelector('.prompt-send-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          const chatInput = document.getElementById('chat-message');
          if (chatInput) {
            chatInput.value = p.body;
            chatInput.dispatchEvent(new Event('input'));
            switchSection('chat');
          }
        });
        list.appendChild(card);
      });
    });

    if (list.children.length === 0) {
      list.innerHTML = '<p style="padding:20px;color:var(--muted);text-align:center;">No templates match.</p>';
    }
  }

  // ── Settings profile ──────────────────────────────────────────────────────
  function loadSettingsProfile() {
    const saved = JSON.parse(localStorage.getItem('tb_profile') || '{}');
    if (saved.fname)    document.getElementById('settings-fname').value    = saved.fname;
    if (saved.biz)      document.getElementById('settings-biz').value      = saved.biz;
    if (saved.phone)    document.getElementById('settings-phone').value    = saved.phone;
    if (saved.abn)      document.getElementById('settings-abn').value      = saved.abn;
    if (saved.location) document.getElementById('settings-location').value = saved.location;
  }

  document.getElementById('settings-save').addEventListener('click', () => {
    const profile = {
      fname:    document.getElementById('settings-fname').value.trim(),
      biz:      document.getElementById('settings-biz').value.trim(),
      phone:    document.getElementById('settings-phone').value.trim(),
      abn:      document.getElementById('settings-abn').value.trim(),
      location: document.getElementById('settings-location').value.trim(),
    };
    localStorage.setItem('tb_profile', JSON.stringify(profile));
    const status = document.getElementById('settings-status');
    status.textContent = 'Profile saved.';
    setTimeout(() => status.textContent = '', 2000);
  });

  // ── Offline banner ────────────────────────────────────────────────────────
  function initOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    window.addEventListener('online',  () => banner.classList.remove('visible'));
    window.addEventListener('offline', () => banner.classList.add('visible'));
    if (!navigator.onLine) banner.classList.add('visible');
  }

  function handleOffline() {
    document.getElementById('offline-banner').classList.add('visible');
  }

  // ── Service Worker registration ───────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  boot();
}());
</script>
</body>
</html>
```

- [ ] **Step 2: Load app.html locally and verify session redirect works**

```bash
npx netlify dev
```

Open `http://localhost:8888/app.html` — should redirect to `/access.html` if not logged in.

- [ ] **Step 3: Commit**

```bash
git add app.html
git commit -m "feat: add app.html PWA mobile shell with drawer nav and section routing"
```

---

## Task 7: sw.js — app shell caching

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Review current sw.js**

```bash
head -40 sw.js
```

Note the current cache name and any existing `install`/`fetch` handlers.

- [ ] **Step 2: Add app shell caching**

At the top of `sw.js`, add or update the install handler. If a `CACHE_NAME` constant already exists, increment its version number. Add the following — merge with existing code rather than replacing it:

```js
const APP_SHELL_CACHE = 'tb-shell-v1';
const APP_SHELL_FILES = [
  '/app.html',
  '/app-mobile.css',
  '/app-client.js',
  '/scheduler-client.js',
  '/prompts-data.json',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== APP_SHELL_CACHE && k.startsWith('tb-shell-')).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Add to existing fetch handler — serve shell from cache when offline
// Wrap existing fetch logic or add before it:
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Skip non-GET and API calls
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  // Serve app shell from cache if offline
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request).then(r => r || caches.match('/app.html')))
  );
});
```

**Note:** If `sw.js` already has a `fetch` event listener, wrap or merge — do not duplicate the event listener.

- [ ] **Step 3: Verify sw.js is valid JS**

```bash
node --input-type=module < sw.js 2>&1 | head -5
```

Expected: no syntax errors (some `self` reference errors are expected in Node — that's fine, it just means the service worker globals aren't available in Node).

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "feat: extend sw.js to cache app shell for offline load"
```

---

## Task 8: Manual testing checklist

This task is performed in a real browser — no automated tests for PWA install behaviour.

- [ ] **Step 1: Serve locally**

```bash
npx netlify dev
```

- [ ] **Step 2: Login and verify redirect**

Open `http://localhost:8888/access.html`, log in with a test email. Verify browser redirects to `/app.html` (not `/app-pro.html` etc.).

- [ ] **Step 3: Verify tier theming**

Check the accent colour matches the logged-in tier:
- Core account → amber header action, amber send button, amber active chip
- Pro account → cyan
- Black account → purple

- [ ] **Step 4: Verify drawer**

Tap hamburger → drawer slides in. Tap overlay → closes. Tap a nav item → section switches, drawer closes.

- [ ] **Step 5: Verify thread chips**

Start a new chat → thread appears as chip below header. Switch threads via chips. Active chip highlighted in tier accent.

- [ ] **Step 6: Verify Prompts section**

Open Prompts → templates load. Type in search → list filters. Tap a category chip → filters by category. Tap a card → expands. Tap "Copy to clipboard" → text copied. Tap "Send to Chat" → input field populated, section switches to Chat.

- [ ] **Step 7: Verify Schedule section (Pro/Black)**

Open Schedule → AI Chat sub-tab active. Send a scheduling message → response appears. Switch to Calendar sub-tab → calendar renders. Switch to Settings sub-tab → availability form renders.

- [ ] **Step 8: Verify Settings**

Open Settings → profile form present. Enter name/business → save → reload → values persist (localStorage).

- [ ] **Step 9: Verify offline**

In Chrome DevTools → Network → Offline. Refresh `app.html` → shell loads from service worker cache. Offline banner visible. Chat input disabled.

- [ ] **Step 10: Install on iOS Safari (16.4+)**

Open `http://<local-ip>:8888/app.html` on iPhone. Tap Share → Add to Home Screen. Launch from home screen → opens standalone (no Safari chrome). Verify all sections work.

- [ ] **Step 11: Verify push notifications regression**

Trigger a test push notification (existing mechanism) → notification still appears. `sw.js` push handler was not broken by app shell changes.

- [ ] **Step 12: Commit test sign-off**

```bash
git commit --allow-empty -m "test: manual PWA testing complete"
```
