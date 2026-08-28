# WebMCP Challenge — Submission Checklist

Deadline: **Sep 3, 2026, 1:00 PM PT** (= Sep 4, 4:00 AM Taiwan time).

| Devpost requirement | Status | Where |
|---|---|---|
| Working live URL (opens in ChatGPT browser / Chrome 149+) | ⬜ deploy | `make deploy-netlify` / `deploy-vercel` / `deploy-cloudflare` (login once, then one command) |
| Public code repo | ⬜ push | `gh repo create agentready --public --source=. --push` |
| Open source license | ✅ | `LICENSE` (MIT) |
| Project description | ⬜ paste | Use README pitch + the "Why this matters" table; mention `document.modelContext`, synthesized tools, annotations, `getTools()/executeTool()` |
| Demo video ≤ 3:00 with audio, public on YouTube | ⬜ record | `docs/VIDEO_SCRIPT.md` |
| Testing instructions + credentials (if login wall) | ➖ n/a | Demo needs no login — state that on the form |

## Pre-submission verification (30 minutes)

1. **Deploy** the demo (self-contained `demo/store/`).
2. Open the deployed URL in **Chrome 149+** with `chrome://flags/#enable-webmcp-testing`:
   - Inspector badge shows the tool count; console logs `Native WebMCP: yes`.
   - Run one ChatGPT task end-to-end (search → cart → checkout approval).
3. Open the same URL in the **ChatGPT desktop app** in-app browser — same behavior.
4. Open the **test page** (`/test-page/` route) — status shows `native document.modelContext`.
5. Confirm the repo renders on GitHub (README, LICENSE visible).

## Judging criteria mapping

- **WebMCP Leverage** — `registerTool`, dynamic re-registration, JSON Schemas,
  `readOnlyHint`/`untrustedContentHint`, `getTools()`/`executeTool()` in-page parity.
- **Execution** — one-file runtime, demo store, test page, 43 automated tests, Makefile CI.
- **Potential Impact** — any existing site becomes agent-ready with one script tag.
- **Creativity & Ambition** — semantic refs, human-in-the-loop safety, agent interoperability.