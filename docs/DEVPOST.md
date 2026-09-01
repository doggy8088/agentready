## Inspiration

The promise of autonomous AI agents browsing the web has collided with a painful reality: modern agent browsing relies heavily on computer vision, screenshot parsing, or dumping massive DOM trees into LLM context windows. This approach is slow, brittle, and expensive. When an agent consumes raw HTML or high-resolution screenshots, the signal-to-noise ratio is dismal:

$$\text{Efficiency Ratio} = \frac{\text{Semantic Information}}{\text{Token Overhead}} \ll 1$$

The emerging WebMCP (Web Model Context Protocol) standard solves this by allowing web applications to declare structured, high-level tools directly to AI clients via document.modelContext. However, expecting developers to rewrite millions of legacy websites and single-page apps (SPAs) with custom WebMCP implementations will take years.

We asked ourselves: Why can't existing websites become instantly agent-ready with zero code changes?

That question inspired AgentReady.js — a progressive-enhancement JavaScript runtime that extracts semantic meaning from standard HTML and instantly exposes safe, structured WebMCP tools to any AI browser or in-page agent.

---

## What it does

With a single <script src="agentready.js" defer></script> tag, AgentReady.js transforms any standard web page into an AI-accessible powerhouse:

1. Automatic Semantic Discovery & Synthesis: Scans the DOM tree, analyzes forms, buttons, navigational structures, and accessibility attributes (aria-label, placeholder, label), and automatically derives typed JSON Schema tools (e.g., transforming a search form into search_products({ q, category, max_price })).
2. 7 Core Built-In Primitives: Provides foundational tools including get_page_context, find_on_page, read_target, activate_target, set_field, fill_form, and submit_form.
3. Multi-Platform WebMCP Bridge: Exposes all synthesized and registered tools natively via document.modelContext (and navigator.modelContext), while providing an identical in-page shim (getTools() and executeTool()) so ChatGPT desktop browsers, Chrome 149+, Firefox, and in-page AI companions work seamlessly.
4. Three-Tier Progressive Enhancement:
   - Level 0 (Zero Code): Drop in the script; tools are synthesized automatically.
   - Level 1 (HTML Metadata): Refine tools using declarative data-agent-* attributes.
   - Level 2 (Native Tooling): Register bespoke business logic via window.AgentReady.register({...}).
5. Human-in-the-Loop Safety Engine: Quarantines sensitive fields (passwords, tokens, CVVs, cc-* credit card data) and pauses consequential actions (purchases, deletions, form submissions) with an interactive Approve / Decline panel.

---

## How we built it

AgentReady.js is crafted with modern TypeScript and Bun for high performance and zero external runtime dependencies:

```
                  ┌────────────────────────────────────────┐
                  │              Web Browser               │
                  └───────────────────┬────────────────────┘
                                      │
                         ┌────────────┴────────────┐
                         │      AgentReady.js      │
                         │ (Zero-dependency Shim)  │
                         └────────────┬────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│ Semantic Analyzer │       │   Safety Policy   │       │ Runtime Adapter   │
│ • WeakRef Cache   │       │ • Regex Redactor  │       │ • document.       │
│ • Form Synthesis  │       │ • Token Budget    │       │   modelContext    │
│ • MutationObserver│       │ • Approval Dialog │       │ • In-Page Fallback│
└───────────────────┘       └───────────────────┘       └───────────────────┘
```

- Runtime & Adapter Layer (src/runtime.ts): Listens to native engine events, dynamically registers schemas, and manages tool life cycles. When native WebMCP is absent, it seamlessly provides spec-compliant getTools() and executeTool() methods.
- Semantic Engine & Stable Ref Pool (src/semantic.ts): Indexes interactive elements using WeakRef to eliminate memory leaks. Elements are queried via natural language token matching without mutating the original DOM.
- Dynamic Resynthesis (src/index.ts): Leverages a debounced MutationObserver (\Delta t \approx 300\text{ms}) to detect route transitions in SPAs and re-synthesize available tools on the fly.
- Shadow DOM Inspector (src/inspector.ts): An isolated UI widget attached via an open Shadow DOM root, whose style isolation prevents CSS collisions with host websites while rendering real-time execution logs and safety confirmation dialogs.
- Strict Testing Suite: 53 automated tests (39 unit + 14 E2E) — unit tests on Bun's test runner, end-to-end tests on real Chrome via Playwright.

