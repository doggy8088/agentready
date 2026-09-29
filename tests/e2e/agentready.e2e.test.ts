/**
 * AgentReady E2E suite — drives the real bundle in a real browser.
 * Covers everything unit tests cannot: boot, inspector UI, confirm gates,
 * synthesized tools end-to-end, SPA re-synthesis and the demo store flow.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { agent, launchBrowser, STORE_PAGE, startServer, TEST_PAGE } from './helpers.js';

let server: { baseUrl: string; stop(): void };
let browser: Browser;
let context: BrowserContext;
let page: Page;
const consoleErrors: string[] = [];
let lastDialog = '';

beforeAll(async () => {
  server = startServer();
  browser = await launchBrowser();
  context = await browser.newContext();
  page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('dialog', (d) => {
    lastDialog = d.message();
    void d.accept();
  });
  await page.goto(server.baseUrl + TEST_PAGE);
  await waitForAgentReady();
}, 60000);

afterAll(() => {
  void browser?.close();
  server?.stop();
}, 30000);

function waitForAgentReady(timeout = 10000): Promise<unknown> {
  return page.waitForFunction(
    () => (window as unknown as { AgentReady?: unknown }).AgentReady !== undefined,
    undefined,
    { timeout },
  );
}

function waitForText(selector: string, text: string, timeout = 5000): Promise<unknown> {
  return page.waitForFunction(
    ([sel, expected]) => document.querySelector(sel)?.textContent?.includes(expected) ?? false,
    [selector, text] as [string, string],
    { timeout },
  );
}

async function findRef(query: string, kind?: 'action' | 'field'): Promise<string> {
  const raw = (await agent.executeTool(page, 'find_on_page', { query, kind })) as string;
  const parsed = JSON.parse(raw) as { results: Array<{ ref: string; name: string }> };
  if (!parsed.results?.length) throw new Error(`find_on_page found nothing for "${query}"`);
  return parsed.results[0]!.ref;
}

/** Run an action that pops the confirm dialog, then click Approve. */
async function approve(action: Promise<unknown>): Promise<string> {
  await page.locator('div[data-agentready-ui] .confirm').waitFor({ state: 'visible' });
  await page.locator('div[data-agentready-ui] .confirm .primary').click();
  return String(await action);
}

async function decline(action: Promise<unknown>): Promise<string> {
  await page.locator('div[data-agentready-ui] .confirm').waitFor({ state: 'visible' });
  await page.locator('div[data-agentready-ui] .confirm .cancel').click();
  return String(await action);
}

describe('boot + registration', () => {
  it('exposes window.AgentReady with core + synthesized tools and shows the badge', async () => {
    expect(await agent.version(page)).toMatch(/^\d+\.\d+\.\d+$/);
    const names = await agent.getToolNames(page);
    for (const t of [
      'get_page_context',
      'find_on_page',
      'read_target',
      'activate_target',
      'set_field',
      'fill_form',
      'submit_form',
      'search_products',
      'signup_form',
      'preferences_form',
    ]) {
      expect(names).toContain(t);
    }
    await page
      .locator('div[data-agentready-ui] .badge-count')
      .filter({ hasText: '10 tool' })
      .waitFor({ timeout: 5000 });
  }, 30000);

  it('get_page_context returns compact JSON within the output budget', async () => {
    const out = (await agent.executeTool(page, 'get_page_context', {})) as string;
    expect(out.length).toBeLessThanOrEqual(1500);
    const data = JSON.parse(out) as { title: string; counts: { forms: number } };
    expect(data.title).toBe('AgentReady Test Page');
    expect(data.counts.forms).toBeGreaterThanOrEqual(3);
  }, 30000);
});

describe('find + read', () => {
  it('find_on_page locates the destructive button with action risk', async () => {
    const raw = (await agent.executeTool(page, 'find_on_page', { query: 'delete account' })) as string;
    const parsed = JSON.parse(raw) as { results: Array<{ ref: string; name: string; actionRisk?: string }> };
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0]!.name.toLowerCase()).toContain('delete');
    expect(parsed.results[0]!.actionRisk).toBe('confirm');
  }, 30000);

  it('read_target lists select options', async () => {
    const ref = await findRef('theme select', 'field');
    const detail = JSON.parse((await agent.executeTool(page, 'read_target', { ref })) as string) as {
      options?: Array<{ label: string }>;
    };
    const labels = (detail.options ?? []).map((o) => o.label);
    for (const label of ['Light', 'Dark', 'System']) expect(labels).toContain(label);
  }, 30000);

  it('reports stale refs instead of throwing', async () => {
    const res = (await agent.executeTool(page, 'read_target', { ref: 'el_stale_xyz' })) as string;
    expect(res).toContain('stale');
  }, 30000);
});

