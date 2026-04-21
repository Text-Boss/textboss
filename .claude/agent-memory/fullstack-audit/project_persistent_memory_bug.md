---
name: Persistent Memory Tier Misattribution
description: Persistent scheduling memory is Black-only in code but listed as Pro+Black in marketing — a HIGH severity misrepresentation
type: project
---

"Persistent scheduling memory" is strictly **Black-only** in `schedule-chat.js` (line 492: `isBlack && getMemory`, line 508: `isBlack ? [...SCHEDULING_TOOLS, REMEMBER_TOOL] : SCHEDULING_TOOLS`). The `remember` tool and `=== MEMORY ===` injection never happen for Pro.

However `index.html` lists it as a Pro+Black feature in three places:
- The "What you get" feature grid (badge reads "Pro + Black")
- The comparison table row (Pro column shows ✓)
- The Pro pricing card `price-includes` list

**Why:** Probably a copy decision made before the code drew the Black-only line, or a misreading of "conversation threads persist" as "memory persists."

**How to apply:** When touching index.html, pro.html, or schedule-chat.js, always verify this distinction. If a feature request comes in to add memory to Pro, note the marketing already claims it — fixing marketing is the current gap. Do not "fix" the code to give Pro memory without explicit business decision.
