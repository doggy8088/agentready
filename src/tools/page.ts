/**
 * AgentReady — read tools: get_page_context, find_on_page, read_target.
 * All read-only, all outputs marked untrustedContentHint.
 */

import type { AgentEnv, FormInfo } from '../env.js';
import { clampOutput, MAX_OUTPUT_CHARS, MAX_RESULTS } from '../policy.js';
import type { ToolDefinition } from '../runtime.js';
import {
  collectTextBlocks,
  type FindKind,
  foldText,
  parseQuery,
  queryTerms,
  readableText,
  refFor,
  type SemanticNode,
  scoreBlocks,
  scoreNodes,
  type TextHit,
} from '../semantic.js';

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
      'Search the page for a keyword or description. Matches interactive elements (buttons, links, fields) ' +
      'AND visible page text (paragraphs, headings, tables, lists), in any language including Chinese/Japanese/Korean. ' +
      'Interactive hits return refs for read_target / activate_target / set_field; text hits return a snippet ' +
      '(call read_target with its ref for the surrounding content). ' +
      'kind: "any" (default) | "action" (buttons, links, tabs) | "field" (inputs, selects) | "text" (page content only). ' +
      'If nothing matches, the reply lists what was searched and what to try next.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keyword(s) or a short description, e.g. "Add to cart for MacBook Pro", "三年保固". ' +
            'Prefer distinctive words as they appear on the page.',
        },
        kind: { type: 'string', enum: ['any', 'action', 'field', 'text'], description: 'Limit result kinds' },
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
      'Read details of one element by semantic ref: current value, options, link target, ' + 'or surrounding content.',
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

/** Serialize {results, ...meta}, dropping trailing results until the JSON fits the output budget (never cut mid-object). */
function fitResults(results: object[], meta: Record<string, unknown>, total: number): string {
  for (let n = results.length; n >= 1; n--) {
    const omitted = total - n;
    const out = JSON.stringify({
      results: results.slice(0, n),
      ...(total > n
        ? { total, omitted, hint: `${omitted} more match(es) not shown; refine the query or use kind.` }
        : {}),
      ...meta,
    });
    if (out.length <= MAX_OUTPUT_CHARS) return out;
  }
  return clampOutput({ results: results.slice(0, 1), ...meta });
}

function findOnPage(env: AgentEnv, query: string, kind: string | undefined): string {
  const snapshot = env.discover();
  const narrow: FindKind | undefined = kind === 'action' || kind === 'field' || kind === 'text' ? kind : undefined;
  const limit = Math.max(1, env.config.maxResults || MAX_RESULTS);
  const q = parseQuery(query);

  const nodeHits = scoreNodes(q, snapshot.nodes, narrow);
  const wantText = narrow === undefined || narrow === 'text';
  const index =
    wantText || !nodeHits.length ? collectTextBlocks(env.doc, { deep: env.config.shadowDiscovery === true }) : null;
  const nodeTexts = snapshot.nodes.map((n) => foldText(n.text ?? n.name));
  // A text block wholly contained in an interactive element's label is that element, not new content.
  const textHits = (index ? scoreBlocks(q, index.blocks) : []).filter(
    (h) => !nodeTexts.some((t) => t.includes(h.block.folded)),
  );

  if (!nodeHits.length && (!wantText || !textHits.length)) {
    return noMatch(env, query, q, snapshot.nodes.length, index, narrow, wantText ? 0 : textHits.length);
  }

  type Ranked =
    | { score: number; node: SemanticNode; text?: undefined }
    | { score: number; text: TextHit; node?: undefined };
  const merged: Ranked[] = [
    ...nodeHits.map((h): Ranked => ({ score: h.score + 1, node: h.node })),
    ...(wantText ? textHits.map((h): Ranked => ({ score: h.score, text: h })) : []),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const total = nodeHits.length + (wantText ? textHits.length : 0);

  const results = merged.map((m) => {
    if (m.node) {
      const n = m.node;
      const risk = n.action?.level ?? n.field?.level;
      return {
        ref: n.ref,
        role: n.role,
        name: n.name,
        ...(n.value ? { value: n.value } : {}),
        ...(n.context ? { context: n.context } : {}),
        ...(risk ? { actionRisk: risk } : {}),
      };
    }
    const { block, snippet } = m.text;
    return {
      ref: refFor(block.el),
      role: 'text',
      text: snippet,
      ...(block.section && !block.text.startsWith(block.section) ? { section: block.section } : {}),
    };
  });
  const meta: Record<string, unknown> = {};
  if (index?.truncated) meta.scanTruncated = 'Page is very large; only part of its text was searched.';
  return fitResults(results, meta, total);
}

/** Zero-hit reply: say what was searched and what to try, so the model can retry instead of giving up. */
function noMatch(
  env: AgentEnv,
  query: string,
  q: ReturnType<typeof parseQuery>,
  interactive: number,
  index: ReturnType<typeof collectTextBlocks> | null,
  kind: FindKind | undefined,
  hiddenTextMatches: number,
): string {
  const lang = env.doc.documentElement?.getAttribute('lang') ?? '';
  const out: Record<string, unknown> = {
    results: [],
    message: `No match for "${query}".`,
    searched: {
      terms: queryTerms(q),
      interactiveElements: kind === 'text' ? 0 : interactive,
      textBlocks: index?.blocks.length ?? 0,
      ...(lang ? { pageLanguage: lang } : {}),
    },
    hint:
      'Try a shorter or different keyword, a synonym, or the wording in the page language; ' +
      'a partial word often works (e.g. "warrant"). ' +
      (hiddenTextMatches
        ? `${hiddenTextMatches} page-text match(es) exist but kind "${kind}" excludes them: retry with kind "any" or "text". `
        : '') +
      'get_page_context lists headings and forms to guide the next query.',
  };
  if (index?.truncated) out.scanTruncated = 'Page is very large; only part of its text was searched.';
  const headings = env
    .discover()
    .headings.slice(0, 6)
    .map((h) => h.text.slice(0, 50));
  if (headings.length) out.headings = headings;
  return clampOutput(out);
}

function readTarget(env: AgentEnv, ref: string): string {
  const el = env.resolveRef(ref);
  if (!el) return `Ref "${ref}" is stale (element removed or page re-rendered). Run find_on_page again.`;
  env.highlight(el);
  const node = env.describe(el);
  if (node.hiddenFromAgents) {
    return clampOutput({
      ref: node.ref,
      role: node.role,
      name: node.name,
      note: 'Sensitive field: values are never exposed to agents.',
    });
  }
  const out: Record<string, unknown> = { ...node };
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') {
    out.options = Array.from((el as HTMLSelectElement).options)
      .slice(0, 30)
      .map((o) => ({ value: o.value, label: o.textContent.trim() }));
  }
  if (tag === 'a') out.href = (el as HTMLAnchorElement).href;
  if (
    (tag === 'input' || tag === 'textarea') &&
    !['checkbox', 'radio', 'password'].includes((el as HTMLInputElement).type ?? '')
  ) {
    out.currentValue = env.redact(el, (el as HTMLInputElement).value).slice(0, 200);
  }
  if (tag === 'textarea' || !['INPUT', 'SELECT', 'BUTTON', 'A', 'TEXTAREA'].includes(el.tagName)) {
    // readableText drops hidden/sensitive/control content that raw textContent would leak.
    out.text = readableText(el, 800);
    if (node.role === 'generic') out.name = String(out.text).slice(0, 80);
  }
  return clampOutput(out);
}
