/**
 * E2E helpers: static server + browser launch (system Chrome first, bundled
 * Chromium as fallback) + typed access to window.AgentReady.
 */

import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { resolveUnderRoot } from '../../scripts/serve.js';

export const REPO_ROOT = path.resolve(import.meta.dir, '../..');

export function startServer(): { baseUrl: string; stop(): void } {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const safe = resolveUnderRoot(REPO_ROOT, url.pathname);
      if (!safe) return new Response('Bad request', { status: 400 });
      const file = Bun.file(safe.resolved);
      if (!(await file.exists())) return new Response('Not found', { status: 404 });
      return new Response(file);
    },
  });
  return { baseUrl: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  try {
    // Prefer the real Chrome (also the browser judges will use).
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

interface AgentReadyWindow {
  AgentReady?: {
    version: string;
    hasNativeWebMCP: boolean;
    getTools(): Promise<Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>>;
    executeTool(name: string, argsJson: string): Promise<unknown>;
  };
}

export const agent = {
  version(page: Page): Promise<string> {
    return page.evaluate(() => (window as unknown as AgentReadyWindow).AgentReady?.version ?? '');
  },
  async getToolNames(page: Page): Promise<string[]> {
    const tools = (await page.evaluate(() =>
      (window as unknown as AgentReadyWindow).AgentReady?.getTools() ?? []
    )) as Array<{ name: string }>;
    return tools.map((t) => t.name);
  },
  executeTool(page: Page, name: string, args: Record<string, unknown>): Promise<unknown> {
    return page.evaluate(
      ([n, a]) => (window as unknown as AgentReadyWindow).AgentReady!.executeTool(n, JSON.stringify(a)),
      [name, args] as [string, Record<string, unknown>]
    );
  },
};

export const TEST_PAGE = '/demo/test-page/';
export const STORE_PAGE = '/demo/store/';