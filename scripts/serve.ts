/**
 * Tiny static file server for development, the demo store and E2E tests.
 * Serves the repository root so /dist, /demo/* and fixtures are reachable.
 *
 *   bun run scripts/serve.ts --port 8788
 */

import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const port = Number(process.env.PORT) || Number(getArg('--port')) || 0;

function getArg(name: string): string | undefined {
  const i = Bun.argv.indexOf(`--${name.replace(/^-+/, '')}`);
  return i >= 0 ? Bun.argv[i + 1] : undefined;
}

/** Resolve a URL pathname under root, rejecting escapes and malformed encoding. Returns null when the request must be rejected. */
export function resolveUnderRoot(root: string, rawPathname: string): { pathname: string; resolved: string } | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return null; // malformed percent-encoding → reject
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const resolved = path.resolve(root, '.' + pathname);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return { pathname, resolved };
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const safe = resolveUnderRoot(root, url.pathname);
    if (!safe) return new Response('Bad request', { status: 400 });
    const file = Bun.file(safe.resolved);
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    return new Response(file);
  },
});

console.log(`▶ Serving ${root}`);
console.log(`▶ Demo store  → http://localhost:${server.port}/demo/store/`);
console.log(`▶ Test page   → http://localhost:${server.port}/demo/test-page/`);
console.log('  Open in Chrome 149+ with chrome://flags/#enable-webmcp-testing,');
console.log('  or in the ChatGPT desktop app in-app browser.');