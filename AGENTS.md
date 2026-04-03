\# AGENTS.md



\## Project

Text Boss



\## Project rules

\- Never hardcode secrets

\- Keep Netlify Functions under netlify/functions/

\- Preserve existing public pages unless intentionally replacing them

\- Prefer minimal, production-safe changes

\- Do not break index.html, core.html, pro.html, or black.html unless replacing them intentionally

\- Use Netlify Functions for backend logic

\- Use Supabase for entitlement verification

\- Use OpenAI Responses API for model calls

\- Keep Core / Pro / Black behavior strictly separated

\- Denied users must not receive business advice



\## Working method

\- Inspect the repo before changing files

\- Propose the exact file plan first

\- Edit one file at a time

\- Show diffs for each file

\- Validate each step before moving on



\## Validation requirements

\- No subscription email -> denied

\- Core email -> Core behavior

\- Pro email -> Pro behavior

\- Black email -> Black behavior

\- Session cookie must be signed and HTTP-only

\- No secrets committed to the repo

