/**
 * AgentReady — safety policy engine.
 * Pure logic, no DOM behavior dependencies. Classifies fields/forms/actions
 * into exposure levels: "allow" | "confirm" | "never".
 */

export type Exposure = 'allow' | 'confirm' | 'never';
export type FormKind = 'search' | 'auth' | 'payment' | 'newsletter' | 'general';

export const MAX_OUTPUT_CHARS = 1500;
export const MAX_DESC_CHARS = 500;
export const MAX_RESULTS = 10;

export interface FieldClass {
  level: Exposure;
  reason: string;
}

export interface ActionClass {
  level: Exposure;
  reason: string;
  label: string;
}

export interface FormClassification {
  kind: FormKind;
  submitPolicy: SubmitPolicy;
  hasSubmit: boolean;
  method: string;
  action: string;
  fields: FormControl[];
}

export type SubmitPolicy = 'auto-submit' | 'fill-only';
export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// Boundary-guarded: "auth(?!or)" avoids misfiring on "author"/"authorize" while "authorization" keeps OAuth grant fields covered; "cid" matches only as a whole word (e.g. not "decide"/"lucid").
const SENSITIVE_NAME_RE =
  /pass(word)?|pwd|secret|token|api[-_]?key|auth(?!or)|authorization|credential|ssn|social[-_]?sec|card[-_]?num|cc[-_]?num|cvc|cvv|\bcid\b|security[-_]?code|expiry|exp[-_]?date|cv2/i;

const NEVER_AUTOCOMPLETE = new Set([
  'current-password', 'new-password', 'cc-number', 'cc-cvc', 'cc-csc',
  'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-name', 'cc-type',
]);

/** Classify a form control. Returns { level, reason }. */
export function classifyField(input: Element): FieldClass {
  const el = input as FormControl;
  const type = (el.getAttribute('type') ?? el.tagName.toLowerCase() ?? '').toLowerCase();
  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase().trim();
  const name = `${el.getAttribute('name') ?? ''} ${el.id}`;
  if (type === 'password') return { level: 'never', reason: 'password field' };
  if (type === 'file') return { level: 'never', reason: 'file upload' };
  if (type === 'hidden') return { level: 'never', reason: 'hidden field (may hold tokens)' };
  if (NEVER_AUTOCOMPLETE.has(autocomplete)) {
    return { level: 'never', reason: `sensitive autocomplete (${autocomplete})` };
  }
  if (autocomplete.startsWith('cc-') || autocomplete.includes('password')) {
    return { level: 'never', reason: `sensitive autocomplete (${autocomplete})` };
  }
  if (SENSITIVE_NAME_RE.test(name)) return { level: 'never', reason: 'sensitive field name' };
  return { level: 'allow', reason: 'general field' };
}

const DESTRUCTIVE_RE =
  /\b(delete|remove|destroy|purge|erase|drop|checkout|pay(ment)?|purchase|place\s+order|buy\s+now|submit\s+payment|confirm\s+payment|transfer|withdraw|cancel\s+(order|subscription|account|booking|plan)|unsubscribe|deactivate)\b/i;

/** Classify a button/submit-like element. */
export function classifyAction(el: Element): ActionClass {
  const label = accessibleActionLabel(el);
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const href = el.tagName === 'A' ? (el.getAttribute('href') ?? '') : '';
  if (/^\s*(javascript|data|vbscript):/i.test(href)) {
    return { level: 'never', reason: 'script URI (never executed by agents)', label };
  }
  if (DESTRUCTIVE_RE.test(label)) {
    return { level: 'confirm', reason: `consequential action "${label}"`, label };
  }
  if (type === 'submit' || el.closest('form')) {
    return { level: 'confirm', reason: `form submission "${label}"`, label };
  }
  return { level: 'allow', reason: `action "${label}"`, label };
}

export function accessibleActionLabel(el: Element): string {
  return (
    el.getAttribute('aria-label') ||
    textOf(el) ||
    el.getAttribute('value') ||
    el.getAttribute('title') ||
    el.getAttribute('name') ||
    'button'
  ).trim();
}

function textOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Classify a form to decide submit policy and synthesized tool shape. */
export function classifyForm(form: HTMLFormElement): FormClassification {
  const fields: FormControl[] = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')
  );
  const hasPassword = fields.some((f) => (f.getAttribute('type') ?? '').toLowerCase() === 'password');
  const hasPayment = fields.some((f) => {
    const ac = (f.getAttribute('autocomplete') ?? '').toLowerCase();
    return ac.startsWith('cc-') || /card[-_]?num|cvv|cvc/i.test(`${f.getAttribute('name') ?? ''} ${f.id}`);
  });
  const method = (form.getAttribute('method') ?? 'get').toLowerCase();
  const action = form.getAttribute('action') ?? '';
  const names = Array.from(form.querySelectorAll('input'))
    .map((f) => f.getAttribute('name') ?? '')
    .join(' ');
  const searchText = /search|query|filter|find|\bq\b/i.test(`${action} ${names}`);
  const hasSubmit = !!form.querySelector('[type=submit], button:not([type]), button[type=submit]');

  let kind: FormKind = 'general';
  let submitPolicy: SubmitPolicy = 'fill-only';
  if (hasPassword) kind = 'auth';
  else if (hasPayment) kind = 'payment';
  else if (searchText && method === 'get') {
    kind = 'search';
    submitPolicy = 'auto-submit';
  } else if (/newsletter|subscribe|email/i.test(form.getAttribute('aria-label') ?? '') && fields.length <= 2) {
    kind = 'newsletter';
  }
  return { kind, submitPolicy, hasSubmit, method, action, fields };
}

/** Truncate tool output to budget. */
export function clampOutput(text: unknown, max: number = MAX_OUTPUT_CHARS): string {
  const s = typeof text === 'string' ? text : JSON.stringify(text) ?? 'null';
  if (s.length <= max) return s;
  return s.slice(0, max) + ` …[truncated, ${s.length - max} chars omitted]`;
}