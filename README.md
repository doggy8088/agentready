# AgentReady.js

> **Add one JavaScript file. Make your website agent-ready.**

AgentReady.js is a progressive-enhancement layer for the existing web. Load it with a single
`<script>` tag and it turns your site's semantic HTML — forms, navigation, buttons, app state —
into safe, structured **[WebMCP](https://webmachinelearning.github.io/webmcp/)** tools that any
WebMCP-capable agent can call directly: ChatGPT's in-app browser, Chrome 149+, or in-page agents
using the standard `getTools()` / `executeTool()` shape.

Humans keep using the same interface. Agents get a reliable interface of their own.

```html
<script src="agentready.js" defer></script>
```

Built for the **WebMCP Challenge** (Sep 2026).

---

## Why this matters

WebMCP lets a website *declare* its capabilities to agents instead of leaving them to guess
through screenshots and DOM spelunking. But rewriting millions of existing websites isn't
realistic — so AgentReady.js derives the tool layer automatically:

| Level | What the site does | What agents get |
|---|---|---|
| **0 — one script tag** | Nothing. Just load `agentready.js` | 7 core semantic tools + auto-synthesized form tools |
| **1 — HTML metadata** | Add `data-agent-*` attributes | Precise tool names, descriptions, submit policies |
| **2 — native registration** | Call `AgentReady.register({...})` | Full domain-specific tools with your own logic |

The same page then works with **any** WebMCP agent — ChatGPT, an in-page agent, or a future
client — because everything is exposed through the standard `document.modelContext` API
(with an identical in-page fallback for browsers without it).

```
            Human
              │
        ┌─────┴─────┐
        │  Website  │
        └─────┬─────┘
        AgentReady.js  (semantic discovery + policy + inspector)
              │
      document.modelContext  ← native WebMCP when available
              │
   ChatGPT browser · Chrome 149+ · in-page agents (AskPage, …)
```

---

## Quick start

### Level 0 — drop it in

```html
<script src="https://your-cdn/agentready.js" defer></script>
```

That's it. AgentReady discovers the page and registers:

| Tool | Type | Description |
|---|---|---|
| `get_page_context` | read | Semantic summary: title, headings, regions, forms, counts |
| `find_on_page` | read | Natural-language search over interactive elements → stable refs |
| `read_target` | read | Details of one ref: value, options, href, surrounding content |
| `activate_target` | write | Click buttons / links / tabs (destructive ones need human approval) |
| `set_field` | write | Set one input / select / checkbox / radio, firing real `input`+`change` events |
| `fill_form` | write | Fill a whole form by label; **never submits** |
| `submit_form` | write | Submit with **explicit human approval** in the on-page panel |
| `search_products`, `signup_form`, … | auto | One synthesized tool per semantic form, with a real JSON Schema |

Synthesized tools are derived from `aria-label` / headings / action URLs. A search form becomes
`search_products({ q, category, max_price })` — not twenty `set_input_17` primitives.

### Level 1 — add metadata (optional)

```html
<form
  method="get"
  aria-label="Product search"
  data-agent-name="search_products"
  data-agent-description="Search products in the catalog"
  data-agent-submit="auto">
  <input name="q" type="search" placeholder="Search…" />
  <select name="category">…</select>
  <button>Search</button>
</form>
```

- `data-agent-name` / `data-agent-tool` — tool name (else derived from labels/heading/action)
- `data-agent-description` — tool description
- `data-agent-submit="auto | confirm | never"` — override the submit policy
- `data-agent-hide` — exclude a field from agents entirely
- `data-agent-priority` — synthesize this form first (max 8 per page)

### Level 2 — register native tools (optional)

```html
<script>
  window.AgentReadyConfig = { siteName: 'My Store' };
</script>
<script src="agentready.js" defer></script>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    window.AgentReady.register({
      name: 'add_to_cart',
      description: 'Add a product to the shopping cart',
      inputSchema: {
        type: 'object',
        properties: { productId: { type: 'string' }, quantity: { type: 'number' } },
        required: ['productId'],
      },
      execute: ({ productId, quantity }) => cart.add(productId, quantity ?? 1),
    });
  });
</script>
```

`window.AgentReady` also exposes `getTools()`, `executeTool(name, argsJson)` and `inspect()` —
the same shapes as the WebMCP standard API — so **in-page agents work on every browser**,
even without the native API.

---

## Safety model (built in)

AgentReady treats everything on the page — and everything an agent might do — as untrusted by
default. All tools carry `untrustedContentHint`; read tools carry `readOnlyHint`. Tool output is
clamped to ~1,500 characters per call.

| Content / action | Policy |
|---|---|
| Reading page content, search, navigation | ✅ Allow |
| Filling normal form fields | ✅ Allow |
| Hidden inputs, tokens, passwords, card fields (`cc-*`, CVV) | ⛔ Never exposed, never filled, values redacted |
| Form submission, checkout, delete/purchase-style buttons | 🙋 Human approval via the on-page panel |
| Arbitrary JavaScript execution | ⛔ Never provided |

The inspector (bottom-right badge) shows the live tool list, every agent action with its
arguments, highlights targets as the agent touches them, and pops an **Approve / Decline**
dialog for consequential actions. Sensitive fields are excluded from schemas *and* discovery,
so agents never see their existence or values.

Configuration:

```js
window.AgentReadyConfig = {
  inspector: true,          // on-page badge + activity + confirm dialogs
  siteName: 'My Store',     // badge label
  maxResults: 8,            // find_on_page result cap
};
```

---

## Development

Toolchain: **Bun** for installs/bundling/serving, **TypeScript 7** (strict) for all source.

```bash
bun install        # or: make install
make ci            # typecheck → build → unit tests → E2E (real Chrome)
make demo          # serve at http://localhost:8788
```

| URL | What it is |
|---|---|
| `http://localhost:8788/demo/store/` | Legacy Store demo — a deliberately ordinary storefront |
| `http://localhost:8788/demo/test-page/` | Verification page: status dashboard, fixtures, scenario console |

### Test layers

| Layer | Runner | Covers |
|---|---|---|
| Unit | `bun test tests/agentready.test.ts` (happy-dom) | Policy classification, semantic discovery/matching, control events, form synthesis, runtime shim |
| E2E | `bun test tests/e2e` (Playwright + real Chrome) | Boot, inspector UI, confirm gates approve/decline, synthesized tools, MutationObserver re-synthesis, output budgets, full shopping flow, zero console errors |
| Manual | `/demo/test-page/` | Live tool registry, redaction demos, anything from the DevTools console via `AgentReady.executeTool(...)` |

E2E uses your installed Chrome (`channel: 'chrome'`) and falls back to Playwright's Chromium.

### Project structure

```
src/
  index.ts            boot, MutationObserver, public API
  runtime.ts          document.modelContext adapter + in-page shim (getTools/executeTool)
  semantic.ts         DOM discovery, stable refs (WeakRef), natural-language matching
  policy.ts           exposure levels, output budgets, sensitive-field redaction
  inspector.ts        shadow-DOM activity UI + human approval dialog
  tools/              page.ts · interact.ts · forms.ts · controls.ts
demo/store/           Legacy Store demo (self-contained, deployable)
demo/test-page/       verification harness
tests/                bun:test unit + Playwright E2E
```

### Testing in a WebMCP browser

- **ChatGPT desktop app** — the in-app browser supports WebMCP by default.
- **Chrome 149+** — enable `chrome://flags/#enable-webmcp-testing`, restart, done.
- Without the native API, AgentReady runs its in-page shim: all tools still work through
  `window.AgentReady` — useful for local dev (`http://localhost`) and non-WebMCP browsers.

### Deploying the demo

`demo/store/` is self-contained (bundle copied to `vendor/agentready.js` at build time) —
drag it into Netlify, `vercel deploy`, `npx wrangler pages deploy`, or any static host.

---

## License

[MIT](./LICENSE)