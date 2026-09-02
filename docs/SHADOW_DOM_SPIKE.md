# Spike: discovering interactive elements inside shadow DOM and same-origin iframes

- **Status:** design spike (investigation) — prototype lives behind the default-off `AgentReadyConfig.shadowDiscovery` flag. **Not a product feature**; the flag is documented here only, not in the README.
- **Planned:** 2026-09-01 at commit `eb6df6f` (plan 010); executed 2026-09-03 on branch `advisor/execute-all` against the post-plan-008 tree (baseline: 79 unit + 16 E2E tests green, `bun run typecheck`/`bun run lint` clean).
- **Deliverables:** this report; a flag-gated recursive walker in `src/semantic.ts` (`collectInteractive` + `collectForms`, both no-ops cost-wise when the flag is off); the `shadowDiscovery?: boolean` config field (`src/env.ts`); 9 flag-gated unit tests; a shadow-DOM fixture on the test page + 4 flag-on E2E tests; measurements.

## Questions

| # | Question | Short answer |
|---|----------|--------------|
| Q1 | Can a recursive walker replace flat `querySelectorAll` without changing the flag-off path (perf parity)? | **Yes** — flag-off is the same flat query plus one function call; refs verified byte-identical to the pre-spike pipeline. |
| Q2 | Do `refFor`/`resolveRef` work unchanged for shadow elements? | **Yes** — element-identity keyed `WeakMap` + `isConnected`; no change needed. |
| Q3 | Does `isVisible` give correct answers for shadow children (host `display:none`, `[hidden]`, `[data-agentready-ignore]`)? | **No — gap.** `closest()` stops at the shadow root and `getComputedStyle` reports the child's own style, so hidden/ignored hosts still contribute "visible" shadow children. |
| Q4 | Do `labelFor`/`contextFor` find labels inside shadow roots? | **Split.** `label[for]` and wrapping labels inside a shadow tree resolve via `.labels`/`closest` (tool synthesis is fine), but `accessibleName`'s doc-scoped lookups miss in-shadow `label[for]` and in-shadow `aria-labelledby`; cross-boundary `aria-labelledby` resolves for us but would not for the browser. |
| Q5 | Do forms inside shadow roots synthesize tools correctly end-to-end? | **Yes** — collected, analyzed, synthesized and executed in unit (happy-dom) and real Chromium; same-origin iframes are discovered (unit); iframes' *forms* are code-covered but not separately test-asserted. |
| Q6 | What is the discovery-cost delta on a shadow-heavy page (200 hosts × 10 children)? | **+3.2 ms/pass in Chromium, +6.6 ms/pass in happy-dom** (×13 / ×68 vs flat) on a pathological 2,000-shadow-element page; flag-off cost unchanged. |
| Q7 | How must the MutationObserver story change? | **It is blind to shadow-only mutations** (verified in Chromium); read tools re-discover per call so they stay fresh; synthesized tools go stale until the next light-DOM mutation. Fix direction: per-shadow-root observers or accept staleness. |
| Q8 | What safety gaps appear? | Per-element plan-004 protections **hold** (password filtered, `javascript:` refused). **Gap:** host-level `data-agent-hide` / `[hidden]` / `data-agentready-ignore` do not reach shadow children; a host-level opt-out therefore leaks the shadow child's name and value. |

## Evidence

All claims below were verified in this spike's session (unit tests in `tests/agentready.test.ts` → `shadow discovery (flagged spike)` describe; E2E in `tests/e2e/agentready.e2e.test.ts` → `shadow discovery spike (flag on)` describe; real-browser probes via Playwright Chromium — one-off probe scripts, not committed).

### Q1 — walker parity with the flat path (perf + output)

- Code: `src/semantic.ts:252-272` (`collectInteractive`) — when `deep === false`, `visit()` runs exactly the pre-spike single `root.querySelectorAll(INTERACTIVE_SELECTOR)` and returns at `if (!deep) return;` before the `querySelectorAll('*')` host scan (line 261). `discover()` (`src/semantic.ts:320-324`) is the same filter/map/filter pipeline fed by it.
- Empirical parity: on the 200-host stress document, the refs produced by `discover(doc)` (flag off) are **byte-identical** to the refs produced by re-running the pre-spike flat pipeline inline (probe, `performance.now()` bench). Flag-off cost on that page: 0.10 ms mean (happy-dom) / 0.26 ms mean (Chromium).
- Suite invariance: all 79 pre-existing unit tests and all 16 pre-existing E2E tests pass unchanged with the flag off (default). Test: *flag off (default): shadow and iframe content are invisible to discover — light DOM only*.

