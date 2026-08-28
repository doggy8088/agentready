/**
 * AgentReady — write tools: activate_target, set_field, fill_form, submit_form.
 * Consequential actions pass the policy gate: "never" fields are refused;
 * "confirm" actions require human approval through the inspector panel.
 */

import { classifyAction, classifyField } from '../policy.js';
import type { FormControl } from '../policy.js';
import { setControlValue } from './controls.js';
import type { ToolDefinition } from '../runtime.js';
import type { AgentEnv } from '../env.js';

export function activateTargetTool(env: AgentEnv): ToolDefinition {
  return {
    name: 'activate_target',
    description:
      'Activate a page element by ref: click buttons, links, tabs, toggles. ' +
      'Consequential actions (submit, pay, delete) require user approval in the on-page panel.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'Ref from find_on_page' } },
      required: ['ref'],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: ({ ref }) => activate(env, String(ref ?? '')),
  };
}

export function setFieldTool(env: AgentEnv): ToolDefinition {
  return {
    name: 'set_field',
    description: 'Set one form field by ref: text inputs, textarea, select, checkbox, radio.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref from find_on_page' },
        value: { type: 'string', description: 'New value (for checkbox: "true"/"false")' },
      },
      required: ['ref', 'value'],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: ({ ref, value }) => setField(env, String(ref ?? ''), String(value ?? '')),
  };
}

export function fillFormTool(env: AgentEnv): ToolDefinition {
  return {
    name: 'fill_form',
    description:
      'Fill a form in one call. Fields are matched by human-readable label or name. ' +
      'Sensitive fields (passwords, payment) are refused. Never submits the form.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the form or any field inside it (from find_on_page)' },
        values: {
          type: 'object',
          description: 'Map of field name/label to value, e.g. {"Email": "a@b.c", "Quantity": "2"}',
        },
      },
      required: ['ref', 'values'],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: ({ ref, values }) => fillForm(env, String(ref ?? ''), (values ?? {}) as Record<string, unknown>),
  };
}

export function submitFormTool(env: AgentEnv): ToolDefinition {
  return {
    name: 'submit_form',
    description:
      'Submit a form after review. Always requires explicit human approval via the on-page panel. ' +
      'Use fill_form first, then submit_form with the form ref.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref of the form or any field inside it' },
        summary: { type: 'string', description: 'Short human-readable summary of what will be submitted' },
      },
      required: ['ref', 'summary'],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: ({ ref, summary }) => submitForm(env, String(ref ?? ''), String(summary ?? '')),
  };
}

// ---------- implementations ----------

async function activate(env: AgentEnv, ref: string): Promise<string> {
  const el = env.resolveRef(ref);
  if (!el) return `Ref "${ref}" is stale. Run find_on_page again.`;
  if (!env.isVisible(el)) return 'Target is not visible on the page.';
  const cls = classifyAction(el);
  if (cls.level === 'never') return `Refused: ${cls.reason}.`;
  const ok = await env.confirmGate({ title: `Activate "${cls.label}"`, detail: cls.reason, level: cls.level, el });
  if (!ok) return 'User declined to activate this target. Nothing happened.';
  env.highlight(el, { sticky: true });
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  (el as HTMLElement).click();
  return `Activated "${cls.label}". If the page navigated, re-orient with get_page_context.`;
}

function setField(env: AgentEnv, ref: string, value: string): string {
  const el = env.resolveRef(ref);
  if (!el) return `Ref "${ref}" is stale. Run find_on_page again.`;
  const cls = classifyField(el);
  if (cls.level === 'never') return `Refused: ${cls.reason}. This field is never exposed to agents.`;
  env.highlight(el, { sticky: true });
  const ok = setControlValue(el as FormControl, value);
  if (!ok) return `Could not set "${env.labelOf(el)}" to ${JSON.stringify(value)} (e.g. select option not found).`;
  el.scrollIntoView?.({ block: 'center' });
  return `Set "${env.labelOf(el)}" = ${JSON.stringify(env.redact(el, String(value)))}`;
}