describe('write tools + human-in-the-loop', () => {
  it('set_field updates select/checkbox and fires change events', async () => {
    const themeRef = await findRef('theme select', 'field');
    expect(String(await agent.executeTool(page, 'set_field', { ref: themeRef, value: 'Dark' }))).toContain('Set');
    const boxRef = await findRef('email notifications', 'field');
    await agent.executeTool(page, 'set_field', { ref: boxRef, value: 'true' });
    const checked = await page.evaluate(
      () => (document.querySelector('#prefs-form input[type=checkbox]') as HTMLInputElement | null)?.checked ?? false,
    );
    expect(checked).toBe(true);
    const count = Number((await page.locator('#event-count').textContent()) ?? '0');
    expect(count).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('fill_form fills allowed fields and refuses sensitive ones', async () => {
    const ref = await findRef('full name', 'field');
    const out = JSON.parse(
      (await agent.executeTool(page, 'fill_form', {
        ref,
        values: {
          'Full name': 'E2E Tester',
          Email: 'e2e@test.dev',
          Password: 'super-secret',
          'Card number': '4242424242424242',
        },
      })) as string,
    ) as { filled: Array<{ field: string; status: string }> };
    const statuses = Object.fromEntries(out.filled.map((f) => [f.field, f.status]));
    expect(statuses['Full name']).toBe('set');
    expect(statuses.Email).toBe('set');
    expect(statuses.Password).toBe('refused');
    expect(statuses['Card number']).toBe('refused');
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('4242424242424242');
  }, 30000);

  it('submit_form shows the human confirmation and approves', async () => {
    const ref = await findRef('full name', 'field');
    await agent.executeTool(page, 'fill_form', { ref, values: { 'Full name': 'E2E Tester', Email: 'e2e@test.dev' } });
    const pending = agent.executeTool(page, 'submit_form', { ref, summary: 'Create account for E2E Tester' });
    await page.locator('div[data-agentready-ui] .confirm').waitFor({ state: 'visible' });
    await page.locator('div[data-agentready-ui] .confirm .primary').click();
    expect(String(await pending)).toContain('submitted after user approval');
    const log = (await page.locator('#signup-log').textContent()) ?? '';
    expect(log).toContain('name=E2E');
    expect(log).toContain('email=e2e@test.dev');
    // The attempted sensitive values never reach the submitted form.
    expect(log).not.toContain('super-secret');
    expect(log).not.toContain('4242424242424242');
  }, 30000);

  it('activate_target requires human approval for destructive buttons', async () => {
    const ref = await findRef('delete account', 'action');
    const declined = decline(agent.executeTool(page, 'activate_target', { ref }));
    expect(await declined).toContain('declined');
    expect((await page.locator('#activation-log').textContent()) ?? '').not.toContain('deleted');

    const pending = agent.executeTool(page, 'activate_target', { ref });
    await page.locator('div[data-agentready-ui] .confirm').waitFor({ state: 'visible' });
    await page.locator('div[data-agentready-ui] .confirm .primary').click();
    expect(String(await pending)).toContain('Activated');
    expect((await page.locator('#activation-log').textContent()) ?? '').toContain('Account deleted');
  }, 30000);
});

describe('synthesized tools + SPA updates', () => {
  it('search_products fills and auto-submits the search form', async () => {
    const out = JSON.parse(
      (await agent.executeTool(page, 'search_products', {
        q: 'mech',
        category: 'Keyboards',
        max_price: 500,
      })) as string,
    ) as { status: string };
    expect(out.status).toBe('submitted');
    await waitForText('#results', 'Search executed');
  }, 30000);

  it('picks up dynamically injected forms via MutationObserver', async () => {
    await page.click('#inject-form');
    await page.waitForFunction(
      () => {
        const ar = (window as unknown as { AgentReady?: { getTools(): Promise<Array<{ name: string }>> } }).AgentReady;
        return ar ? ar.getTools().then((ts) => ts.some((t) => t.name === 'newsletter_subscription')) : false;
      },
      undefined,
      { timeout: 5000 },
    );
  }, 30000);

  it('keeps output within budget on every core tool', async () => {
    for (const [tool, args] of [
      ['get_page_context', {}],
      ['find_on_page', { query: 'form' }],
      ['find_on_page', { query: 'email', kind: 'field' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const out = String(await agent.executeTool(page, tool, args));
      expect(out.length).toBeLessThanOrEqual(1500);
    }
  }, 30000);

  it('find_on_page never surfaces data-agent-hide fields', async () => {
    // Positive control: a visible labelled field is findable.
    const control = (await agent.executeTool(page, 'find_on_page', {
      query: 'email notifications',
      kind: 'field',
    })) as string;
    expect(control).not.toContain('No match');
    // The data-agent-hide field (aria-labelled, non-sensitive name) must be invisible to agents.
    const out = (await agent.executeTool(page, 'find_on_page', { query: 'internal note' })) as string;
    expect(out).toContain('No match');
  }, 30000);

  it('survives a rapid mutation storm without duplicate or leaked batches', async () => {
    // 5 rapid injections (1 form was already injected by the test above):
    // 6 newsletter forms + 3 page forms = 9, but MAX_SYNTHESIZED caps each
    // batch at 8 form tools, so the 6th newsletter form gets none.
    // Expected settled state: 7 core + 8 form tools = 15 unique names.
    for (let i = 0; i < 5; i++) await page.click('#inject-form');
    await page.waitForFunction(
      () => {
        const ar = (window as unknown as { AgentReady?: { getTools(): Promise<Array<{ name: string }>> } }).AgentReady;
        if (!ar) return false;
        return ar.getTools().then((ts) => {
          const names = ts.map((t) => t.name);
          return (
            names.includes('newsletter_subscription') && new Set(names).size === names.length && names.length === 15
          );
        });
      },
      undefined,
      { timeout: 10000 },
    );
  }, 30000);
});

describe('demo store flow', () => {
  it('search → add to cart → checkout with human approval', async () => {
    lastDialog = '';
    await page.goto(`${server.baseUrl}${STORE_PAGE}`);
    await waitForAgentReady();

    // 1. Synthesized product_search drives the storefront.
    const searchOut = JSON.parse(
      (await agent.executeTool(page, 'product_search', { q: 'keyboard', max_price: 150 })) as string,
    ) as { status: string };
    expect(searchOut.status).toBe('submitted');

    // 2. Add the top keyboard to the cart (allow-level: no dialog).
    const addRef = await findRef('Add MechKeyboard Pro to cart', 'action');
    await agent.executeTool(page, 'activate_target', { ref: addRef });
    await page.waitForFunction(() => document.querySelector('#cart-count')?.textContent?.trim() === '1', undefined, {
      timeout: 5000,
    });

    // 3. Open the cart, then go to checkout (confirm-level: dialog).
    await agent.executeTool(page, 'activate_target', { ref: await findRef('open cart', 'action') });
    const checkout = approve(
      agent.executeTool(page, 'activate_target', { ref: await findRef('go to checkout', 'action') }),
    );
    expect(await checkout).toContain('Activated');
    await page.waitForFunction(
      () => (document.querySelector('#view-checkout') as HTMLElement | null)?.hidden === false,
      undefined,
      { timeout: 5000 },
    );

    // 4. Fill the checkout form; sensitive fields are refused.
    const fieldRef = await findRef('name on card', 'field');
    const fillOut = JSON.parse(
      (await agent.executeTool(page, 'fill_form', {
        ref: fieldRef,
        values: {
          'Name on card': 'E2E Tester',
          'Email for receipt': 'e2e@test.dev',
          'Shipping address': '1 Test Way',
          'Card number': '4242424242424242',
        },
      })) as string,
    ) as { filled: Array<{ field: string; status: string }>; stillRequired?: string[] };
    expect(fillOut.filled.find((f) => f.status === 'refused')?.field).toBe('Card number');
    expect(fillOut.stillRequired ?? []).toEqual([]);

    // 5. Submit requires human approval.
    lastDialog = '';
    const pending = agent.executeTool(page, 'submit_form', { ref: fieldRef, summary: 'Place order for E2E Tester' });
    await page.locator('div[data-agentready-ui] .confirm').waitFor({ state: 'visible' });
    await page.locator('div[data-agentready-ui] .confirm .primary').click();
    expect(String(await pending)).toContain('submitted after user approval');
    expect(lastDialog).toContain('Order ORD-');
    expect(lastDialog).toContain('E2E Tester');
    await waitForText('#order-list', 'ORD-');
  }, 45000);

  it('leaves no console errors across both pages', () => {
    expect(consoleErrors).toEqual([]);
  }, 30000);
});

// ---------- shadow discovery spike (plan 010 — flag ON via boot config) ----------

describe('shadow discovery spike (flag on)', () => {
  let ctx: BrowserContext;
  let spikePage: Page;
  const spikeErrors: string[] = [];

  beforeAll(async () => {
    ctx = await browser.newContext();
    // Runs before every page script in this context — AgentReadyConfig is read at boot.
    ctx.addInitScript(() => {
      (window as unknown as { AgentReadyConfig?: { shadowDiscovery: boolean } }).AgentReadyConfig = {
        shadowDiscovery: true,
      };
    });
    spikePage = await ctx.newPage();
    spikePage.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) spikeErrors.push(msg.text());
    });
    spikePage.on('pageerror', (err) => spikeErrors.push(String(err)));
    await spikePage.goto(server.baseUrl + TEST_PAGE);
    await spikePage.waitForFunction(
      () => (window as unknown as { AgentReady?: unknown }).AgentReady !== undefined,
      undefined,
      { timeout: 10000 },
    );
  }, 30000);

  afterAll(() => {
    void ctx?.close();
  }, 30000);

  it('synthesizes a tool from the form inside the shadow root (Q5)', async () => {
    const names = await agent.getToolNames(spikePage);
    expect(names).toContain('shadow_newsletter');
  }, 30000);

  it('find_on_page returns the shadow button and activate_target clicks it (Q2 end-to-end)', async () => {
    const raw = (await agent.executeTool(spikePage, 'find_on_page', {
      query: 'shadow hello',
      kind: 'action',
    })) as string;
    const parsed = JSON.parse(raw) as { results: Array<{ ref: string; name: string }> };
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0]!.name).toBe('Shadow hello');
    const out = String(await agent.executeTool(spikePage, 'activate_target', { ref: parsed.results[0]!.ref }));
    expect(out).toContain('Activated "Shadow hello"');
    const log = (await spikePage.locator('#shadow-log').textContent()) ?? '';
    expect(log).toContain('Shadow button activated');
  }, 30000);

  it('fills the shadow form field through the synthesized tool (Q5 end-to-end)', async () => {
    const out = JSON.parse(
      (await agent.executeTool(spikePage, 'shadow_newsletter', { email: 'shadow@e2e.dev' })) as string,
    ) as { status: string; filled: Array<{ field: string; value: string; ok: boolean }> };
    expect(out.status).toBe('filled');
    expect(out.filled[0]!.ok).toBe(true);
    const value = await spikePage.evaluate(
      () =>
        (document.querySelector('shadow-spike-widget')?.shadowRoot?.querySelector('#sem') as HTMLInputElement | null)
          ?.value ?? '',
    );
    expect(value).toBe('shadow@e2e.dev');
  }, 30000);

  it('leaves no console errors on the flag-on page', () => {
    expect(spikeErrors).toEqual([]);
  }, 30000);
});