### Q2 — refs work unchanged

- `refFor` (`src/semantic.ts:297-305`) is keyed by element identity in a `WeakMap` — shadow children are ordinary `Element`s. `resolveRef` (`src/semantic.ts:307-313`) only checks `WeakRef.deref()` + `isConnected`, which is `true` for connected shadow children.
- Unit test: *flag on: shadow button discovered with a stable ref; resolveRef derefs it across passes (Q2)* — the shadow button is discovered with the same ref across two passes and `resolveRef(refFor(shadowBtn))` derefs to the element.
- E2E (real Chromium): *find_on_page returns the shadow button and activate_target clicks it (Q2 end-to-end)* — `find_on_page` returns the shadow button's ref; `activate_target` clicks it and the fixture's light-DOM side effect fires.
- Node ordering note: deep discovery is light DOM first, then each host's shadow content in document order, then same-origin iframes (asserted in the Q2 unit test).

### Q3 — visibility is wrong for hidden hosts (documented gap, NOT fixed)

`isVisible` (`src/semantic.ts:25-33`) checks `el.closest('[aria-hidden="true"], [hidden], [data-agentready-ignore]')` and `getComputedStyle(el)`. Both stop at the shadow boundary: `closest()` never leaves the shadow tree, and computed style reports the child's own properties even when the whole host subtree is unrendered.

Real-Chromium probe (flag on): a shadow button inside a host with (a) `style="display:none"`, (b) `[hidden]`, (c) `[data-agentready-ignore]`, (d) `[aria-hidden="true"]` — **all four are discovered and reported `visible: true`**.

Unit characterization tests:
- *flag on: [hidden] and data-agentready-ignore hosts still contribute visible shadow children — documented gap (Q3)*.
- Covered / working: shadow children of *visible* hosts are correctly reported visible (Q2/Q5 tests); per-element hiding inside the shadow tree itself works (`closest` within the tree).
- Not covered: anything host-level. This is a finding for the report, not a fix in the spike.

### Q4 — label resolution inside shadow roots (split-brain)

- `fieldLabel` (`src/tools/interact.ts:121-127`) uses `HTMLInputElement.labels` — tree-scoped, so `label[for]` **inside the same shadow root resolves**. This is what form-tool synthesis uses, so synthesized tools get correct field labels.
- `accessibleName`/`labelFor` (`src/semantic.ts:37, 70-77`) look up `doc.querySelector('label[for="…"]')` and `doc.getElementById` — document-scoped, so they **miss** in-shadow `label[for]` (node name falls back to `(unlabelled input)`) and in-shadow `aria-labelledby`.
- Wrapping `<label>` inside the shadow tree resolves fine (via `closest('label')`, which works within the tree).
- Real-Chromium probe: `aria-labelledby` on a shadow element pointing at a **light-DOM id resolves for AgentReady** (shared `ownerDocument`), even though Chrome's own accessibility tree would not resolve cross-tree ID references — i.e. AgentReady can report names the browser a11y tree would not use. In-shadow `aria-labelledby` falls back to the button's own text.
- Unit test: *flag on: labels inside shadow roots — .labels resolves label[for] (fieldLabel), but accessibleName's doc-scoped lookup misses it (Q4)*.

### Q5 — shadow forms synthesize tools end-to-end

- Forms: `collectForms` (`src/semantic.ts:275-296`) mirrors the walker; `discover({deep:true})` returns forms inside open shadow roots. `analyzeForm`/`classifyForm` are form-scoped `querySelectorAll` — they work unchanged on a shadow form.
- Unit test: *flag on: form inside a shadow root is collected, analyzed and synthesized into a fill tool (Q5)* — `shadow_newsletter` is synthesized and executing it fills the shadow input.
- E2E (real Chromium, flag flipped on via `window.AgentReadyConfig = { shadowDiscovery: true }` before the bundle loads): *synthesizes a tool from the form inside the shadow root (Q5)* and *fills the shadow form field through the synthesized tool (Q5 end-to-end)* — the tool appears in `getTools()` (tool count 11 vs 10 with the flag off) and filling works through the boundary.
- Iframes: same-origin `about:blank` iframes are discovered in happy-dom (unit test: *flag on: same-origin iframe content is discovered (Q5-iframe)*). Cross-origin access is skipped via the `try/catch` + `contentDocument` null guard (`src/semantic.ts:264-270`). Forms inside iframes are code-covered by the same walk but have no dedicated assertion — noted as a test gap, not a code gap.

### Q6 — measurements

Stress fixture: 200 hosts × 10 shadow buttons (2,000 shadow interactive elements) + 20 light buttons. Warm-up 2-3 passes, then 10 timed passes of the full `discover()` / `AgentReady.inspect()`.

