/**
 * Captures real product footage for the demo video with Playwright
 * (1920×1080 webm per clip) into video/public/footage/.
 *
 *   bun scripts/capture-footage.ts
 */

import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dir, '..');
const OUT = path.join(ROOT, 'video', 'public', 'footage');

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const resolved = path.resolve(ROOT, `.${p}`);
    if (!resolved.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    const file = Bun.file(resolved);
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    return new Response(file);
  },
});
const base = `http://localhost:${server.port}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });

interface AR {
  AgentReady: {
    executeTool(n: string, a: string): Promise<unknown>;
  };
}

async function record(
  name: string,
  scenario: (page: import('playwright').Page) => Promise<void>,
  settleMs: number,
): Promise<void> {
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  let rawPath: string | undefined;
  try {
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${base}/demo/store/`);
    await page.waitForFunction(() => (window as unknown as { AgentReady?: unknown }).AgentReady !== undefined);
    await page.waitForTimeout(1500);
    await scenario(page);
    await page.waitForTimeout(settleMs);
    rawPath = await page.video()?.path();
  } finally {
    await ctx.close();
  }
  if (rawPath) {
    const { renameSync } = await import('node:fs');
    renameSync(rawPath, path.join(OUT, `${name}.webm`));
  }
  console.log('recorded', name);
}

const tool = (page: import('playwright').Page, name: string, args: Record<string, unknown>): Promise<unknown> =>
  page.evaluate(([n, a]) => (window as unknown as AR).AgentReady.executeTool(n, JSON.stringify(a)), [name, args] as [
    string,
    Record<string, unknown>,
  ]);

const findRef = async (page: import('playwright').Page, query: string, kind?: string): Promise<string> => {
  const raw = JSON.parse((await tool(page, 'find_on_page', { query, kind })) as string) as {
    results: Array<{ ref: string }>;
  };
  return (
    // biome-ignore lint/style/noNonNullAssertion: find_on_page just returned results for this query.
    raw.results[0]!.ref
  );
};

// Clip 1: agent searches the storefront (synthesized tool, results render).
await record(
  'clip1-search',
  async (page) => {
    await tool(page, 'product_search', { q: 'keyboard', max_price: 150 });
    await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 0, undefined, {
      timeout: 5000,
    });
    await page.evaluate(() => {
      // biome-ignore lint/style/noNonNullAssertion: the #results container is static markup of the demo store.
      document.querySelector('#results')!.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(1800);
  },
  2000,
);

// Clip 2: add to cart (inspector highlight) → open cart → checkout (approval) → fill → submit (approval) → order.
await record(
  'clip2-checkout',
  async (page) => {
    await tool(page, 'activate_target', { ref: await findRef(page, 'Add MechKeyboard Pro to cart') });
    await page.waitForTimeout(1600);
    await tool(page, 'activate_target', { ref: await findRef(page, 'open cart') });
    await page.waitForTimeout(900);
    const pending = tool(page, 'activate_target', { ref: await findRef(page, 'go to checkout') });
    await page.locator('div[data-agentready-ui] .confirm').waitFor({ state: 'visible' });
    await page.waitForTimeout(1400);
    await page.locator('div[data-agentready-ui] .confirm .primary').click();
    await pending;
    await page.waitForTimeout(700);
    const fieldRef = await findRef(page, 'name on card', 'field');
    await tool(page, 'fill_form', {
      ref: fieldRef,
      values: {
        'Name on card': 'Will Tang',
        'Email for receipt': 'will@example.com',
        'Shipping address': '1 Agent Way',
      },
    });
    await page.waitForTimeout(1400);
    const submit = tool(page, 'submit_form', { ref: fieldRef, summary: 'Place order' });
    await page.locator('div[data-agentready-ui] .confirm').waitFor({ state: 'visible' });
    await page.waitForTimeout(1600);
    await page.locator('div[data-agentready-ui] .confirm .primary').click();
    await submit;
    await page.waitForTimeout(1800);
  },
  2000,
);

// Clip 3: test page — inspector badge opens live tool list + activity feed.
await record(
  'clip3-tools',
  async (page) => {
    await page.goto(`${base}/demo/test-page/`);
    await page.waitForFunction(() => (window as unknown as { AgentReady?: unknown }).AgentReady !== undefined);
    await page.waitForTimeout(1200);
    await page.locator('div[data-agentready-ui] .badge').click();
    await page.waitForTimeout(900);
    await tool(page, 'find_on_page', { query: 'delete account' });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
  },
  1500,
);

// Clip 4: SPA — inject a newsletter form, new tool appears in the badge count.
await record(
  'clip4-spa',
  async (page) => {
    await page.goto(`${base}/demo/test-page/`);
    await page.waitForFunction(() => (window as unknown as { AgentReady?: unknown }).AgentReady !== undefined);
    await page.waitForTimeout(800);
    await page.locator('div[data-agentready-ui] .badge').click();
    await page.waitForTimeout(700);
    await page.click('#inject-form');
    await page.waitForTimeout(1800);
  },
  1200,
);

await browser.close();
server.stop();
console.log('done');
