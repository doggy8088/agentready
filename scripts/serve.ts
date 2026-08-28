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

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const resolved = path.resolve(root, '.' + pathname);
    if (!resolved.startsWith(root)) return new Response('Forbidden', { status: 403 });
    const file = Bun.file(resolved);
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    return new Response(file);
  },
});

console.log(`▶ Serving ${root}`);
console.log(`▶ Demo store  → http://localhost:${server.port}/demo/store/`);
console.log(`▶ Test page   → http://localhost:${server.port}/demo/test-page/`);
console.log('  Open in Chrome 149+ with chrome://flags/#enable-webmcp-testing,');
console.log('  or in the ChatGPT desktop app in-app browser.');