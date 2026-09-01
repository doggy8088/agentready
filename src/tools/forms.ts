/**
 * AgentReady — form tool synthesis.
 * Turns a semantic <form> into one domain tool with a real JSON Schema
 * (e.g. search_products({ q, category, max_price })). Level 1 data-agent-*
 * attributes override name/description/submit behavior.
 */

import { classifyField, classifyForm } from '../policy.js';
import type { FormControl } from '../policy.js';
import { setControlValue } from './controls.js';
import { escapeCss } from '../semantic.js';
import { fieldLabel } from './interact.js';
import type { ToolDefinition } from '../runtime.js';
import type { AgentEnv, FormFieldSpec, FormInfo } from '../env.js';

const MAX_SYNTHESIZED = 8;
const MAX_OPTIONS_IN_SCHEMA = 24;
// Chrome secure-tools guidance: ≤30 chars per tool name, ≤150 per param description.
const MAX_NAME_CHARS = 30;
const MAX_PARAM_DESC_CHARS = 150;

export function synthesizeFormTools(env: AgentEnv): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const used = new Set<string>();
  const forms = env.snapshot.forms;

  const priority = (f: HTMLFormElement) => (f.hasAttribute('data-agent-priority') ? -1 : 0);
  const sorted = [...forms].sort((a, b) => priority(a) - priority(b)).slice(0, MAX_SYNTHESIZED);

  for (const form of sorted) {
    const info = analyzeForm(form);
    if (!info) continue;
    let name = info.name;
    let i = 2;
    while (used.has(name)) name = `${info.name}_${i++}`;
    used.add(name);
    env.formInfo.set(form, info);
    tools.push(buildTool(env, info, name));
  }
  return tools;
}

export function analyzeForm(form: HTMLFormElement): FormInfo | null {
  const cls = classifyForm(form);
  const rawName =
    form.getAttribute('data-agent-name') ??
    form.getAttribute('data-agent-tool') ??
    form.getAttribute('aria-label') ??
    form.getAttribute('name') ??
    headingNear(form) ??
    (cls.kind === 'search'
      ? 'search'
      : slug(form.getAttribute('action') ?? '') ||
        `form_${slug(fieldLabel(cls.fields[0] ?? form) || 'form')}`);
  const name = slug(rawName) || 'form';

  const fields: FormFieldSpec[] = [];
  const seenRadios = new Set<string>();
  for (const f of cls.fields) {
    const type = (f.getAttribute('type') ?? '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || f.disabled) continue;
    if (f.closest('[data-agent-hide]')) continue;
    if (classifyField(f).level === 'never') continue; // excluded from schema entirely
    if (type === 'radio') {
      const key = f.getAttribute('name') ?? '';
      if (key && seenRadios.has(key)) continue;
      if (key) seenRadios.add(key);
      fields.push(radioField(form, f as HTMLInputElement));
      continue;
    }
    fields.push(specFor(f as FormControl));
  }
  if (!fields.length) return null;

  const descOverride = form.getAttribute('data-agent-description');
  const description = (
    descOverride ?? defaultDesc(cls.kind, name, fields)
  ).slice(0, 460);

  return {
    name,
    description,
    fields,
    kind: cls.kind,
    submitPolicy: submitPolicyOf(form, cls),
    formEl: form,
    hasSubmit: cls.hasSubmit,
  };
}

function specFor(f: FormControl): FormFieldSpec {
  const base: FormFieldSpec = {
    key: f.getAttribute('name') ?? f.id ?? slug(fieldLabel(f)) ?? `field_${Date.now() % 1000}`,
    label: fieldLabel(f) || (f.getAttribute('name') ?? (f.getAttribute('type') ?? 'field')),
    el: f,
    type: jsonTypeOf(f),
    required: f.hasAttribute('required') || f.getAttribute('aria-required') === 'true',
    description: fieldDesc(f),
  };
  if (base.type === 'number') {
    const min = (f as HTMLInputElement).min;
    const max = (f as HTMLInputElement).max;
    if (min !== '' && !Number.isNaN(+min)) base.minimum = +min;
    if (max !== '' && !Number.isNaN(+max)) base.maximum = +max;
  }
  if (f.tagName === 'SELECT') {
    const e = selectEnum(f as HTMLSelectElement);
    if (e) base.enum = e;
  }
  return base;
}

function buildTool(env: AgentEnv, info: FormInfo, name: string): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of info.fields) {
    properties[f.key] = {
      type: f.type,
      description: f.description.slice(0, MAX_PARAM_DESC_CHARS),
      ...(f.enum ? { enum: f.enum } : {}),
      ...(f.minimum !== undefined ? { minimum: f.minimum } : {}),
      ...(f.maximum !== undefined ? { maximum: f.maximum } : {}),
    };
    if (f.required) required.push(f.key);
  }
  const submitNote =
    info.submitPolicy === 'auto-submit'
      ? 'Runs the search immediately.'
      : 'Fills the form but never submits it — call submit_form when ready.';
  const title = info.formEl.getAttribute('aria-label') ?? name.replace(/_/g, ' ');

  return {
    name,
    title: title.slice(0, MAX_NAME_CHARS),
    description: `${info.description} ${submitNote}`.trim(),
    inputSchema: {
      type: 'object',
      properties,
      additionalProperties: false,
      ...(required.length ? { required } : {}),
    },
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: true,
    },
    execute: async (args) => runFormTool(env, info, args),
  };
}