---

## Challenges we ran into

### 1. The Dynamic SPA Problem & Memory Leaks
Single Page Applications (SPAs) frequently tear down and rebuild DOM subtrees. Storing direct references to DOM nodes caused memory leaks, while relying on static selectors resulted in StaleElementReference failures. 
Solution: We implemented an ephemeral reference registry backed by JavaScript WeakRef and FinalizationRegistry, pairing fuzzy text queries with structural paths to gracefully recover when elements re-render.

### 2. Output Budgets and Context Poisoning
LLMs can easily be overwhelmed if a tool returns an entire table containing thousands of rows.
Solution: We designed a strict output-budget clamp enforcing an upper bound:

$$L_{\text{output}} \le 1500 \text{ characters}$$

This truncates large payloads gracefully while informing the agent that additional pagination or targeted querying is required.

### 3. Divergent Browser Implementations
During testing across Chrome 149+ builds and ChatGPT's in-app browser, we encountered differing WebMCP draft implementations (e.g., JSON schema strings vs. parsed schema objects, document.modelContext vs. navigator.modelContext, and register-only environments). We engineered a resilient normalization layer that detects engine quirks and provides a consistent interface across all clients.

---

## Accomplishments that we're proud of

- True Zero-Configuration: Simply adding <script src="agentready.js"></script> immediately enables a ChatGPT browser or WebMCP agent to navigate, search, add products to cart, and prepare checkout on a standard e-commerce storefront.
- Radical Token Reduction: Replacing raw HTML DOM dumps with structured JSON tool schemas achieves up to a 90% reduction in token consumption per interaction turn:

$$\text{Token Savings} = 1 - \frac{\text{Tokens}_{\text{WebMCP Tool}}}{\text{Tokens}_{\text{Raw DOM}}} \approx 85\% - 95\%$$

- Zero-Compromise Security: Full proactive redaction of type="password", autocomplete="cc-*", hidden CSRF tokens, and sensitive credential fields ensures agent actions remain transparent and strictly supervised.
- Lightweight Footprint: The entire runtime bundles into a standalone, minified script of ~36 KB (~12 KB gzipped) with zero third-party dependencies.

---

## What we learned

1. Semantic HTML is AI's Best Friend: Modern accessibility primitives (aria-*, label, form method, semantic button labels) already contain almost all the structural metadata needed to synthesize high-quality AI tool definitions. Building for accessibility naturally creates AI-ready applications.
2. Deterministic Tools Beat Autonomous Spelunking: Agents provided with 5–8 high-level, strongly-typed semantic tools consistently outperform agents forced to guess low-level click coordinates or query selectors.
3. Safety Must Be Default, Not Configurable: Autonomous tools that can submit forms or make payments must demand human confirmation at the platform level, making safe behavior the default rather than an afterthought.

---

## What's next for AgentReady.js: Instant WebMCP for Every Website

- Framework Adapters & Components: Native bindings and wrapper components for React, Vue, Svelte, and Next.js for even easier declarative tool mapping.
- Multi-Modal Spatial Grounding: Integrating semantic bounding box data so agents combining visual and WebMCP modalities can visually correlate tools with UI components.
- Public CDN & npm Package: Distributing @agentready/core via npm and global CDNs (Cloudflare, cdnjs, unpkg) for one-line deployment across the web.
- Community Tool Templates: Pre-built semantic profiles for popular web platforms like Shopify, WordPress, WooCommerce, and Webflow to instantly expose rich store and CMS actions out of the box.
