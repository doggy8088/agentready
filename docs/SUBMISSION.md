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
4. Open the **test page** on the local server (`bun run demo` → `http://localhost:8788/demo/test-page/`) — status shows `native document.modelContext`. (The deploy publishes only the store, so `/test-page/` is not on the deployed URL — verify the deployed site against the store flow in steps 2–3.)
5. Confirm the repo renders on GitHub (README, LICENSE visible).

## Judging criteria mapping

- **WebMCP Leverage** — `registerTool`, dynamic re-registration, JSON Schemas,
  `readOnlyHint`/`untrustedContentHint`, `getTools()`/`executeTool()` in-page parity.
- **Execution** — one-file runtime, demo store, test page, 108 automated tests (88 unit + 20 E2E), Makefile CI.
- **Potential Impact** — any existing site becomes agent-ready with one script tag.
- **Creativity & Ambition** — semantic refs, human-in-the-loop safety, agent interoperability.

## Publishing to npm (`@willh/agentready`)

The release workflow publishes on `v*` tags: build → typecheck/unit/E2E gates → GitHub Release → npm with provenance. One-time setup:

1. Confirm the npm scope: if `willh` is your npm username, `@willh` works automatically; otherwise create the `willh` org on npmjs.com (Settings → Organizations) and ensure the publishing account is a member.
2. `npm login` in the account that will publish; create an automation token (`npm token create`).
3. Add the token as the `NPM_TOKEN` secret on the GitHub repo (Settings → Secrets and variables → Actions).
4. Tag: `make release-tag TAG=v0.1.1` — the workflow builds, tests, GitHub-Releases, then npm-publishes.
5. After publish: verify `https://www.npmjs.com/package/@willh/agentready` and that jsdelivr resolves the new version.