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

1. Prerequisite: if `willh` is not your npm username, create the `willh` organization on npmjs.com (Settings → Organizations) and ensure your account is a member — otherwise the scoped publish will be rejected.
   One-time bootstrap — the package must exist before trusted publishing can be configured (npm limitation): from the repo root, `bun run build && bun run build:min && bun run build:types`, then `npm login` (browser login; no stored token), then `npm publish --access public` (publishes 0.1.0; provenance starts with the first trusted publish, since provenance requires CI).
2. One-time trusted-publisher link — on npmjs.com, open `@willh/agentready` → package Settings → Publishing access → Add trusted publisher: Provider GitHub, Organization `doggy8088`, Repository `agentready`, Workflow filename `release.yml`, Environment (optional — if set, also create that GitHub environment and add it to the `publish-npm` job with `environment: <name>`).
3. No npm token secret is needed at all (that's the point).
4. Subsequent releases: `npm version patch` (or minor/major) → `git push origin main --follow-tags` (or `make release-tag TAG=vX.Y.Z`) — the workflow gates on the full suite, creates the GitHub Release, then publishes via OIDC with provenance.
5. Verify after first trusted publish: the package page (`https://www.npmjs.com/package/@willh/agentready`) shows the new version with provenance, and jsdelivr resolves it.

Note: the scoped package requires `--access public` on the first publish — already in the workflow.