export function fieldLabel(field: Element): string {
  const labels = (field as HTMLInputElement).labels;
  if (labels?.[0]) return labels[0].textContent.replace(/\s+/g, ' ').trim();
  return (
    field.getAttribute('aria-label') ??
    field.getAttribute('placeholder') ??
    field.getAttribute('name') ??
    field.id ??
    ''
  );
}

function matchField(field: FormControl, key: string): boolean {
  const q = String(key).trim().toLowerCase();
  if (!q) return false;
  const candidates = [
    field.getAttribute('name')?.toLowerCase(),
    field.id.toLowerCase(),
    fieldLabel(field).toLowerCase(),
    field.getAttribute('placeholder')?.toLowerCase(),
  ].filter((c): c is string => !!c);
  return candidates.some((c) => c === q || c.includes(q) || q.includes(c));
}

function fillForm(env: AgentEnv, ref: string, values: Record<string, unknown>): string {
  const el = env.resolveRef(ref);
  if (!el) return `Ref "${ref}" is stale. Run find_on_page again.`;
  const form = el.tagName === 'FORM' ? (el as HTMLFormElement) : el.closest('form');
  if (!form) return 'Target is not a form and is not inside one.';
  const fields = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')
  ).filter((f) => env.isVisible(f) && !f.disabled && f.getAttribute('type') !== 'hidden');

  const results: Array<{ field: string; status: string; reason?: string; value?: string }> = [];
  const notFound: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const value = raw == null ? '' : String(raw);
    const field = fields.find((f) => matchField(f, key));
    if (!field) {
      notFound.push(key);
      continue;
    }
    const cls = classifyField(field);
    if (cls.level === 'never') {
      results.push({ field: fieldLabel(field) || key, status: 'refused', reason: cls.reason });
      continue;
    }
    const ok = setControlValue(field, value);
    env.highlight(field);
    results.push({
      field: fieldLabel(field) || key,
      status: ok ? 'set' : 'failed',
      value: ok ? env.redact(field, String(value)) : undefined,
    });
  }
  const missing = fields
    .filter(
      (f) =>
        f.hasAttribute('required') &&
        f.value === '' &&
        (f as HTMLInputElement).type !== 'checkbox' &&
        (f as HTMLInputElement).type !== 'radio'
    )
    .map((f) => fieldLabel(f) || (f.getAttribute('name') ?? ''));
  const formName =
    form.getAttribute('aria-label') ?? form.getAttribute('name') ?? ((fields[0] ? fieldLabel(fields[0]!) : '') || 'form');
  const out = {
    form: formName,
    filled: results,
    ...(notFound.length ? { notFound } : {}),
    ...(missing.length ? { stillRequired: missing } : {}),
    note: 'Form filled but NOT submitted. Call submit_form when ready (requires user approval).',
  };
  return JSON.stringify(out);
}

async function submitForm(env: AgentEnv, ref: string, summary: string): Promise<string> {
  const el = env.resolveRef(ref);
  if (!el) return `Ref "${ref}" is stale. Run find_on_page again.`;
  const form = el.tagName === 'FORM' ? (el as HTMLFormElement) : el.closest('form');
  if (!form) return 'Target is not inside a form.';
  const submit = form.querySelector<HTMLInputElement | HTMLButtonElement>('[type=submit], button[type=submit], button:not([type])');
  if (!submit) return 'Form has no visible submit control.';
  const ok = await env.confirmGate({
    title: 'Submit form?',
    detail: summary || 'An agent wants to submit this form. Review before approving.',
    level: 'confirm',
    el: form,
  });
  if (!ok) return 'User declined to submit. Nothing was sent.';
  env.highlight(submit, { sticky: true });
  if (typeof form.requestSubmit === 'function') form.requestSubmit(submit);
  else submit.click();
  return 'Form submitted after user approval.';
}