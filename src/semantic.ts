/**
 * AgentReady — semantic DOM engine.
 * Walks the page into a compact semantic graph, assigns stable refs to
 * interactive elements, and answers natural-language "find" queries.
 * Refs stay stable across discovery passes via a WeakMap<Element, id>.
 */

import type { ActionClass, FieldClass } from './policy.js';
import { classifyAction, classifyField } from './policy.js';

let refCounter = 0;
const elToRef = new WeakMap<Element, string>();
const refToEl = new Map<string, WeakRef<Element>>();

export function escapeCss(doc: Document, s: string): string {
  const css = doc.defaultView?.CSS;
  if (css?.escape) return css.escape(s);
  return String(s).replace(/([^a-zA-Z0-9_\u00A0-\uFFFF-])/g, '\\$1');
}

export function cleanText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el.closest('[aria-hidden="true"], [hidden], [data-agentready-ignore]')) return false;
  if (el.getAttribute('type') === 'hidden') return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
    return false;
  }
  return true;
}

/** Approximate accessible name for a control. */
export function accessibleName(el: Element, doc: Document = el.ownerDocument): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const t = labelledby
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter((x): x is HTMLElement => !!x)
      .map(cleanText)
      .filter(Boolean)
      .join(' ');
    if (t) return t;
  }
  if (el.id) {
    const label = doc.querySelector(`label[for="${escapeCss(doc, el.id)}"]`);
    if (label) return cleanText(label);
  }
  const wrap = el.closest('label');
  if (wrap) return cleanText(wrap).slice(0, 120);
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();
  if (el.tagName === 'IMG' && (el as HTMLImageElement).alt) return (el as HTMLImageElement).alt.trim();
  const title = el.getAttribute('title');
  if (title) return title.trim();
  if (el.tagName === 'SELECT') {
    const sel = el as HTMLSelectElement;
    return sel.selectedOptions?.[0]?.textContent?.trim() ?? cleanText(el);
  }
  return cleanText(el).slice(0, 80);
}

/** Human label for a form control (label[for], wrapping label, aria, placeholder, name). */
export function labelFor(el: Element, doc: Document = el.ownerDocument): string {
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const t = labelledby
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter((x): x is HTMLElement => !!x)
      .map(cleanText)
      .join(' ');
    if (t) return t;
  }
  if (el.id) {
    const label = doc.querySelector(`label[for="${escapeCss(doc, el.id)}"]`);
    if (label) return cleanText(label);
  }
  const wrap = el.closest('label');
  if (wrap) {
    return (wrap.textContent ?? '')
      .replace(/\s+/g, ' ')
      .replace((el as HTMLInputElement).value ?? '', '')
      .trim();
  }
  return el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.getAttribute('name') ?? '';
}

export function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type))) {
    return 'button';
  }
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type;
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'search') return 'searchbox';
    if (t === 'range') return 'slider';
    return 'textbox';
  }
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'summary') return 'button';
  if (tag === 'option') return 'option';
  if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return 'button';
  return 'generic';
}

/** Nearest meaningful context: heading, label, fieldset legend, landmark. */
export function contextFor(el: Element, doc: Document = el.ownerDocument): string {
  const parts: string[] = [];
  const legend = el.closest('fieldset')?.querySelector('legend');
  if (legend) parts.push(cleanText(legend));
  const landmark = el.closest(LANDMARK_SELECTOR);
  if (landmark) {
    const l = landmark.getAttribute('aria-label') ?? landmark.tagName.toLowerCase();
    parts.push(`in ${l}`);
  }
  let anc: Element | null = el.parentElement;
  while (anc && anc !== doc.body) {
    if (/^H[1-6]$/.test(anc.tagName)) {
      parts.push(`under "${cleanText(anc).slice(0, 80)}"`);
      break;
    }
    anc = anc.parentElement;
  }
  const described = el.getAttribute('aria-describedby');
  if (described) {
    const d = doc.getElementById(described.split(/\s+/)[0] ?? '');
    if (d) parts.push(cleanText(d).slice(0, 100));
  }
  const isField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
  const label = isField ? labelFor(el, doc) : null;
  if (label && !parts.some((p) => p.includes(label))) parts.unshift(`field "${label}"`);
  return parts.join(', ');
}