| Environment | Flag | Nodes | mean | median | min | max | Δ |
|---|---|---|---|---|---|---|---|
| happy-dom 15.11 (bun 1.3.13) | off | 20 | 0.10 ms | 0.11 ms | 0.06 ms | 0.15 ms | — |
| happy-dom 15.11 (bun 1.3.13) | on | 2,020 | 6.71 ms | 5.44 ms | 4.78 ms | 12.45 ms | +6.6 ms (×68) |
| Playwright Chromium (headless, system Chrome channel) | off | 36 | 0.26 ms | 0.20 ms | 0.10 ms | 0.80 ms | — |
| Playwright Chromium (headless, system Chrome channel) | on | 2,039 | 3.45 ms | 3.60 ms | 3.10 ms | 3.70 ms | +3.2 ms (×13) |

Machine: Apple M5 Max, macOS 26.6.2. Note the flag-off node counts differ from 2,020 because the browser fixture ran on the AgentReady test page (16 page nodes + fixture shadow content + 20 stress buttons).

Bundle cost of the spike (tracked bundles, committed): `dist/agentready.js` 58,232 → 59,503 bytes (**+1,271 B raw**); `agentready.min.js` 37,475 → 38,086 bytes (+611 B). Size budgets still green (`bun run size`: 58.11 KB / 75 KB and 37.19 KB / 45 KB).

### Q7 — MutationObserver story

- Isolated Chromium probe (raw `MutationObserver` on `document.documentElement`, `childList+subtree`): after appending a host, 1 record; after mutating **only** the host's shadow root via `innerHTML`: **0 records** — spec behavior, observers are tree-scoped.
- Minimal page + real bundle, flag on: after a shadow-only mutation injects a late shadow form, `getTools()` does **not** contain `late_shadow_form` even 2.5 s later; appending one unrelated light-DOM `<span>` triggers the debounced resynth and the tool appears ~1 s later. **Synthesized tools go stale for shadow-only changes until the next light-DOM mutation.**
- Read tools are unaffected: `find_on_page`/`get_page_context` re-run `env.discover()` on every call (`src/tools/page.ts:62, 86`), so shadow changes are visible to reads immediately (probe: `find_on_page` saw the late shadow field while its form tool was still missing).
- Test-page artifact worth knowing: `demo/test-page/status.ts` refreshes its dashboard every 800 ms by writing to the light DOM, which continuously re-arms AgentReady's observer (`src/index.ts:71-89`) — on *that* page a shadow-only change gets picked up within one refresh cycle (+800 ms, measured). This is a page-specific poller effect, not a general guarantee.
- If promoted: either register per-shadow-root observers (`ShadowRoot` is a valid `observe()` target; needs bookkeeping to disconnect detached roots), or accept tool staleness for shadow-only mutations and lean on read-tool re-discovery.

### Q8 — safety gaps (plan 004 interaction)

Holds (per-element classification is shadow-agnostic, `src/policy.ts:55, 77`):
- Shadow password field: `classifyField → never` → `hiddenFromAgents` → **filtered from the public snapshot**; value never serialized. Unit test: *flag on: shadow password field is classified never and filtered from the public snapshot (Q8, plan 004)*. Real-Chromium probe confirms: shadow password under a `data-agent-hide` host is still filtered (classification wins per element).
- `javascript:` link inside a shadow root: discovered as a node (same as light DOM, where `action.never` nodes also appear with `actionRisk`), but `classifyAction` returns `never` and `activate_target` refuses without clicking. Unit test: *flag on: javascript: links inside shadow roots are still refused by classifyAction (Q8, plan 004 rule)*.
- **No sensitive-classified field leaks** — the STOP-condition scenario did not occur.

Gaps (documented, not fixed — policy decisions, see open questions):
- **Host-level `data-agent-hide` does not hide shadow children**: `closest('[data-agent-hide]')` in `describeNode` (`src/semantic.ts:192`) and the tool-level checks stop at the shadow root. Real-Chromium probe: a non-sensitive shadow input under a `data-agent-hide` host is exposed in the public snapshot **with its value** ('leak-check'). Unit characterization: *flag on: data-agent-hide on a host does NOT hide shadow children — documented gap (Q8)*. Site authors who opt out at the host level do not get the opt-out honored for the widget's shadow content.
- Same mechanism: host-level `[hidden]`, `[data-agentready-ignore]`, `aria-hidden` do not hide shadow children (Q3), so an agent can be told about "visible" controls that are actually unrendered.

## Risks

