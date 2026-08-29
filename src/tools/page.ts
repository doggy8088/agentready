/**
 * AgentReady — read tools: get_page_context, find_on_page, read_target.
 * All read-only, all outputs marked untrustedContentHint.
 */

import { clampOutput, MAX_RESULTS } from '../policy.js';
import { matchNodes } from '../semantic.js';
import type { ToolDefinition } from '../runtime.js';
import type { AgentEnv, FormInfo } from '../env.js';

export function pageContextTool(env: AgentEnv): ToolDefinition {
  return {
    name: 'get_page_context',
    title: 'Page context',
    description:
      'Get a semantic summary of the current page: title, headings, regions, ' +
      'available actions overview, and forms. Call this first to orient.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () => pageContext(env),
  };
}

export function findTool(env: AgentEnv): ToolDefinition {
  return {
    name: 'find_on_page',
    title: 'Find on page',
    description:
      'Find interactive elements or content on the page by natural-language description. ' +
      'Returns semantic refs usable with read_target / activate_target / set_field. ' +
      'kind: "any" | "action" (buttons, links, tabs) | "field" (inputs, selects).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, e.g. "Add to cart for MacBook Pro"' },
        kind: { type: 'string', enum: ['any', 'action', 'field'], description: 'Limit result kinds' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: ({ query, kind }) => findOnPage(env, String(query ?? ''), kind as string | undefined),
  };
}

export function readTargetTool(env: AgentEnv): ToolDefinition {
  return {
    name: 'read_target',
    title: 'Read target',
    description:
      'Read details of one element by semantic ref: current value, options, link target, ' +
      'or surrounding content.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'Ref from find_on_page' } },
      required: ['ref'],
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: ({ ref }) => readTarget(env, String(ref ?? '')),
  };
}

function pageContext(env: AgentEnv): string {
  const snapshot = env.discover();
  const out = {
    title: env.doc.title,
    url: env.doc.URL || env.doc.location?.href || '',
    headings: snapshot.headings.slice(0, 12).map((h) => `${'#'.repeat(h.level)} ${h.text}`),
    regions: snapshot.landmarks.slice(0, 10).map((l) => `${l.role}: ${l.label}`.trim()),
    counts: {
      buttons: snapshot.nodes.filter((n) => n.role === 'button').length,
      links: snapshot.nodes.filter((n) => n.role === 'link').length,
      fields: snapshot.nodes.filter((n) => n.field).length,
      forms: snapshot.forms.length,
    },
    forms: snapshot.forms
      .map((f) => {
        const info: FormInfo | undefined = env.formInfo.get(f);
        return info ? { form: info.name, fields: info.fields.map((fl) => fl.key).slice(0, 10) } : null;
      })
      .filter((x): x is { form: string; fields: string[] } => x !== null),
    note: 'Use find_on_page to locate elements, then activate_target / set_field / fill_form to act.',
  };
  return clampOutput(out);
}

function findOnPage(env: AgentEnv, query: string, kind: string | undefined): string {
  const snapshot = env.discover();
  const narrow = kind === 'action' || kind === 'field' ? kind : undefined;
  const hits = matchNodes(query, snapshot.nodes, { kind: narrow, limit: MAX_RESULTS });
  if (!hits.length) return `No match for "${query}". Try get_page_context to see what is available.`;
  const results = hits.map((n) => ({
    ref: n.ref,
    role: n.role,
    name: n.name,
    ...(n.value ? { value: n.value } : {}),
    context: n.context || undefined,
    actionRisk: n.action?.level ?? n.field?.level ?? undefined,
  }));
  return clampOutput({ results });
}

function readTarget(env: AgentEnv, ref: string): string {
  const el = env.resolveRef(ref);
  if (!el) return `Ref "${ref}" is stale (element removed or page re-rendered). Run find_on_page again.`;
  env.highlight(el);
  const node = env.describe(el);
  if (node.hiddenFromAgents) {
    return clampOutput({ ref: node.ref, role: node.role, name: node.name, note: 'Sensitive field: values are never exposed to agents.' });
  }
  const out: Record<string, unknown> = { ...node };
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') {
    out.options = Array.from((el as HTMLSelectElement).options)
      .slice(0, 30)
      .map((o) => ({ value: o.value, label: o.textContent.trim() }));
  }
  if (tag === 'a') out.href = (el as HTMLAnchorElement).href;
  if ((tag === 'input' || tag === 'textarea') && !['checkbox', 'radio', 'password'].includes((el as HTMLInputElement).type ?? '')) {
    out.currentValue = env.redact(el, (el as HTMLInputElement).value).slice(0, 200);
  }
  if (tag === 'textarea' || !['INPUT', 'SELECT', 'BUTTON', 'A', 'TEXTAREA'].includes(el.tagName)) {
    out.text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 800);
  }
  return clampOutput(out);
}