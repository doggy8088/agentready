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

/** Token-scored semantic match. kind narrows roles: action | field. */
export function matchNodes(
  query: string,
  nodes: SemanticNode[],
  { kind, limit = 8 }: { kind?: 'action' | 'field'; limit?: number } = {},
): SemanticNode[] {
  const q = query.toLowerCase().replace(/[^\w\s$-]/g, ' ');
  const terms = q.split(/\s+/).filter((t) => t.length > 1 || /^[\w$]$/.test(t));
  if (!terms.length) return [];
  const scored: Array<{ node: SemanticNode; score: number }> = [];
  for (const n of nodes) {
    if (n.hiddenFromAgents) continue;
    if (kind === 'action' && !['button', 'link', 'tab', 'menuitem'].includes(n.role)) continue;
    if (kind === 'field' && !['textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'slider'].includes(n.role))
      continue;
    let score = 0;
    const nameL = n.name.toLowerCase();
    const ctxL = (n.context ?? '').toLowerCase();
    for (const t of terms) {
      if (nameL.includes(t)) score += 6;
      if (ctxL.includes(t)) score += 3;
      if (n.role === 'button' && /click|press|tap|activate/.test(t)) score += 2;
    }
    if (nameL === q) score += 10;
    if (nameL.startsWith(q)) score += 4;
    if (score > 0) scored.push({ node: n, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.node);
}