export interface SemanticNode {
  ref: string;
  role: string;
  name: string;
  tag: string;
  context: string;
  visible: boolean;
  value?: string;
  href?: string;
  inputType?: string;
  options?: string[];
  /** Full visible text (≤300 chars) when it says more than `name`; search-only, safe subset. */
  text?: string;
  checked?: boolean;
  required?: boolean;
  field?: FieldClass;
  action?: ActionClass;
  hiddenFromAgents?: boolean;
}

export interface Discovery {
  nodes: SemanticNode[];
  landmarks: Array<{ role: string; label: string }>;
  headings: Array<{ level: number; text: string }>;
  forms: HTMLFormElement[];
  title: string;
  url: string;
}

/** Build semantic description for one interactive element. */
export function describeNode(el: Element, doc: Document = el.ownerDocument): SemanticNode {
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute('type') ?? '';
  const role = roleOf(el);
  const name = accessibleName(el, doc);

  const node: SemanticNode = {
    ref: refFor(el),
    role,
    name: name || `(unlabelled ${tag})`,
    tag,
    context: contextFor(el, doc),
    visible: isVisible(el),
  };

  const isFieldTag = ['input', 'select', 'textarea'].includes(tag);
  if (isFieldTag && (classifyField(el).level === 'never' || el.closest('[data-agent-hide]'))) {
    node.hiddenFromAgents = true; // sensitive or opted-out: never expose details or values
    return node;
  }

  let value: string | null = null;
  if (tag === 'input' && ['checkbox', 'radio'].includes(type)) {
    value = (el as HTMLInputElement).checked ? 'checked' : 'unchecked';
  } else if (tag === 'input' || tag === 'textarea') {
    value = ((el as HTMLInputElement).value || '').slice(0, 120) || null;
  } else if (tag === 'select') {
    value = (el as HTMLSelectElement).selectedOptions?.[0]?.textContent?.trim() ?? null;
  }
  if (value) node.value = value.slice(0, 120);
  if (tag === 'a' && el.getAttribute('href')) node.href = (el.getAttribute('href') ?? '').slice(0, 200);
  if (type && tag === 'input') node.inputType = type;
  if (tag === 'select') {
    node.options = Array.from((el as HTMLSelectElement).options)
      .slice(0, 30)
      .map((o) => o.textContent.trim());
  }
  if (tag === 'input' && type === 'checkbox') node.checked = (el as HTMLInputElement).checked;
  if (el.hasAttribute('required')) node.required = true;
  if (!isFieldTag && !el.querySelector('input, select, textarea, script, style, template')) {
    const full = cleanText(el).slice(0, 300);
    if (full && full !== name) node.text = full;
  }
  if (isFieldTag) node.field = classifyField(el);
  else if (role === 'button' || tag === 'button' || tag === 'a') node.action = classifyAction(el);
  return node;
}

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[role=button]',
  '[role=link]',
  '[role=tab]',
  '[role=checkbox]',
  '[role=switch]',
  '[role=menuitem]',
  '[role=option]',
  '[role=combobox]',
  '[role=searchbox]',
  '[role=textbox]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const LANDMARK_SELECTOR =
  'header, nav, main, aside, footer, section[aria-label], form[aria-label], [role=main], [role=navigation], [role=search], [role=dialog], [role=alertdialog]';

/**
 * Spike (shadowDiscovery flag, default off): flat queries when deep=false —
 * byte-identical behavior and cost to the pre-spike code path (the host scan
 * below is skipped entirely). When deep=true, also walks open shadow roots
 * and same-origin iframes recursively.
 *
 * Note: iframes are detected by tagName, not `instanceof HTMLIFrameElement`,
 * because bun's unit-test runtime has no DOM globals (ReferenceError there);
 * the duck-check works in every environment.
 */
function collectInteractive(doc: Document, deep: boolean): Element[] {
  const out: Element[] = [];
  const visit = (root: ParentNode): void => {
    for (const el of Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR))) out.push(el);
    if (!deep) return;
    for (const host of Array.from(root.querySelectorAll('*'))) {
      if (host.shadowRoot) visit(host.shadowRoot);
      if (host.tagName === 'IFRAME') {
        try {
          const d = (host as HTMLIFrameElement).contentDocument;
          if (d?.body) visit(d.body);
        } catch {
          /* cross-origin iframe: skip */
        }
      }
    }
  };
  visit(doc.body ?? doc.documentElement);
  return out;
}

