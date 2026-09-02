# Contributing to AgentReady.js

Thank you for your interest in contributing to **AgentReady.js**!

This document provides a guide for setting up your development environment, running tests, understanding the project architecture, and creating releases.

---

## 🛠️ Prerequisites

- **[Bun](https://bun.sh)** (v1.1+ or latest)
- **Google Chrome** (v149+ for native WebMCP testing) or Chromium
- **Make** (standard on macOS and Linux)

---

## 🚀 Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/<owner>/agentready.git
   cd agentready
   ```

2. **Install dependencies:**
   ```bash
   make install
   # or: bun install
   ```

3. **Verify the entire build and test suite:**
   ```bash
   make ci
   ```

4. **Start the local development server:**
   ```bash
   make demo
   ```
   Open [http://localhost:8788/demo/store/](http://localhost:8788/demo/store/) or [http://localhost:8788/demo/test-page/](http://localhost:8788/demo/test-page/) in your browser.

---

## 📂 Project Architecture

```
src/
├── index.ts        # Entry point, boot orchestration, MutationObserver, public window.AgentReady API
├── runtime.ts      # WebMCP runtime adapter (document.modelContext / navigator.modelContext + shim)
├── semantic.ts     # DOM discovery, WeakRef stable reference pool, natural language element matching
├── policy.ts       # Safety classification (allow / confirm / never), credential redaction, token budgets
├── inspector.ts    # Shadow DOM user interface badge, activity logger, and human approval modal
└── tools/          # Core WebMCP tool implementations
    ├── page.ts     # get_page_context, find_on_page, read_target
    ├── interact.ts # activate_target, set_field, fill_form, submit_form
    ├── forms.ts    # one synthesized tool per form (JSON Schema from HTML)
    └── controls.ts # DOM value manipulation helpers

demo/
├── store/          # Reference e-commerce storefront showcasing zero-config WebMCP
└── test-page/      # Verification testbed and interactive scenario console

tests/
├── agentready.test.ts # Unit tests (happy-dom + bun:test)
└── e2e/               # End-to-end browser tests (Playwright + Chrome)
```

---

## 🧪 Development & Testing Commands

| Command | Description |
|---|---|
| `make typecheck` | Run TypeScript strict type-checking (`tsc --noEmit`) |
| `make types` | Emit TypeScript declaration files (`.d.ts`) to `dist/` |
| `make build` | Compile TypeScript and bundle `dist/agentready.js` |
| `make build-min` | Emit minified bundle `dist/agentready.min.js` |
| `make size` | Check bundle size against budget limits |
| `make test` | Run unit tests with Bun |
| `make test-e2e` | Run Playwright E2E browser tests against real Chrome |
| `make check` | Quick sanity check (typecheck + lint + test + size) |
| `make ci` | Full verification pipeline (typecheck → lint → types → build → min → unit → size → E2E) |
| `make deploy-netlify` | Deploy the demo store to Netlify (prompts for login on first run) |
| `make deploy-vercel` | Deploy the demo store to Vercel (links project on first run) |
| `make deploy-cloudflare` | Deploy the demo store to Cloudflare Pages (login on first run) |
| `make footage` | Re-capture real product footage + narration into `video/public/` |
| `make video` | Render the demo video to `video/out/agentready-demo.mp4` |
| `make studio` | Open Remotion Studio for the video project |

---

## 🔒 Safety & Policy Guidelines

When introducing new tools or modifying DOM handling:

1. **Never Expose Sensitive Information:**
   - Input elements with `type="password"`, `autocomplete="cc-*"`, or names containing `token`, `secret`, `cvv`, etc., must remain classified as `'never'`.
   - Their existence and values must never appear in schemas or search results.

2. **Always Require Human Confirmation for Destructive Actions:**
   - Actions matching destructive keywords (checkout, pay, delete, remove) or form submissions must require human approval through the on-page inspector.

3. **Respect Output Budgets:**
   - Tool outputs must be clamped to `1,500` characters using `clampOutput()` from `src/policy.ts` to protect agent context windows.

---

## 📦 Release Workflow

Releases are automated via GitHub Actions:

1. Ensure all changes are committed and `make ci` passes.
2. Tag a new semantic version (e.g. `v0.1.0`):
   ```bash
   make release-tag TAG=v0.1.0
   ```
3. GitHub Actions will automatically:
   - Run typecheck, unit and E2E tests, and build both unminified/minified bundles.
   - Generate release notes from commits.
   - Publish the release on GitHub with `agentready.js`, `agentready.min.js`, and `agentready-types.tar.gz` attached.
   - Publish `@willh/agentready` to npm with provenance (requires the `NPM_TOKEN` secret — see `docs/SUBMISSION.md`).
