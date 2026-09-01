import { describe, it, expect, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import { classifyAction, classifyField, classifyForm, clampOutput, MAX_OUTPUT_CHARS } from '../src/policy.js';
import { discover, matchNodes, refFor, resolveRef, describeNode, escapeCss } from '../src/semantic.js';
import type { Discovery } from '../src/semantic.js';
import { analyzeForm, synthesizeFormTools } from '../src/tools/forms.js';
import { setControlValue } from '../src/tools/controls.js';
import { Runtime } from '../src/runtime.js';
import type { AgentEnv } from '../src/env.js';
import { pageContextTool, findTool, readTargetTool } from '../src/tools/page.js';
import { activateTargetTool, fillFormTool, setFieldTool } from '../src/tools/interact.js';
import { Inspector } from '../src/inspector.js';

let document: Document;

function mount(html: string): Document {
  const win = new Window({ url: 'https://shop.example.com/' });
  document = win.document as unknown as Document;
  document.body.innerHTML = html;
  return document;
}

function makeEnv(doc: Document, { approve = true } = {}): AgentEnv {
  let snapshotCache: Discovery | null = null;
  return {
    doc,
    config: { inspector: false, siteName: 'test', maxResults: 8 },
    formInfo: new Map(),
    discover() {
      snapshotCache = discover(doc);
      return snapshotCache!;
    },
    get snapshot() {
      return snapshotCache ?? this.discover();
    },
    describe: (el) => describeNode(el, doc),
    resolveRef,
    isVisible: () => true,
    classifyField,
    labelOf: (el) => el.getAttribute('name') ?? el.id ?? el.tagName.toLowerCase(),
    redact: (el, v) => (el && classifyField(el).level === 'never' ? '••••' : v),
    highlight: () => undefined,
    confirmGate: () => Promise.resolve(approve),
    onActivity: () => undefined,
  };
}

// ---------- policy ----------

describe('policy.classifyField', () => {
  it('never-exposes password, payment and token-like fields', () => {
    const doc = mount(
      '<form><input type="password" name="pw"><input name="card_number" autocomplete="cc-number"><input type="hidden" name="csrf" value="tok"></form>'
    );
    const inputs = doc.querySelectorAll('input');
    expect(classifyField(inputs[0]!).level).toBe('never');
    expect(classifyField(inputs[1]!).level).toBe('never');
    expect(classifyField(inputs[2]!).level).toBe('never');
  });

  it('allows normal fields', () => {
    const doc = mount('<form><input name="email" type="email"><input name="qty" type="number"></form>');
    for (const el of doc.querySelectorAll('input')) {
      expect(classifyField(el).level).toBe('allow');
    }
  });

  it('detects sensitive names', () => {
    const doc = mount('<form><input name="api_key"></form>');
    expect(classifyField(doc.querySelector('input')!).level).toBe('never');
  });
});

describe('policy.classifyForm', () => {
  it('search GET forms auto-submit', () => {
    const doc = mount('<form method="get" action="/search"><input name="q" type="search"><button>Go</button></form>');
    const cls = classifyForm(doc.querySelector('form')!);
    expect(cls.kind).toBe('search');
    expect(cls.submitPolicy).toBe('auto-submit');
  });

  it('password forms are fill-only auth', () => {
    const doc = mount('<form method="post" action="/login"><input type="password" name="pw"><input name="user"></form>');
    const cls = classifyForm(doc.querySelector('form')!);
    expect(cls.kind).toBe('auth');
    expect(cls.submitPolicy).toBe('fill-only');
  });

  it('payment forms are fill-only', () => {
    const doc = mount('<form method="post"><input name="cc_num" autocomplete="cc-number"></form>');
    expect(classifyForm(doc.querySelector('form')!).kind).toBe('payment');
  });

  it('data-agent-submit overrides the policy', () => {
    const doc = mount(
      '<form method="get" action="/search" data-agent-submit="never"><input name="q" type="search"><button>Go</button></form>'
    );
    const info = analyzeForm(doc.querySelector('form')!)!;
    expect(info.submitPolicy).toBe('fill-only');
  });
});

describe('policy.clampOutput + escapeCss', () => {
  it('truncates over-budget output', () => {
    const out = clampOutput('x'.repeat(MAX_OUTPUT_CHARS + 500));
    expect(out.length).toBeLessThan(MAX_OUTPUT_CHARS + 100);
    expect(out).toContain('truncated');
  });
  it('passes through short output', () => {
    expect(clampOutput('hello')).toBe('hello');
  });
  it('escapes css selectors', () => {
    const doc = mount('<div></div>');
    expect(escapeCss(doc, 'a.b:c')).toBe('a\\.b\\:c');
  });
});

// ---------- semantic ----------

describe('semantic discovery + matching', () => {
  const page = (): Document =>
    mount(`
    <main>
      <h1>Laptops</h1>
      <article data-id="mbp"><h2>MacBook Pro</h2><p>$1,999</p><button aria-label="Add MacBook Pro to cart">Add to cart</button></article>
      <article><h2>Dell XPS</h2><p>$999</p><button>Add to cart</button></article>
      <a href="/support">Contact support</a>
      <form><input type="password" name="pw" value="hunter2"></form>
    </main>`);

  it('assigns stable refs across discovery passes', () => {
    const d = page();
    const btn = d.querySelector('button')!;
    const r1 = refFor(btn);
    const { nodes } = discover(d);
    const n = nodes.find((x) => x.ref === r1);
    expect(n).toBeTruthy();
    expect(resolveRef(r1)).toBe(btn);
  });

  it('resolves stale refs to null', () => {
    const d = page();
    const btn = d.querySelector('button')!;
    const ref = refFor(btn);
    btn.remove();
    expect(resolveRef(ref)).toBeNull();
  });

  it('finds elements by natural language', () => {
    const d = page();
    const { nodes } = discover(d);
    const hits = matchNodes('add MacBook Pro to cart', nodes);
    expect(hits[0]!.name).toContain('MacBook Pro');
  });

  it('filters by kind=action', () => {
    const d = page();
    const { nodes } = discover(d);
    const hits = matchNodes('support', nodes, { kind: 'action' });
    expect(hits[0]!.role).toBe('link');
  });

  it('never exposes password values (security)', () => {
    const d = page();
    const described = describeNode(d.querySelector('input[type=password]')!, d);
    expect(described.hiddenFromAgents).toBe(true);
    expect(described.value).toBeUndefined();
    expect(JSON.stringify(described)).not.toContain('hunter2');
    const { nodes } = discover(d);
    expect(JSON.stringify(nodes)).not.toContain('hunter2');
  });
});

// ---------- controls ----------

describe('setControlValue', () => {
  it('sets select by label text and fires events', () => {
    const doc = mount(
      '<form><select name="size"><option value="s">Small</option><option value="l">Large</option></select></form>'
    );
    const sel = doc.querySelector('select')!;
    let changed = 0;
    sel.addEventListener('change', () => changed++);
    expect(setControlValue(sel, 'Large')).toBe(true);
    expect(sel.value).toBe('l');
    expect(changed).toBe(1);
    expect(setControlValue(sel, 'Huge')).toBe(false);
  });

  it('toggles checkboxes with truthy strings', () => {
    const doc = mount('<form><input type="checkbox" name="tos"></form>');
    const cb = doc.querySelector('input')!;
    setControlValue(cb, 'true');
    expect(cb.checked).toBe(true);
    setControlValue(cb, 'false');
    expect(cb.checked).toBe(false);
  });

  it('sets radios by value', () => {
    const doc = mount('<form><input type="radio" name="size" value="s"><input type="radio" name="size" value="m"></form>');
    const radios = doc.querySelectorAll('input');
    expect(setControlValue(radios[1]!, 'm')).toBe(true);
    expect(radios[1]!.checked).toBe(true);
    expect(setControlValue(radios[0]!, 'nope')).toBe(false);
  });
});

// ---------- form synthesis ----------

describe('form tool synthesis', () => {
  it('builds a typed schema from a search form', () => {
    const doc = mount(`
      <form aria-label="Product search" method="get" action="/search">
        <input name="q" type="search" placeholder="Search the catalog">
        <select name="category"><option value="">All</option><option>Keyboards</option><option>Mice</option></select>
        <input name="max_price" type="number" min="0" max="2000">
        <button>Search</button>
      </form>`);
    const info = analyzeForm(doc.querySelector('form')!)!;
    expect(info.name).toBe('product_search');
    expect(info.submitPolicy).toBe('auto-submit');
    expect(info.fields.map((f) => f.key)).toEqual(['q', 'category', 'max_price']);
    const cat = info.fields.find((f) => f.key === 'category')!;
    expect(cat.enum).toEqual(['All', 'Keyboards', 'Mice']);
    const maxp = info.fields.find((f) => f.key === 'max_price')!;
    expect(maxp.minimum).toBe(0);
    expect(maxp.maximum).toBe(2000);
  });

  it('excludes sensitive fields from the schema', () => {
    const doc = mount(`
      <form method="post">
        <input name="email" type="email">
        <input type="password" name="pw">
        <input name="card_number" autocomplete="cc-number">
        <button>Sign up</button>
      </form>`);
    const info = analyzeForm(doc.querySelector('form')!)!;
    expect(info.fields.map((f) => f.key)).toEqual(['email']);
  });

  it('respects data-agent-name (Level 1) and hides data-agent-hide fields', () => {
    const doc = mount(`
      <form data-agent-name="search_products" data-agent-description="Search products in the catalog">
        <input name="q">
        <input name="internal_tag" data-agent-hide>
        <button>Go</button>
      </form>`);
    const info = analyzeForm(doc.querySelector('form')!)!;
    expect(info.name).toBe('search_products');
    expect(info.description).toContain('Search products in the catalog');
    expect(info.fields.map((f) => f.key)).toEqual(['q']);
  });

  it('synthesizes at most 8 tools with unique names', () => {
    const doc = mount(`
      ${Array.from({ length: 12 }, (_, i) => `<form aria-label="Form ${i}"><input name="a"><button>Go</button></form>`).join('')}`);
    const tools = synthesizeFormTools(makeEnv(doc));
    expect(tools.length).toBeLessThanOrEqual(8);
    expect(tools[0]!.name).toBe('form_0');
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------- runtime + tool integration ----------

describe('runtime shim + write tools', () => {
  let doc: Document;
  let env: AgentEnv;
  let runtime: Runtime;

  const mountFull = (approve = true): void => {
    doc = mount(`
      <main>
        <form aria-label="Checkout form" method="post">
          <label for="name">Name on card</label><input id="name" name="name" required>
          <label for="email">Email</label><input id="email" name="email" type="email">
          <label for="card">Card number</label><input id="card" name="card_number" autocomplete="cc-number">
          <button type="submit">Place order</button>
        </form>
      </main>`);
    env = makeEnv(doc, { approve });
    runtime = new Runtime();
  };

  const registerWriteTools = async (): Promise<void> => {
    const { fillFormTool, setFieldTool, submitFormTool, activateTargetTool } = await import('../src/tools/interact.js');
    for (const t of [fillFormTool(env), setFieldTool(env), activateTargetTool(env), submitFormTool(env)]) {
      await runtime.register(t);
    }
  };

  beforeEach(() => {
    doc = mount('<main></main>');
    env = makeEnv(doc);
    runtime = new Runtime();
  });

  it('fill_form fills by label and refuses sensitive fields', async () => {
    mountFull();
    await registerWriteTools();
    const formNode = env.discover().nodes.find((n) => n.tag === 'input' && n.name === 'Name on card')!;
    const out = JSON.parse(
      (await runtime.executeTool(
        'fill_form',
        JSON.stringify({
          ref: formNode.ref,
          values: { 'Name on card': 'Will Tang', Email: 'a@b.c', 'Card number': '4242424242424242' },
        })
      )) as string
    ) as { filled: Array<{ field: string; status: string; value?: string }> };
    const refused = out.filled.find((f) => f.status === 'refused')!;
    expect(refused.field).toBe('Card number');
    expect(doc.querySelector<HTMLInputElement>('#name')!.value).toBe('Will Tang');
    expect(doc.querySelector<HTMLInputElement>('#email')!.value).toBe('a@b.c');
    expect(JSON.stringify(out)).not.toContain('4242424242424242');
  });

  it('set_field reports stale refs', async () => {
    mountFull();
    await registerWriteTools();
    const res = (await runtime.executeTool('set_field', JSON.stringify({ ref: 'el_missing', value: 'x' }))) as string;
    expect(res).toContain('stale');
  });

  it('submit_form requires human approval and respects decline', async () => {
    mountFull(false);
    await registerWriteTools();
    const node = env.discover().nodes.find((n) => n.tag === 'input')!;
    const res = (await runtime.executeTool(
      'submit_form',
      JSON.stringify({ ref: node.ref, summary: 'Place order' })
    )) as string;
    expect(res).toContain('declined');
  });

  it('submit_form submits after approval', async () => {
    mountFull(true);
    await registerWriteTools();
    const node = env.discover().nodes.find((n) => n.tag === 'input')!;
    const res = (await runtime.executeTool(
      'submit_form',
      JSON.stringify({ ref: node.ref, summary: 'Place order' })
    )) as string;
    expect(res).toContain('submitted after user approval');
  });

  it('synthesized search tool fills and auto-submits', async () => {
    const doc2 = mount(`
      <form aria-label="Product search" method="get" action="#results">
        <input name="q" type="search"><input name="max_price" type="number"><button>Search</button>
      </form>`);
    const env2 = makeEnv(doc2);
    const rt = new Runtime();
    for (const t of synthesizeFormTools(env2)) await rt.register(t);
    const names = ((await rt.getTools()) as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain('product_search');
    const out = JSON.parse((await rt.executeTool('product_search', JSON.stringify({ q: 'keyboard', max_price: 150 }))) as string);
    expect(out.status).toBe('submitted');
    expect(doc2.querySelector<HTMLInputElement>('input[name=q]')!.value).toBe('keyboard');
  });

  it('getTools returns public metadata only', async () => {
    mountFull();
    await registerWriteTools();
    const tools = (await runtime.getTools()) as Array<{ name: string; inputSchema?: { required?: string[] }; execute?: unknown }>;
    const t = tools.find((x) => x.name === 'set_field')!;
    expect(t.inputSchema!.required).toEqual(['ref', 'value']);
    expect(t.execute).toBeUndefined();
  });

  it('clamps oversized tool output', async () => {
    await runtime.register({
      name: 'noisy_tool',
      description: 'Returns a huge string',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'y'.repeat(MAX_OUTPUT_CHARS + 100),
    });
    const out = (await runtime.executeTool('noisy_tool', '{}')) as string;
    expect(out).toContain('truncated');
  });
});
// ---------- audit fixes (research findings E1–E7) ----------

describe('audit fixes E1–E7', () => {
  interface StubModelContext {
    registerTool: (tool: unknown, opts?: unknown) => void | Promise<void>;
    getTools?: () => Promise<unknown[]>;
    addEventListener?: (type: string, fn: () => void) => void;
  }

  const setGlobals = (doc: unknown, nav?: { modelContext?: StubModelContext }): void => {
    (globalThis as unknown as { document?: unknown }).document = doc;
    (globalThis as unknown as { navigator?: unknown }).navigator = nav ?? globalThis.navigator;
  };
  const clearGlobals = (win?: Window): void => {
    if (win) delete (win.navigator as unknown as { modelContext?: unknown }).modelContext;
    delete (globalThis as unknown as { document?: unknown }).document;
  };

  it('E1: falls back to navigator.modelContext when document has none', async () => {
    const win = new Window({ url: 'https://fb.example.com/' });
    const registered: unknown[] = [];
    const stub: StubModelContext = { registerTool: (t) => void registered.push(t) };
    (win.navigator as unknown as { modelContext?: StubModelContext }).modelContext = stub;
    setGlobals(win.document, win.navigator as unknown as { modelContext?: StubModelContext });
    try {
      const rt = new Runtime();
      expect(rt.hasNative).toBe(true);
      expect(rt.nativeTransport).toBe('navigator');
      await rt.register({ name: 'nav_tool', description: 'works', execute: () => 'ok' });
      expect(registered.length).toBe(1);
      expect((registered[0] as { name: string }).name).toBe('nav_tool');
    } finally {
      clearGlobals(win);
    }
  });

  it('E2: shim getTools() exposes RegisteredTool title and window keys', async () => {
    const rt = new Runtime();
    await rt.register({ name: 'titled', description: 'd', title: 'T', execute: () => 1 });
    const tools = (await rt.getTools()) as Array<Record<string, unknown>>;
    expect(tools[0]!.title).toBe('T');
    expect('window' in tools[0]!).toBe(true);
    expect('origin' in tools[0]!).toBe(true);
    // Missing title defaults to "" (spec issue #224 — do not hard-code undefined).
    await rt.register({ name: 'untitled', description: 'd', execute: () => 1 });
    const again = (await rt.getTools()) as Array<{ title: string; name: string }>;
    expect(again.find((t) => t.name === 'untitled')!.title).toBe('');
  });

  it('E3: unregisterAll clears the registry and fires the owner abort callback', async () => {
    let ownerAborts = 0;
    const rt = new Runtime({ onUnregisterAll: () => ownerAborts++ });
    await rt.register({ name: 'a', description: 'd', execute: () => 1 }, { signal: new AbortController().signal });
    await rt.register({ name: 'b', description: 'd', execute: () => 1 }, { signal: new AbortController().signal });
    rt.unregisterAll();
    expect(ownerAborts).toBe(1);
    expect((await rt.getTools()).length).toBe(0);
  });

  it('E3b: a rejected registration is skipped and unregisterAll remains healthy', async () => {
    let ownerAborts = 0;
    const rt = new Runtime({ onUnregisterAll: () => ownerAborts++ });
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      rt.register({ name: 'x', description: 'd', execute: () => 1 }, { signal: aborted.signal })
    ).rejects.toThrow(/already aborted/);
    const good = new AbortController();
    await rt.register({ name: 'x2', description: 'd', execute: () => 1 }, { signal: good.signal });
    rt.unregisterAll();
    expect(ownerAborts).toBe(1);
    expect((await rt.getTools()).length).toBe(0);
  });

  it('E4: synthesized tool names are capped at 30 chars (secure-tools budget)', () => {
    const doc = mount(`<form aria-label="${'a'.repeat(60)}"><input name="q"><button>Go</button></form>`);
    const tools = synthesizeFormTools(makeEnv(doc));
    expect(tools[0]!.name.length).toBeLessThanOrEqual(30);
  });

  it('E4b: parameter descriptions are capped at 150 chars', () => {
    const doc = mount(`
      <form aria-label="Long desc form" method="post">
        <label for="f1">Field</label><input id="f1" name="f1" aria-describedby="h1">
        <p id="h1">${'x'.repeat(300)}</p>
        <button>Save</button>
      </form>`);
    const tools = synthesizeFormTools(makeEnv(doc)) as unknown as Array<{
      inputSchema: { properties: Record<string, { description: string } | undefined> };
    }>;
    const desc = tools[0]!.inputSchema.properties.f1!.description;
    expect(desc.length).toBeLessThanOrEqual(150);
  });

  it('E5: executeTool accepts object args, rejects primitives, allows arrays (WPT parity)', async () => {
    const rt = new Runtime();
    await rt.register({ name: 'probe', description: 'd', execute: (args) => Array.isArray(args) ? 'array' : 'object' });
    await expect(rt.executeTool('probe', { a: 1 })).resolves.toBe('object');
    await expect(rt.executeTool('probe', '{"a":1}')).resolves.toBe('object');
    await expect(rt.executeTool('probe', '[1,2,3]')).resolves.toBe('array');
    await expect(rt.executeTool('probe', '"scalar"')).rejects.toThrow(/invalid JSON input/);
    await expect(rt.executeTool('probe', 'null')).rejects.toThrow(/invalid JSON input/);
  });

  it('E6: MCP-style { content } responses get the 1.5K text clamp', async () => {
    const rt = new Runtime();
    await rt.register({
      name: 'blocks',
      description: 'd',
      execute: () => ({ content: [{ type: 'text', text: 'y'.repeat(1600) }] }),
    });
    const out = (await rt.executeTool('blocks', {})) as { content: Array<{ type: string; text: string }> };
    expect(out.content[0]!.type).toBe('text');
    expect(out.content[0]!.text).toContain('truncated');
  });

  it('E7: native toolchange events forward into shim listeners; no double-fire on register', async () => {
    const listeners: Array<() => void> = [];
    const fakeNative: StubModelContext = {
      registerTool: () => undefined,
      addEventListener: (_type, fn) => listeners.push(fn),
    };
    const win = new Window({ url: 'https://native.example.com/' });
    (win.document as unknown as { modelContext?: StubModelContext }).modelContext = fakeNative;
    setGlobals(win.document);
    try {
      const rt = new Runtime();
      expect(rt.hasNative).toBe(true);
      expect(rt.nativeTransport).toBe('document');
      let fired = 0;
      rt.on('toolchange', () => fired++);
      await rt.register({ name: 'n1', description: 'd', execute: () => 1 });
      expect(fired).toBe(0); // native path relies on the real native event
      for (const fn of listeners) fn();
      expect(fired).toBe(1);
    } finally {
      delete (win.document as unknown as { modelContext?: unknown }).modelContext;
      clearGlobals(win);
    }
  });

  it('E7b: getTools() normalizes string inputSchema and missing title from native', async () => {
    const fakeNative: StubModelContext = {
      registerTool: () => undefined,
      getTools: async () => [
        { name: 'a', title: undefined, description: 'd', inputSchema: '{"type":"object"}', origin: 'https://x.test' },
      ],
    };
    const win = new Window({ url: 'https://native2.example.com/' });
    (win.document as unknown as { modelContext?: StubModelContext }).modelContext = fakeNative;
    setGlobals(win.document);
    try {
      const rt = new Runtime();
      const tools = (await rt.getTools()) as Array<{ name: string; title: string; inputSchema: unknown }>;
      expect(tools[0]!.title).toBe('');
      expect(typeof tools[0]!.inputSchema).toBe('object');
      expect((tools[0]!.inputSchema as { type: string }).type).toBe('object');
    } finally {
      delete (win.document as unknown as { modelContext?: unknown }).modelContext;
      clearGlobals(win);
    }
  });
});

// ---------- accuracy fixes (plan 002) ----------
describe('accuracy fixes (plan 002)', () => {
  it('allows benign names that collide with sensitive substrings', () => {
    const doc = mount('<form><input name="author"><input name="authorize"><input name="decide"><input name="email"></form>');
    const [author, authorize, decide, email] = doc.querySelectorAll('input');
    expect(classifyField(author!).level).toBe('allow');
    expect(classifyField(authorize!).level).toBe('allow');
    expect(classifyField(decide!).level).toBe('allow');
    expect(classifyField(email!).level).toBe('allow');
  });

  it('still refuses genuinely sensitive names', () => {
    const doc = mount('<form><input name="auth_token"><input name="oauth_state"><input name="authorization_code"><input name="cid"><input name="api_key"></form>');
    for (const el of doc.querySelectorAll('input')) {
      expect(classifyField(el).level).toBe('never');
    }
  });

  it('does not classify a GET form with a "faq" field as auto-submit search', () => {
    const doc = mount('<form method="get"><input name="faq"><button>Go</button></form>');
    expect(classifyForm(doc.querySelector('form')!).kind).not.toBe('search');
  });

  it('still classifies q-field search forms as search', () => {
    const doc = mount('<form method="get" action="/search"><input name="q"><button>Go</button></form>');
    const cls = classifyForm(doc.querySelector('form')!);
    expect(cls.kind).toBe('search');
    expect(cls.submitPolicy).toBe('auto-submit');
  });

  it('honors config.maxResults as the find_on_page cap', () => {
    const doc = mount(
      Array.from({ length: 12 }, (_, i) => `<button aria-label="special button ${i}">B${i}</button>`).join('')
    );
    const env = makeEnv(doc);
    env.config = { ...env.config, maxResults: 3 };
    const { nodes } = discover(doc);
    const hits = matchNodes('special button', nodes, { limit: Math.max(1, env.config.maxResults || 10) });
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it('matches single-character queries like "q"', () => {
    const doc = mount('<input name="q" aria-label="q">');
    const { nodes } = discover(doc);
    expect(matchNodes('q', nodes).length).toBeGreaterThan(0);
  });
});

// ---------- characterization: safety-critical paths (plan 003) ----------

describe('read tools (characterization)', () => {
  const mountShop = (): Document =>
    mount(`
    <main>
      <h1>Dashboard</h1>
      <form aria-label="Preferences">
        <label for="email">Email</label><input id="email" name="email" type="email">
        <input type="password" name="pw" aria-label="Password" value="hunter2">
        <label for="size">Size</label>
        <select id="size" name="size"><option value="s">Small</option><option value="l">Large</option></select>
      </form>
      <button aria-label="Delete account">Delete</button>
      <a href="/support">Contact support</a>
    </main>`);

  const registerReadTools = async (env: AgentEnv): Promise<Runtime> => {
    const runtime = new Runtime();
    for (const t of [pageContextTool(env), findTool(env), readTargetTool(env)]) {
      await runtime.register(t);
    }
    return runtime;
  };

  it('get_page_context returns structured context JSON with accurate counts', async () => {
    const doc = mountShop();
    const runtime = await registerReadTools(makeEnv(doc));
    const raw = (await runtime.executeTool('get_page_context', '{}')) as string;
    expect(raw.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    const ctx = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ['title', 'url', 'headings', 'regions', 'counts', 'forms', 'note']) {
      expect(key in ctx).toBe(true);
    }
    const counts = ctx.counts as { buttons: number; links: number; forms: number };
    expect(counts.forms).toBe(1);
    expect(counts.buttons).toBe(1);
    expect(counts.links).toBe(1);
  });

  it('find_on_page returns refs with actionRisk for destructive actions', async () => {
    const doc = mountShop();
    const runtime = await registerReadTools(makeEnv(doc));
    const out = JSON.parse((await runtime.executeTool('find_on_page', JSON.stringify({ query: 'Delete account' }))) as string) as {
      results: Array<{ ref: string; role: string; name: string; actionRisk: string }>;
    };
    expect(out.results.length).toBeGreaterThan(0);
    const hit = out.results[0]!;
    expect(hit.ref).toBeTruthy();
    expect(hit.role).toBe('button');
    expect(hit.name).toBe('Delete account');
    expect(hit.actionRisk).toBe('confirm');
  });

  it('find_on_page reports no match for unknown queries', async () => {
    const doc = mountShop();
    const runtime = await registerReadTools(makeEnv(doc));
    const out = (await runtime.executeTool('find_on_page', JSON.stringify({ query: 'nonexistent-xyz' }))) as string;
    expect(out).toContain('No match');
  });

  it('read_target returns select options as value/label pairs', async () => {
    const doc = mountShop();
    const runtime = await registerReadTools(makeEnv(doc));
    const out = JSON.parse(
      (await runtime.executeTool('read_target', JSON.stringify({ ref: refFor(doc.querySelector('select')!) }))) as string
    ) as { options: Array<{ value: string; label: string }> };
    expect(out.options).toEqual([
      { value: 's', label: 'Small' },
      { value: 'l', label: 'Large' },
    ]);
  });

  it('read_target never exposes sensitive field values', async () => {
    const doc = mountShop();
    const runtime = await registerReadTools(makeEnv(doc));
    const raw = (await runtime.executeTool('read_target', JSON.stringify({ ref: refFor(doc.querySelector('input[type=password]')!) }))) as string;
    expect(raw).not.toContain('hunter2');
    const out = JSON.parse(raw) as Record<string, unknown>;
    expect(String(out.note)).toContain('Sensitive field');
    expect('currentValue' in out).toBe(false);
    expect('value' in out).toBe(false);
  });

  it('read_target returns the sensitive note for data-agent-hide fields', async () => {
    const doc = mount(`
      <main><form aria-label="Notes">
        <label for="internal">Internal note</label><input id="internal" name="internal" data-agent-hide value="inner-secret">
      </form></main>`);
    const runtime = await registerReadTools(makeEnv(doc));
    const raw = (await runtime.executeTool('read_target', JSON.stringify({ ref: refFor(doc.querySelector('#internal')!) }))) as string;
    expect(raw).not.toContain('inner-secret');
    const out = JSON.parse(raw) as Record<string, unknown>;
    expect(String(out.note)).toContain('Sensitive field');
    expect('currentValue' in out).toBe(false);
    expect('value' in out).toBe(false);
  });
});

describe('activate_target gate (characterization)', () => {
  const registerActivate = async (env: AgentEnv): Promise<Runtime> => {
    const runtime = new Runtime();
    await runtime.register(activateTargetTool(env));
    return runtime;
  };

  it('allow-level targets activate without escalation', async () => {
    const doc = mount('<main><a href="#x" id="support-link">Support link</a></main>');
    const link = doc.querySelector('#support-link')!;
    let clicks = 0;
    link.addEventListener('click', () => clicks++);
    const runtime = await registerActivate(makeEnv(doc));
    const out = (await runtime.executeTool('activate_target', JSON.stringify({ ref: refFor(link) }))) as string;
    expect(out).toContain('Activated "Support link"');
    expect(clicks).toBe(1);
  });

  it('confirm-level targets are declined without side effects', async () => {
    const doc = mount('<main><button aria-label="Delete account" id="del">Delete</button></main>');
    const btn = doc.querySelector('#del')!;
    let clicks = 0;
    btn.addEventListener('click', () => clicks++);
    const runtime = await registerActivate(makeEnv(doc, { approve: false }));
    const out = (await runtime.executeTool('activate_target', JSON.stringify({ ref: refFor(btn) }))) as string;
    expect(out).toContain('declined');
    expect(clicks).toBe(0);
  });

  it('confirm-level targets activate after approval', async () => {
    const doc = mount('<main><button aria-label="Delete account" id="del">Delete</button></main>');
    const btn = doc.querySelector('#del')!;
    let clicks = 0;
    btn.addEventListener('click', () => clicks++);
    const runtime = await registerActivate(makeEnv(doc, { approve: true }));
    const out = (await runtime.executeTool('activate_target', JSON.stringify({ ref: refFor(btn) }))) as string;
    expect(out).toContain('Activated');
    expect(clicks).toBe(1);
  });

  it('reports stale refs', async () => {
    const doc = mount('<main><button id="b">Go</button></main>');
    const runtime = await registerActivate(makeEnv(doc));
    const out = (await runtime.executeTool('activate_target', JSON.stringify({ ref: 'el_missing' }))) as string;
    expect(out).toContain('stale');
  });

  it('classifyAction escalates form submits, allows plain links', () => {
    const doc = mount('<main><form><button type="submit">Place order</button></form><a href="/x">Support</a></main>');
    expect(classifyAction(doc.querySelector('button')!).level).toBe('confirm');
    expect(classifyAction(doc.querySelector('a')!).level).toBe('allow');
  });
});

describe('inspector confirmGate (characterization)', () => {
  const withInspector = async (
    html: string,
    run: (ctx: { el: HTMLElement; inspector: Inspector; shadow: ShadowRoot; confirmBox: HTMLElement }) => Promise<void> | void
  ): Promise<void> => {
    const doc = mount(html);
    (globalThis as unknown as { document?: Document }).document = doc;
    const inspector = new Inspector({ siteLabel: 'test' });
    const shadow = (inspector as unknown as { shadow: ShadowRoot }).shadow;
    try {
      await run({
        el: doc.querySelector<HTMLElement>('#gate-target')!,
        inspector,
        shadow,
        confirmBox: shadow.querySelector<HTMLElement>('.confirm')!,
      });
    } finally {
      inspector.destroy();
      delete (globalThis as unknown as { document?: Document }).document;
    }
  };

  it('allow-level requests resolve true without showing the dialog', async () => {
    await withInspector('<main><button id="gate-target">Go</button></main>', async ({ el, inspector, confirmBox }) => {
      await expect(inspector.confirmGate({ title: 'T', detail: 'D', level: 'allow', el })).resolves.toBe(true);
      expect(confirmBox.style.display).not.toBe('block');
    });
  });

  it('default-level gate shows the dialog and resolves true on approve', async () => {
    await withInspector('<main><button id="gate-target">Go</button></main>', async ({ el, inspector, shadow, confirmBox }) => {
      const p = inspector.confirmGate({ title: 'Approve me?', detail: 'Please review.', el });
      expect(confirmBox.style.display).toBe('block');
      expect(confirmBox.querySelector('h4')!.textContent).toBe('Approve me?');
      shadow.querySelector<HTMLButtonElement>('.primary')!.click();
      await expect(p).resolves.toBe(true);
      expect(confirmBox.style.display).toBe('none');
    });
  });

  it('fresh gate invocation resolves false on decline and hides the box', async () => {
    await withInspector('<main><button id="gate-target">Go</button></main>', async ({ el, inspector, shadow, confirmBox }) => {
      const p = inspector.confirmGate({ title: 'T', detail: 'D', el });
      expect(confirmBox.style.display).toBe('block');
      shadow.querySelector<HTMLButtonElement>('.cancel')!.click();
      await expect(p).resolves.toBe(false);
      expect(confirmBox.style.display).toBe('none');
    });
  });

  it('gate times out to false without any click', async () => {
    await withInspector('<main><button id="gate-target">Go</button></main>', async ({ el, inspector, shadow, confirmBox }) => {
      const p = inspector.confirmGate({ title: 'T', detail: 'D', level: 'confirm', el, timeoutMs: 10 });
      expect(confirmBox.style.display).toBe('block');
      await new Promise((r) => setTimeout(r, 50));
      await expect(p).resolves.toBe(false);
      expect(confirmBox.style.display).toBe('none');
      expect(shadow.querySelector<HTMLElement>('.dot')!.classList.contains('busy')).toBe(false);
    });
  });

  it('cleans up listeners: a second gate still works after the first resolves', async () => {
    await withInspector('<main><button id="gate-target">Go</button></main>', async ({ el, inspector, shadow, confirmBox }) => {
      const cancel = shadow.querySelector<HTMLButtonElement>('.cancel')!;
      const first = inspector.confirmGate({ title: 'First', detail: 'D', level: 'confirm', el });
      cancel.click();
      await expect(first).resolves.toBe(false);
      expect(confirmBox.style.display).toBe('none');
      cancel.click(); // stray click on the resolved gate must be a no-op
      const second = inspector.confirmGate({ title: 'Second', detail: 'D', level: 'confirm', el });
      expect(confirmBox.style.display).toBe('block');
      cancel.click();
      await expect(second).resolves.toBe(false);
      expect(confirmBox.style.display).toBe('none');
    });
  });

  it('serializes concurrent gates: one approve click resolves exactly one request', async () => {
    await withInspector('<main><button id="gate-target">Go</button></main>', async ({ el, inspector, shadow, confirmBox }) => {
      const primary = shadow.querySelector<HTMLButtonElement>('.primary')!;
      const first = inspector.confirmGate({ title: 'First request', detail: 'D', level: 'confirm', el });
      const second = inspector.confirmGate({ title: 'Second request', detail: 'D', level: 'confirm', el });
      expect(confirmBox.querySelector('h4')!.textContent).toBe('First request');
      primary.click();
      await expect(first).resolves.toBe(true);
      let secondSettled = false;
      void second.then(() => {
        secondSettled = true;
      });
      await new Promise((r) => setTimeout(r, 20)); // the queued gate starts once the first settles
      expect(secondSettled).toBe(false);
      expect(confirmBox.style.display).toBe('block');
      expect(confirmBox.querySelector('h4')!.textContent).toBe('Second request');
      primary.click();
      await expect(second).resolves.toBe(true);
      expect(confirmBox.style.display).toBe('none');
    });
  });

  it('declining the first concurrent gate leaves the second pending until its own click', async () => {
    await withInspector('<main><button id="gate-target">Go</button></main>', async ({ el, inspector, shadow, confirmBox }) => {
      const primary = shadow.querySelector<HTMLButtonElement>('.primary')!;
      const cancel = shadow.querySelector<HTMLButtonElement>('.cancel')!;
      const first = inspector.confirmGate({ title: 'First request', detail: 'D', level: 'confirm', el });
      const second = inspector.confirmGate({ title: 'Second request', detail: 'D', level: 'confirm', el });
      cancel.click();
      await expect(first).resolves.toBe(false);
      let secondSettled = false;
      void second.then(() => {
        secondSettled = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(secondSettled).toBe(false);
      expect(confirmBox.style.display).toBe('block');
      expect(confirmBox.querySelector('h4')!.textContent).toBe('Second request');
      primary.click();
      await expect(second).resolves.toBe(true);
      expect(confirmBox.style.display).toBe('none');
    });
  });
});

// ---------- safety model enforcement (plan 004) ----------

describe('safety model (plan 004)', () => {
  it('discovery excludes sensitive and data-agent-hide fields from the public snapshot', () => {
    const doc = mount(`
      <main>
        <form aria-label="Profile">
          <label for="pw">Password</label><input id="pw" name="pw" type="password" value="hunter2">
          <label for="internal">Internal</label><input id="internal" name="internal" data-agent-hide value="inner-secret">
          <label for="nm">Name</label><input id="nm" name="nm">
        </form>
      </main>`);
    const { nodes } = discover(doc);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.name).toBe('Name');
    const serialized = JSON.stringify(nodes);
    expect(serialized).not.toContain('inner-secret');
    expect(serialized).not.toContain('internal');
  });

  it('set_field refuses data-agent-hide fields', async () => {
    const doc = mount(`
      <main><form aria-label="Profile">
        <label for="internal">Internal</label><input id="internal" name="internal" data-agent-hide>
      </form></main>`);
    const runtime = new Runtime();
    await runtime.register(setFieldTool(makeEnv(doc)));
    const res = (await runtime.executeTool(
      'set_field',
      JSON.stringify({ ref: refFor(doc.querySelector('#internal')!), value: 'x' })
    )) as string;
    expect(res).toContain('Refused:');
    expect(res).toContain('data-agent-hide');
    expect(doc.querySelector<HTMLInputElement>('#internal')!.value).toBe('');
  });

  it('fill_form reports hide-field keys as notFound and never sets them', async () => {
    const doc = mount(`
      <main><form aria-label="Profile">
        <label for="nm">Name</label><input id="nm" name="nm">
        <label for="internal">Internal</label><input id="internal" name="internal" data-agent-hide>
      </form></main>`);
    const runtime = new Runtime();
    await runtime.register(fillFormTool(makeEnv(doc)));
    const out = JSON.parse(
      (await runtime.executeTool(
        'fill_form',
        JSON.stringify({ ref: refFor(doc.querySelector('#nm')!), values: { Name: 'Will', Internal: 'sneaky' } })
      )) as string
    ) as { filled: Array<{ field: string; status: string }>; notFound?: string[] };
    expect(out.filled.find((f) => f.field === 'Name')!.status).toBe('set');
    expect(out.notFound).toContain('Internal');
    expect(doc.querySelector<HTMLInputElement>('#internal')!.value).toBe('');
  });

  it('classifyAction refuses script-URI links, allows ordinary ones', () => {
    const doc = mount(`
      <main>
        <a href="javascript:alert(1)" id="js">Tricky</a>
        <a href="data:text/html,hi" id="data">Data</a>
        <a href=" vbscript:msgbox(1)" id="vbs">VBS</a>
        <a href="/x" id="plain">Next</a>
        <a href="mailto:s@a.com" id="mail">Mail</a>
        <a href="#frag" id="frag">Jump</a>
      </main>`);
    expect(classifyAction(doc.querySelector('#js')!).level).toBe('never');
    expect(classifyAction(doc.querySelector('#js')!).reason).toContain('script URI');
    expect(classifyAction(doc.querySelector('#data')!).level).toBe('never');
    expect(classifyAction(doc.querySelector('#vbs')!).level).toBe('never');
    expect(classifyAction(doc.querySelector('#plain')!).level).toBe('allow');
    expect(classifyAction(doc.querySelector('#mail')!).level).toBe('allow');
    expect(classifyAction(doc.querySelector('#frag')!).level).toBe('allow');
  });

  it('activate_target refuses script-URI links without clicking', async () => {
    const doc = mount('<main><a id="trap" href="javascript:alert(1)">Tricky</a></main>');
    const link = doc.querySelector('#trap')!;
    let clicks = 0;
    link.addEventListener('click', () => clicks++);
    const runtime = new Runtime();
    await runtime.register(activateTargetTool(makeEnv(doc)));
    const out = (await runtime.executeTool('activate_target', JSON.stringify({ ref: refFor(link) }))) as string;
    expect(out).toContain('Refused');
    expect(out).toContain('script URI');
    expect(clicks).toBe(0);
  });
});

describe('config plumbing', () => {
  it('caps find_on_page results at config.maxResults end-to-end', async () => {
    const doc = mount(Array.from({ length: 5 }, (_, i) => `<button aria-label="widget button ${i}">W${i}</button>`).join(''));
    const env = makeEnv(doc);
    env.config.maxResults = 2;
    const runtime = new Runtime();
    await runtime.register(findTool(env));
    const out = JSON.parse((await runtime.executeTool('find_on_page', JSON.stringify({ query: 'widget button' }))) as string) as {
      results: unknown[];
    };
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.length).toBeLessThanOrEqual(2);
  });

  it('inspector renders the configured site label', () => {
    const doc = mount('<main></main>');
    (globalThis as unknown as { document?: Document }).document = doc;
    try {
      const inspector = new Inspector({ siteLabel: 'My Site' });
      const shadow = (inspector as unknown as { shadow: ShadowRoot }).shadow;
      expect(shadow.querySelector<HTMLElement>('.label')!.textContent).toBe('My Site');
      inspector.destroy();
    } finally {
      delete (globalThis as unknown as { document?: Document }).document;
    }
  });
});