// The test page loads the published CDN build; the store loads the local bundle,
// so content-search coverage of *this* change lives here.
describe('find_on_page content search (local bundle, store page)', () => {
  let store: Page;

  beforeAll(async () => {
    store = await context.newPage();
    await store.goto(server.baseUrl + STORE_PAGE);
    await store.waitForFunction(
      () => (window as unknown as { AgentReady?: unknown }).AgentReady !== undefined,
      undefined,
      {
        timeout: 10000,
      },
    );
  }, 30000);

  afterAll(async () => {
    await store?.close();
  });

  type Found = { results: Array<{ ref: string; role: string; name?: string; text?: string; section?: string }> };
  const find = async (query: string, kind?: string): Promise<Found> =>
    JSON.parse((await agent.executeTool(store, 'find_on_page', { query, kind })) as string) as Found;

  it('finds plain page text that is not an interactive element', async () => {
    const out = await find('deliberately ordinary storefront');
    expect(out.results[0]!.role).toBe('text');
    expect(out.results[0]!.text).toContain('ordinary storefront');
  }, 30000);

  it('finds CJK text and CJK button names, and refuses to activate a text ref', async () => {
    await store.evaluate(() => {
      const box = document.createElement('section');
      box.id = 'e2e-content-probe';
      box.innerHTML =
        '<h2>保固說明</h2><p>本產品提供三年保固,支援 Thunderbolt 4。</p><button type="button">加入購物車</button>';
      document.body.appendChild(box);
    });
    const text = await find('三年保固');
    expect(text.results[0]!.role).toBe('text');
    expect(text.results[0]!.text).toContain('三年保固');
    expect(text.results[0]!.section).toBe('保固說明');
    expect((await find('購物車')).results[0]!.name).toBe('加入購物車');
    const refused = (await agent.executeTool(store, 'activate_target', { ref: text.results[0]!.ref })) as string;
    expect(refused.startsWith('Refused:')).toBe(true);
  }, 30000);

  it('a miss returns valid JSON that tells the model what was searched', async () => {
    const out = (await find('zzz-no-such-keyword')) as unknown as { results: unknown[]; hint: string };
    expect(out.results).toEqual([]);
    expect(out.hint).toContain('synonym');
  }, 30000);
});
