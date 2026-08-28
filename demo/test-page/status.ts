/**
 * AgentReady test page — status dashboard + fixture wiring.
 * Compiled to status.js by `tsc -p tsconfig.build.json`.
 */

interface ToolSummary {
  name: string;
  description: string;
  annotations?: { readOnlyHint?: boolean };
}

interface AgentReadyLike {
  version: string;
  hasNativeWebMCP: boolean;
  getTools(): Promise<ToolSummary[]>;
  executeTool(name: string, argsJson: string): Promise<unknown>;
}

function $(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

function wire(): void {
  // 1. Search form renders results client-side (synthesized tool auto-submits this).
  document.querySelector<HTMLFormElement>('#search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.querySelector<HTMLInputElement>('input[name=q]')!.value.trim();
    const cat = document.querySelector<HTMLSelectElement>('select[name=category]')!.value;
    const max = document.querySelector<HTMLInputElement>('input[name=max_price]')!.value;
    $('#results').innerHTML = q
      ? `<span class="ok">Search executed:</span> keyword=<b>${escapeHtml(q)}</b>, category=<b>${escapeHtml(cat)}</b>, max=<b>${escapeHtml(max || 'any')}</b>`
      : 'Empty query.';
    log(`search submitted: q=${q} category=${cat}`);
  });

  // 2. Signup form echoes submitted fields — used to prove sensitive fields never reach it.
  document.querySelector<HTMLFormElement>('#signup-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = document.querySelector<HTMLFormElement>('#signup-form')!;
    const parts: string[] = [];
    new FormData(form).forEach((v, k) => parts.push(`${k}=${escapeHtml(String(v))}`));
    $('#signup-log').innerHTML = `<span class="ok">Submitted:</span> ${parts.join(', ') || '(empty)'}`;
    log(`signup submitted: ${parts.join(', ')}`);
  });

  // 3. Every change event increments the counter (set_field / fill_form must fire these).
  let changes = 0;
  document.querySelector<HTMLFormElement>('#prefs-form')?.addEventListener('change', () => {
    changes++;
    $('#event-count').textContent = String(changes);
  });
  document.querySelector<HTMLFormElement>('#prefs-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    log('preferences saved');
  });

  // 3b. Activation targets.
  document.querySelector('#danger-btn')?.addEventListener('click', () => {
    $('#activation-log').innerHTML = '<span class="bad">Account deleted.</span>';
    log('danger button clicked');
  });
  document.querySelector<HTMLAnchorElement>('#safe-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('#activation-log').innerHTML = '<span class="ok">Help center link clicked.</span>';
    log('safe link clicked');
  });

  // 4. Dynamic form injection → MutationObserver must synthesize a new tool.
  document.querySelector<HTMLButtonElement>('#inject-form')?.addEventListener('click', () => {
    const form = document.createElement('form');
    form.setAttribute('aria-label', 'Newsletter subscription');
    form.innerHTML = `
      <label for="nl_email">Newsletter email</label>
      <input id="nl_email" name="email" type="email" />
      <button type="button" data-nl>Subscribe</button>`;
    form.querySelector('button[data-nl]')?.addEventListener('click', () => {
      log(`newsletter subscribed: ${form.querySelector<HTMLInputElement>('input')?.value ?? ''}`);
    });
    $('#inject-target').appendChild(form);
    log('newsletter form injected');
  });
}

async function refresh(): Promise<void> {
  const ar = (window as unknown as { AgentReady?: AgentReadyLike }).AgentReady;
  if (!ar) return;
  const tools = await ar.getTools();
  $('#st-version').textContent = ar.version;
  $('#st-native').textContent = ar.hasNativeWebMCP ? 'native document.modelContext' : 'in-page shim';
  $('#st-count').textContent = String(tools.length);
  $('#st-tools').innerHTML = tools
    .map((t) => `<code>${t.name}</code>${t.annotations?.readOnlyHint === true ? ' 📖' : ' ✍️'}`)
    .join(' ');
}

function log(msg: string): void {
  const el = $('#log');
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n${el.textContent ?? ''}`.slice(0, 4000);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

wire();

window.addEventListener('load', () => {
  void refresh();
  setInterval(() => void refresh(), 800);
});

// Console/E2E helper for reading the scenario log.
Object.assign(window, { arLog: log });

export {};