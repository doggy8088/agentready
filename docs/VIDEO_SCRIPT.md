# 3-Minute Demo Video Script — AgentReady.js

> Requirements met: ≤ 3:00, public YouTube, **narration with audio** (voice or TTS both fine),
> product working on screen within the first 10–15 seconds.

Pre-recording checklist:
- [ ] Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled **or** ChatGPT desktop app
- [ ] Demo deployed (use the deployed URL; if testing locally use `make demo`)
- [ ] Screen recorder at 1080p+, do-not-disturb on, browser zoom 100–125%
- [ ] Two windows ready: demo store + ChatGPT

---

## Scene 1 — 0:00–0:15 · The hook (product working immediately)

**On screen:** ChatGPT browser on the deployed Legacy Store. Type:

> *"Find the highest-rated keyboard under $150 and add it to my cart."*

Agent calls `search_products` → `activate_target` → cart count flips to 1.

**Narration:**
> "This is a completely ordinary online store. I didn't build any AI integration.
> I added one script tag — and now ChatGPT can shop it. This is AgentReady."

## Scene 2 — 0:15–0:40 · One line of code

**On screen:** open DevTools/Elements, highlight the single `<script src="agentready.js">` tag
in `demo/store/index.html`; scroll the source.

**Narration:**
> "This is the entire integration. AgentReady reads the page's semantic HTML — forms, buttons,
> labels — and registers structured WebMCP tools through `document.modelContext`. No SDK, no
> rewrite, no backend. The web stays exactly the same for humans."

## Scene 3 — 0:40–1:10 · Show the tools (inspector)

**On screen:** click the AgentReady badge in the corner — show the tool list
(`get_page_context`, `find_on_page`, `search_products`, `fill_form`…). Trigger one tool call so
the activity feed shows `→ search_products` … `✓ 42ms`.

**Narration:**
> "Instead of exposing a hundred click-this-div tools, AgentReady derives a small semantic
> surface: seven core tools, plus one real tool per form — with a typed JSON Schema. Fewer,
> clearer tools make the agent better at choosing the right one."

## Scene 4 — 1:10–1:55 · The shopping flow with a human in the loop

**On screen:** ChatGPT: *"Buy the MechKeyboard Pro and check out with my saved details."*
Agent fills the form; at submit, the panel pops **Approve / Decline** — pause, click Approve.
Show the password and card fields stay empty the whole time.

**Narration:**
> "AgentReady is safe by design. Passwords and card fields are never exposed to the agent —
> not their existence, not their values. And consequential actions like submitting an order
> wait for a human tap. The agent proposes; the person approves."

## Scene 4b — 1:55–2:20 · Open standard: same site, different agent

**On screen:** open `/demo/test-page/`, use the scenario console to call
`AgentReady.executeTool('find_on_page', …)` — the **same tools** the ChatGPT browser used.

**Narration:**
> "Because AgentReady speaks the open WebMCP standard, the same website works with ChatGPT,
> with in-page agents like AskPage, and with any future client. No per-agent integrations."

## Scene 5 — 2:20–2:40 · Live pages, live tools

**On screen:** test page → click *Inject newsletter form* → the tool list gains
`newsletter_subscription` instantly (MutationObserver re-synthesis).

**Narration:**
> "Single-page apps change all the time. AgentReady watches the DOM and re-registers tools
> within milliseconds — stale refs resolve to nothing instead of crashing."

## Scene 6 — 2:40–2:55 · Level 1 & 2 in ten seconds

**On screen:** flash the `data-agent-name` snippet, then the `AgentReady.register({...})` snippet.

**Narration:**
> "Need more? One HTML attribute names your tool. One function call registers a fully custom one."

## Scene 7 — 2:55–3:00 · Tagline

**On screen:** logo card — **"One script. Any site. Any agent."**

**Narration:**
> "AgentReady — make the web you already have, agent-ready."

---

### Recording tips
- Do scene 1 in ONE take — judges only see the first 15 seconds once.
- Narrate live or generate TTS (both accepted); keep sentences under ~15 words.
- Show the cursor; enlarge the inspector with browser zoom for visibility.
- End card: repo URL + "MIT licensed".