# Text Boss — Mobile PWA Shell

**Date:** 2026-04-18
**Scope:** Phase 1 of 3 (PWA shell → Biometric auth → Calendar sync)
**Status:** Approved for implementation

---

## Goal

Turn Text Boss into an installable Progressive Web App that delivers a proper mobile-first experience for subscribers. The existing desktop app pages stay untouched. The mobile shell is a clean, intentional redesign — not a CSS patch on top of the current ad-hoc layout.

---

## Approach

**Approach B — New `app.html` mobile shell, reuse existing JS logic.**

One new entry point (`app.html`) serves all tiers and all screen sizes. It reads the session cookie on load, verifies the tier, and renders the correct experience. The existing `app-core.html`, `app-pro.html`, and `app-black.html` are left as-is.

---

## Files

### New
| File | Purpose |
|---|---|
| `app.html` | PWA entry point — mobile-first shell, all tiers |
| `app-mobile.css` | All mobile-specific styles (drawer, header, touch targets, safe areas) |
| `manifest.json` | PWA manifest — name, icons, theme colour, `display: standalone` |

### Enhanced
| File | Change |
|---|---|
| `sw.js` | Extended to cache the app shell for offline load |

### Reused unchanged
| File | Role |
|---|---|
| `app-client.js` | Chat logic, thread management, OpenAI integration |
| `scheduler-client.js` | Scheduler UI, calendar, availability |
| `netlify/functions/*` | All backend — untouched |
| `access.html` | Login entry point — redirects to `app.html` after auth |

---

## PWA Configuration

### manifest.json
```json
{
  "name": "Text Boss",
  "short_name": "TextBoss",
  "start_url": "/app.html",
  "display": "standalone",
  "background_color": "#0a0d10",
  "theme_color": "#0a0d10",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Service Worker (sw.js enhancements)
- Cache the app shell on install: `app.html`, `app-mobile.css`, `app-client.js`, `scheduler-client.js`, `manifest.json`
- Serve cached shell on offline load
- Network-first strategy for API calls (`/.netlify/functions/*`) — fail gracefully with an offline message if no network

---

## Login Flow

1. User visits `access.html`, enters email
2. `verify-email` sets `textboss_session` cookie (existing behaviour — unchanged)
3. `access.html` redirects to `/app.html` (changed from tier-specific page)
4. `app.html` calls `GET /.netlify/functions/session-verify` on load
5. If invalid/expired → redirect to `access.html`
6. If valid → read `tier` from response, apply tier theme, render correct sections

---

## Shell Structure

### Header (always visible)
- Left: hamburger button (opens drawer)
- Centre: "TEXT BOSS" wordmark + current section name below it
- Right: context action button (+ new thread on Chat; empty on other sections)

### Drawer (slides in from left)
- Triggered by hamburger or left-edge swipe
- Shows: tier badge (Core / Pro / Black), nav items, sign out at bottom
- Dim overlay behind drawer — tap to close
- Nav items: **Chat · Schedule · Prompts · Threads · Settings**
  - Schedule and Prompts hidden for Core tier (gated server-side and client-side)

### Thread Strip (Chat section only)
- Horizontal scrolling chip row below the header
- One chip per thread, active chip highlighted in tier accent colour
- Rightmost chip: "+ New"
- Tapping a chip switches the active thread

### Content Area
- Full height between header and input bar
- Section-specific (see Section Designs below)

### Input Bar (Chat and Schedule sections)
- Pinned to bottom
- `padding-bottom: env(safe-area-inset-bottom)` for iPhone home indicator clearance
- Pill-shaped input field, send button in tier accent colour

---

## Tier Theming

Each tier sets a single CSS custom property (`--accent`) on load. All accent-coloured elements (send button, active drawer item, thread chips, active sub-tab underline) inherit it automatically.

| Tier | Accent | Value |
|---|---|---|
| Core | Amber | `#f59e0b` |
| Pro | Cyan | `#06b6d4` |
| Black | Purple | `#a855f7` |

Base colours (shared): background `#0a0d10`, panel `#0d1014`, surface `#1a1d22`, border `#1e2530`, muted text `#6b7280`.

---

## Section Designs

### Chat
- Thread chips scrollable strip below header
- Full-height message list (user messages right-aligned, AI responses left-aligned)
- Pill input bar pinned to bottom
- Tapping a thread chip switches threads without leaving the section

### Schedule (Pro / Black only)
Three sub-tabs below the header:
- **AI Chat** (default) — conversational scheduler interface
- **Calendar** — weekly calendar view, appointments shown as blocks
- **Settings** — availability hours, buffer times, booking link, ICS import

### Prompts (Pro / Black only)
- Search bar below header
- Horizontal scrolling category filter chips (All, Scheduling, Payments, Scope, Follow-up, etc.)
- Scrollable list of prompt cards — title, truncated preview, Copy button
- Tap a card → expands to full template with auto-filled variables from profile
- Two actions on expanded card: **Copy to clipboard** and **Send to Chat** (pastes into active thread)
- Templates extracted from `pro_subscriber_prompts.html` into a static `prompts-data.json` file once during implementation — no iframe
- Profile nudge shown if `{{CLIENT_NAME}}` etc. are not yet filled in

### Threads
- Search bar below header
- Full list of threads, sorted most-recent first
- Each row: thread name, timestamp, last message preview
- Tap → jumps to that thread in the Chat section
- + button in header starts a new thread

### Settings
- Profile fields (name, business, phone, ABN, location)
- Tier info + subscription status
- Notification preferences (push on/off)
- Sign out

---

## Error & Offline Handling

| Scenario | Behaviour |
|---|---|
| Session expired on load | Redirect to `access.html` |
| API call fails (online) | Show inline error below message, allow retry |
| No network (offline) | App shell loads from cache; chat shows "You're offline" banner — messages cannot be sent until network is restored |
| Tier mismatch (Schedule/Prompts for Core) | Drawer items hidden; direct URL access redirected to Chat |

---

## Testing

- Load `app.html` on iOS Safari (16.4+) and Android Chrome
- Install to home screen on both platforms — verify standalone launch, no browser chrome
- Verify amber/cyan/purple theming per tier
- Verify drawer open/close, dim overlay, swipe to close
- Verify thread chips scroll and switch correctly
- Verify Prompts search and category filter
- Verify "Send to Chat" pastes into active thread
- Verify offline shell loads after killing network
- Verify push notifications still fire (sw.js regression check)