async function runFormTool(env: AgentEnv, info: FormInfo, args: Record<string, unknown>): Promise<string> {
  const form = info.formEl;
  if (!form.isConnected) {
    return 'This form is no longer on the page. Re-orient with get_page_context.';
  }
  const filled: Array<{ field: string; value: string; ok: boolean }> = [];
  const refused: string[] = [];
  const failed: string[] = [];
  for (const f of info.fields) {
    if (!(f.key in args)) continue;
    const raw = args[f.key];
    if (raw === '' || raw == null) continue;
    if (classifyField(f.el).level === 'never') {
      refused.push(f.key);
      continue;
    }
    const ok = setControlValue(f.el, raw as string | number | boolean);
    env.highlight(f.el);
    filled.push({ field: f.label, value: env.redact(f.el, String(raw)), ok });
    if (!ok) failed.push(f.key);
  }
  const notProvided = info.fields.filter((f) => f.required && !(f.key in args)).map((f) => f.key);
  if (notProvided.length) {
    return JSON.stringify({ status: 'missing-required', required: notProvided, filled });
  }

  if (info.submitPolicy === 'auto-submit' && !failed.length) {
    const submit = form.querySelector<HTMLInputElement | HTMLButtonElement>('[type=submit], button[type=submit], button:not([type])');
    env.highlight(submit ?? form, { sticky: true });
    if (form.requestSubmit && submit) form.requestSubmit(submit);
    else if (submit) submit.click();
    else form.submit();
    env.onActivity({ tool: info.name, phase: 'submitted', args });
    return JSON.stringify({
      status: 'submitted',
      filled,
      note: 'Search executed. Re-orient with get_page_context to see results.',
    });
  }
  return JSON.stringify({
    status: 'filled',
    filled,
    ...(refused.length ? { refused } : {}),
    note: 'Form filled but NOT submitted. Call submit_form when ready (requires user approval).',
  });
}

// ---------- helpers ----------

function jsonTypeOf(f: FormControl): 'string' | 'number' {
  const t = (f.getAttribute('type') ?? '').toLowerCase();
  return t === 'number' || t === 'range' ? 'number' : 'string';
}

function selectEnum(f: HTMLSelectElement): string[] | undefined {
  const opts = Array.from(f.options)
    .filter((o) => !o.disabled)
    .map((o) => o.textContent.trim() || o.value)
    .slice(0, MAX_OPTIONS_IN_SCHEMA);
  return opts.length ? [...new Set(opts)] : undefined;
}

function radioField(form: HTMLFormElement, radio: HTMLInputElement): FormFieldSpec {
  const name = radio.getAttribute('name') ?? '';
  const group = name
    ? Array.from(form.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${escapeCss(form.ownerDocument, name)}"]`))
    : [radio];
  return {
    key: name || slug(fieldLabel(radio)) || 'choice',
    label: fieldLabel(radio) || name,
    el: radio,
    type: 'string',
    required: radio.hasAttribute('required') || radio.getAttribute('aria-required') === 'true',
    description: fieldDesc(radio),
    enum: [...new Set(group.map((r) => r.value || radioLabelOf(r)))].slice(0, MAX_OPTIONS_IN_SCHEMA),
    group,
  };
}

function radioLabelOf(r: HTMLInputElement): string {
  return r.labels?.[0]?.textContent?.trim() ?? '';
}

function fieldDesc(f: FormControl): string {
  const bits: string[] = [];
  const label = fieldLabel(f);
  if (label) bits.push(label);
  const placeholder = f.getAttribute('placeholder');
  if (placeholder) bits.push(`placeholder: ${placeholder}`);
  const described = f.getAttribute('aria-describedby');
  if (described) {
    const d = f.ownerDocument.getElementById(described.split(/\s+/)[0] ?? '');
    if (d) bits.push((d.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80));
  }
  if ((f.getAttribute('type') ?? '') === 'email') bits.push('email address');
  return bits.join('. ') || 'value';
}

function headingNear(form: HTMLFormElement): string {
  const prev = form.previousElementSibling;
  if (prev && /^H[1-6]$/.test(prev.tagName)) return (prev.textContent ?? '').trim();
  const aria = form.closest('[aria-label], section, fieldset');
  const h = aria?.querySelector('h1, h2, h3, legend');
  return h ? (h.textContent ?? '').trim() : '';
}

function defaultDesc(kind: string, name: string, fields: FormFieldSpec[]): string {
  const fl = fields.map((f) => f.label).slice(0, 8).join(', ');
  if (kind === 'search') return `Search: fill the search fields (${fl}) and run the search.`;
  if (kind === 'newsletter') return 'Subscribe with an email address. Fills the form; never submits.';
  return `Fill the "${name}" form. Fields: ${fl}.`;
}

function submitPolicyOf(
  form: HTMLFormElement,
  cls: ReturnType<typeof classifyForm>
): FormInfo['submitPolicy'] {
  const override = (form.getAttribute('data-agent-submit') ?? '').toLowerCase();
  if (['auto', 'auto-submit'].includes(override)) return 'auto-submit';
  if (override === 'never' || override === 'confirm') return 'fill-only';
  return cls.submitPolicy;
}

function slug(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\.[a-z]+$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_NAME_CHARS);
}