1. **Opt-out bypass (high, safety-adjacent):** host-level `data-agent-hide` / `data-agentready-ignore` / `[hidden]` don't propagate into shadow trees. Until resolved, enabling the flag on a site that uses host-level opt-outs can expose content the author meant to hide. Mitigation when promoting: walk composed ancestors (host chain) for all three attributes.
2. **Visibility fidelity:** `isVisible` reports shadow children of `display:none` hosts as visible — agents may try to interact with unrendered controls (activation will "succeed" via synthetic `.click()` even though nothing is user-visible).
3. **Stale synthesized tools:** shadow-only DOM changes don't reach the MutationObserver (Q7) — an agent may call a form tool whose fields were removed (mitigated in `runFormTool` by the `form.isConnected` check).
4. **Label split-brain (Q4):** synthesized tools get correct labels via `.labels`, but `find_on_page` names for shadow fields may read `(unlabelled input)` even when the widget has a proper label — degrades matching quality.
5. **happy-dom divergences:** computed styles barely cascade (host `display:none` cannot be regression-tested in happy-dom); `aria-labelledby` resolution differs from Chrome's a11y tree; `HTMLIFrameElement` is not a global in bun (hence the `tagName === 'IFRAME'` duck-check instead of the plan's `instanceof`).
6. **Pathological-page cost:** ~3.5 ms per pass at 2,000 shadow nodes in Chromium; grows linearly with shadow interactive count. No node-count cap exists today for either path; a promoted version should budget (e.g. cap deep nodes or de-scope non-viewport roots).

## Recommendation

**Promote to a real feature, but not as-is — needs design changes first; keep the flag off until stage 1 lands.**

Reasoning:

- The core question — "is shadow-aware discovery cheap to add to the current architecture?" — is **yes**: the walker is ~40 lines, refs need zero changes, plan-004's sensitive-field protection travels per element, forms synthesize and execute correctly end-to-end, and the flag-off path is provably unchanged (byte-identical refs, all 95 pre-existing tests green, +1.3 KB raw bundle cost).
- The blockers are all *boundary semantics*, not architecture: host-attribute propagation (risk 1), visibility of unrendered subtrees (risk 2), observer staleness (risk 3), tree-scoped label lookups (risk 4). All are tractable: (1) walk the composed host chain for `data-agent-hide`/`data-agentready-ignore`/`[hidden]`/`aria-hidden`; (2) add a host-rendered check (or accept and document synthetic-click semantics); (3) per-shadow-root observers or documented staleness; (4) use `el.labels`/root-scoped queries in `accessibleName`.
- The payoff is real: web-component-based design systems currently get **zero** tools from AgentReady; the E2E fixture shows a widget gaining full find/activate/fill coverage through the boundary.
- Suggested staging: **stage 1** — composed-ancestor checks + tree-scoped labels + tests on real browsers (flag still off). **stage 2** — decide the observer strategy and iframe policy. **stage 3** — flip the default after measuring real shadow-heavy sites (design-system docs sites, e.g. Shoelace/Lion-based pages), and only with the opt-out semantics fixed. If the maintainer judges the opt-out gap unacceptable for the project's threat model, the fallback is report-only: keep the walker behind the flag indefinitely and re-evaluate.

## Open questions for the maintainer

1. **Host-level opt-outs (policy decision):** should `data-agent-hide` / `data-agentready-ignore` on a *host* hide its shadow children? (The spike's position: yes — an author opting out at the host means the widget. It costs a composed-ancestor walk.)
2. **Iframes:** same-origin-only by default (current behavior)? Cross-origin is already skipped; should same-origin be opt-in rather than bundled with shadow discovery?
3. **Inspector surface:** how should shadow-origin tools/nodes be surfaced? (Name collisions between a widget's forms and page forms are possible — provenance annotation or a `shadow_` prefix?)
4. **Stale form tools:** accept MutationObserver blindness for shadow-only mutations, or pay for per-shadow-root observers?
5. **Visibility:** should agents see controls inside `display:none` hosts at all (today: yes, marked visible)?
6. **Discovery budget:** cap deep-discovery node counts (e.g. 500) like `matchNodes`' result cap, to bound pathological pages?

## How to try the prototype (not a product feature)

```html
<script>window.AgentReadyConfig = { shadowDiscovery: true };</script>
<script src="agentready.js" defer></script>
```

The flag is read once at boot (`src/index.ts:40-45` merge; `src/index.ts:112` wiring); boot defaults never set it (`src/env.ts:54`), so absence = off. The demo test page (`demo/test-page/index.html` §5) carries a `<shadow-spike-widget>` fixture; the flag-on E2E suite drives it end-to-end.