/** Spike companion walk for <form> — same traversal and flag semantics as collectInteractive. */
function collectForms(doc: Document, deep: boolean): HTMLFormElement[] {
  const out: HTMLFormElement[] = [];
  const visit = (root: ParentNode): void => {
    for (const f of Array.from(root.querySelectorAll('form'))) out.push(f);
    if (!deep) return;
    for (const host of Array.from(root.querySelectorAll('*'))) {
      if (host.shadowRoot) visit(host.shadowRoot);
      if (host.tagName === 'IFRAME') {
        try {
          const d = (host as HTMLIFrameElement).contentDocument;
          if (d?.body) visit(d.body);
        } catch {
          /* cross-origin iframe: skip */
        }
      }
    }
  };
  visit(doc.body ?? doc.documentElement);
  return out;
}

export function refFor(el: Element): string {
  let ref = elToRef.get(el);
  if (!ref) {
    ref = `el_${(++refCounter).toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
    elToRef.set(el, ref);
    refToEl.set(ref, new WeakRef(el));
  }
  return ref;
}

export function resolveRef(ref: string): Element | null {
  const wr = refToEl.get(ref);
  if (!wr) return null;
  const el = wr.deref();
  if (!el?.isConnected) return null;
  return el;
}

export function pruneRefs(): void {
  for (const [ref, wr] of refToEl) if (!wr.deref()) refToEl.delete(ref);
}

/** Full page discovery pass. opts.deep (spike flag, default off) also walks open shadow roots and same-origin iframes. */
export function discover(doc: Document, opts: { deep?: boolean } = {}): Discovery {
  pruneRefs();
  const deep = opts.deep === true;
  const root = doc.body ?? doc.documentElement;
  const els = collectInteractive(doc, deep);
  const nodes = els
    .filter((el) => isVisible(el) && !el.closest('[data-agentready-ignore]'))
    .map((el) => describeNode(el, doc))
    .filter((n) => !n.hiddenFromAgents);

  const landmarks = Array.from(root.querySelectorAll(LANDMARK_SELECTOR))
    .slice(0, 20)
    .map((el) => {
      const heading = el.querySelector('h1, h2, h3');
      return {
        role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label') ?? (heading ? cleanText(heading) : ''),
      };
    });

  const headings = Array.from(root.querySelectorAll('h1, h2, h3'))
    .slice(0, 40)
    .filter((h) => isVisible(h))
    .map((h) => ({ level: Number(h.tagName.slice(1)), text: cleanText(h).slice(0, 120) }));

  const forms = collectForms(doc, deep).filter((f) => isVisible(f) && !f.closest('[data-agentready-ignore]'));
  return { nodes, landmarks, headings, forms, title: doc.title, url: doc.URL };
}

/** True for elements `discover()` would index as interactive (buttons, links, fields, ARIA widgets). */
export function isInteractive(el: Element): boolean {
  return el.matches(INTERACTIVE_SELECTOR);
}

// ---------- page text (content) ----------

export interface TextBlock {
  el: Element;
  text: string;
  /** NFKC + lower-cased copy used for matching. */
  folded: string;
  /** Nearest preceding heading in document order. */
  section: string;
  tag: string;
}

export interface TextIndex {
  blocks: TextBlock[];
  /** True when the page was too large to scan completely. */
  truncated: boolean;
}

const MAX_TEXT_VISITS = 8000;
const MAX_TEXT_CHARS = 250_000;
const MAX_BLOCK_CHARS = 4000;

/** Subtrees never surfaced as page text: non-content, form controls (values), embedded documents. */
const SKIP_TAGS = new Set(
  'SCRIPT STYLE NOSCRIPT TEMPLATE TEXTAREA SELECT OPTION OPTGROUP INPUT DATALIST SVG CANVAS IFRAME OBJECT EMBED HEAD'.split(
    ' ',
  ),
);

const BLOCK_TAGS = new Set(
  'ADDRESS ARTICLE ASIDE BLOCKQUOTE BODY BR CAPTION DD DETAILS DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HGROUP HR LEGEND LI MAIN NAV OL P PRE SECTION SUMMARY TABLE TBODY TD TFOOT TH THEAD TR UL'.split(
    ' ',
  ),
);
const BLOCK_SELECTOR = Array.from(BLOCK_TAGS, (t) => t.toLowerCase()).join(',');

/**
 * Elements whose text must never reach an agent: labels/hints attached to
 * sensitive or data-agent-hide controls (their existence is hidden, not just
 * their values — see README "Safety model").
 */
function suppressedFor(root: ParentNode, doc: Document): Set<Element> {
  const out = new Set<Element>();
  for (const c of Array.from(root.querySelectorAll('input, select, textarea'))) {
    if (classifyField(c).level !== 'never' && !c.closest('[data-agent-hide]')) continue;
    const wrap = c.closest('label');
    if (wrap) out.add(wrap);
    if (c.id) for (const l of Array.from(root.querySelectorAll(`label[for="${escapeCss(doc, c.id)}"]`))) out.add(l);
    for (const attr of ['aria-labelledby', 'aria-describedby']) {
      for (const id of (c.getAttribute(attr) ?? '').split(/\s+/)) {
        const t = id ? doc.getElementById(id) : null;
        if (t) out.add(t);
      }
    }
  }
  return out;
}

function isSkipped(el: Element, suppressed: Set<Element>): boolean {
  return (
    SKIP_TAGS.has(el.tagName.toUpperCase()) ||
    suppressed.has(el) ||
    el.hasAttribute('data-agent-hide') ||
    el.hasAttribute('data-agentready-ui') ||
    !isVisible(el)
  );
}

/**
 * Layout-aware boundary: CSS often turns <span>/<a> into blocks or flex items,
 * and adjacent ones must not glue words together ("modelContext" + "what agents").
 * 'block' starts a new text block; 'atomic' (inline-block/flex…) only needs a space.
 */
function boxOf(el: Element): 'block' | 'atomic' | 'inline' {
  if (BLOCK_TAGS.has(el.tagName.toUpperCase())) return 'block';
  const d = el.ownerDocument.defaultView?.getComputedStyle(el).display ?? '';
  if (!d || d === 'inline' || d === 'contents' || d === 'none') return 'inline';
  return d.startsWith('inline') ? 'atomic' : 'block';
}

function gatherText(node: Node, suppressed: Set<Element>, out: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) out.push(child.nodeValue ?? '');
    else if (child.nodeType === 1) {
      const c = child as Element;
      if (isSkipped(c, suppressed)) continue;
      const gap = boxOf(c) !== 'inline';
      if (gap) out.push(' ');
      gatherText(c, suppressed, out);
      if (gap) out.push(' ');
    }
  }
}

const squeeze = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Visible text of an element with hidden / sensitive / control content removed. Single choke point for read_target. */
export function readableText(el: Element, max = 800): string {
  if (el.closest('[data-agent-hide], [data-agentready-ui]')) return '';
  const root = el.getRootNode() as ParentNode;
  const parts: string[] = [];
  gatherText(el, suppressedFor(root, el.ownerDocument), parts);
  return squeeze(parts.join('')).slice(0, max);
}

/**
 * Index the page's visible text as flat blocks (paragraphs, headings, cells,
 * list items…), in document order. Opt-in walk used only by find_on_page.
 * opts.deep mirrors discover(): also open shadow roots and same-origin iframes.
 */
export function collectTextBlocks(doc: Document, opts: { deep?: boolean } = {}): TextIndex {
  const deep = opts.deep === true;
  const blocks: TextBlock[] = [];
  let visits = 0;
  let chars = 0;
  let truncated = false;
  let section = '';

  const push = (owner: Element, raw: string): void => {
    let text = squeeze(raw);
    while (text.length >= 2) {
      let cut = text.length;
      if (cut > MAX_BLOCK_CHARS) {
        const ws = text.lastIndexOf(' ', MAX_BLOCK_CHARS);
        cut = ws > MAX_BLOCK_CHARS / 2 ? ws : MAX_BLOCK_CHARS;
      }
      const chunk = text.slice(0, cut).trim();
      if (chunk) {
        blocks.push({ el: owner, text: chunk, folded: foldText(chunk), section, tag: owner.tagName.toLowerCase() });
        chars += chunk.length;
      }
      text = text.slice(cut).trim();
      if (chars > MAX_TEXT_CHARS) {
        truncated = true;
        return;
      }
    }
  };

  const flow = (owner: Element, parent: ParentNode, suppressed: Set<Element>): void => {
    let buf: string[] = [];
    const flush = (): void => {
      if (buf.length) push(owner, buf.join(''));
      buf = [];
    };
    for (const child of Array.from(parent.childNodes)) {
      if (truncated) return;
      if (child.nodeType === 3) {
        buf.push(child.nodeValue ?? '');
        continue;
      }
      if (child.nodeType !== 1) continue;
      const c = child as Element;
      if (++visits > MAX_TEXT_VISITS) {
        truncated = true;
        return;
      }
      const tag = c.tagName.toUpperCase();
      if (deep && tag === 'IFRAME') {
        flush();
        try {
          const d = (c as HTMLIFrameElement).contentDocument;
          if (d?.body) flow(d.body, d.body, suppressedFor(d, d));
        } catch {
          /* cross-origin iframe: skip */
        }
        continue;
      }
      if (isSkipped(c, suppressed)) continue;
      const box = boxOf(c);
      if (box === 'block' || c.querySelector(BLOCK_SELECTOR)) {
        flush();
        if (/^H[1-6]$/.test(tag)) {
          const parts: string[] = [];
          gatherText(c, suppressed, parts);
          section = squeeze(parts.join('')).slice(0, 80);
        }
        flow(c, c, suppressed);
      } else {
        if (box === 'atomic') buf.push(' ');
        gatherText(c, suppressed, buf);
        if (box === 'atomic') buf.push(' ');
      }
      if (deep && c.shadowRoot) {
        flush();
        flow(c, c.shadowRoot, suppressedFor(c.shadowRoot, doc));
      }
    }
    flush();
  };

  const body = doc.body ?? doc.documentElement;
  flow(body, body, suppressedFor(doc, doc));
  return { blocks, truncated };
}

// ---------- matching ----------

const CJK_RUN = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}]+/gu;
const WORD_RE = /[\p{L}\p{N}$]+(?:-[\p{L}\p{N}]+)*/gu;
const STOPWORDS = new Set(
  'a an the to for of in on at and or is are with from by how what where when why which who does do did can could should i you it be there please'.split(
    ' ',
  ),
);

/** NFKC + lower-case: folds full-width forms and case so 「ＡＢＣ」 matches "abc". */
export function foldText(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

export interface ParsedQuery {
  /** Space-delimited words (Latin, digits, …) with common stop-words removed. */
  words: string[];
  /** Runs of CJK characters — no word boundaries, matched as substrings. */
  cjk: string[];
  phrase: string;
}

export function parseQuery(query: string): ParsedQuery {
  const phrase = foldText(query).replace(/\s+/g, ' ').trim();
  const cjk = phrase.match(CJK_RUN) ?? [];
  const all = phrase.replace(CJK_RUN, ' ').match(WORD_RE) ?? [];
  // Stop-words and stray single letters ("take a minute") match nearly every label: pure noise.
  const kept = all.filter((w) => !STOPWORDS.has(w));
  const strong = kept.filter((w) => w.length > 1);
  return { words: strong.length ? strong : kept.length ? kept : all, cjk, phrase };
}

export const queryTerms = (q: ParsedQuery): string[] => [...q.words, ...q.cjk];

/** Crude suffix stripping so "warranties" finds "warranty" and "prices" finds "price". */
function stem(t: string): string {
  const s = t.replace(/(ies|ied|ing|ed|es|s|y)$/, '');
  return s.length >= 4 ? s : t;
}

function wordHit(hay: string, t: string): number {
  if (!hay) return 0;
  if (hay.includes(t)) return 1;
  if (t.includes('-')) {
    const parts = t.split('-').filter(Boolean);
    if (parts.length > 1 && parts.every((p) => hay.includes(p))) return 0.8;
  }
  const s = stem(t);
  return s !== t && hay.includes(s) ? 0.7 : 0;
}

/** Exact substring, else partial credit when most character bigrams of a longer run appear. */
function cjkHit(hay: string, run: string): number {
  if (!hay) return 0;
  if (hay.includes(run)) return 1;
  if (run.length < 3) return 0;
  const grams = run.length - 1;
  let found = 0;
  for (let i = 0; i < grams; i++) if (hay.includes(run.slice(i, i + 2))) found++;
  return found / grams >= 0.5 ? (found / grams) * 0.7 : 0;
}

function scoreFields(
  q: ParsedQuery,
  fields: ReadonlyArray<readonly [string, number]>,
): { score: number; matched: number; total: number } {
  let score = 0;
  let matched = 0;
  const tally = (hit: (hay: string) => number): void => {
    let s = 0;
    for (const [hay, weight] of fields) s += weight * hit(hay);
    if (s > 0) matched++;
    score += s;
  };
  for (const w of q.words) tally((hay) => wordHit(hay, w));
  for (const c of q.cjk) tally((hay) => cjkHit(hay, c));
  return { score, matched, total: q.words.length + q.cjk.length };
}

export type FindKind = 'action' | 'field' | 'text';

/** Score interactive nodes against a parsed query, best first. */
export function scoreNodes(
  q: ParsedQuery,
  nodes: SemanticNode[],
  kind?: FindKind,
): Array<{ node: SemanticNode; score: number }> {
  if (kind === 'text' || !queryTerms(q).length) return [];
  const scored: Array<{ node: SemanticNode; score: number }> = [];
  for (const n of nodes) {
    if (n.hiddenFromAgents) continue;
    if (kind === 'action' && !['button', 'link', 'tab', 'menuitem'].includes(n.role)) continue;
    if (kind === 'field' && !['textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'slider'].includes(n.role))
      continue;
    const nameL = foldText(n.name);
    const { score: base } = scoreFields(q, [
      [nameL, 6],
      [foldText(n.context ?? ''), 3],
      [foldText(n.text ?? ''), 4],
      [foldText(n.value ?? ''), 3],
      [foldText((n.options ?? []).join(' ')), 2],
      [foldText(n.href ?? ''), 2],
    ]);
    let score = base;
    if (n.role === 'button') for (const w of q.words) if (/click|press|tap|activate/.test(w)) score += 2;
    if (nameL === q.phrase) score += 10;
    else if (nameL.startsWith(q.phrase)) score += 4;
    if (score > 0) scored.push({ node: n, score });
  }
  return scored.sort((a, b) => b.score - a.score);
}

export interface TextHit {
  block: TextBlock;
  score: number;
  snippet: string;
}

function snippetOf(b: TextBlock, q: ParsedQuery): string {
  // Offsets come from the folded copy; fall back to it when NFKC changed the length.
  const text = b.folded.length === b.text.length ? b.text : b.folded;
  if (text.length <= 160) return text;
  let at = -1;
  for (const t of queryTerms(q)) {
    const i = b.folded.indexOf(t) >= 0 ? b.folded.indexOf(t) : b.folded.indexOf(stem(t));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const from = Math.max(0, at < 0 ? 0 : at - 60);
  const to = Math.min(text.length, from + 160);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

/** Score page-text blocks against a parsed query, best first. Multi-term queries need ≥ half the terms. */
export function scoreBlocks(q: ParsedQuery, blocks: TextBlock[]): TextHit[] {
  if (!queryTerms(q).length) return [];
  const hits: TextHit[] = [];
  for (const b of blocks) {
    const { score: base, matched, total } = scoreFields(q, [[b.folded, 5]]);
    if (!matched || (total > 1 && matched < Math.ceil(total / 2))) continue;
    let score = base;
    if (q.phrase.length > 1 && b.folded.includes(q.phrase)) score += 6;
    if (/^h[1-6]$/.test(b.tag)) score += 3;
    hits.push({ block: b, score, snippet: snippetOf(b, q) });
  }
  return hits.sort((a, b) => b.score - a.score || a.block.text.length - b.block.text.length);
}

/** Token-scored semantic match over interactive nodes. kind narrows roles: action | field. */
export function matchNodes(
  query: string,
  nodes: SemanticNode[],
  { kind, limit = 8 }: { kind?: FindKind; limit?: number } = {},
): SemanticNode[] {
  return scoreNodes(parseQuery(query), nodes, kind)
    .slice(0, limit)
    .map((s) => s.node);
}
