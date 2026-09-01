/**
 * Bundle size checker & reporter.
 * Measures raw bytes and gzip size for compiled bundles in dist/.
 * Supports terminal output and GFM Markdown output (for CI step summary).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist');

interface FileStats {
  name: string;
  rawBytes: number;
  gzipBytes: number;
  maxRawBytes?: number;
}

const TARGETS: Array<{ name: string; maxRawBytes: number }> = [
  { name: 'agentready.js', maxRawBytes: 75 * 1024 }, // 75 KB max raw
  { name: 'agentready.min.js', maxRawBytes: 45 * 1024 }, // 45 KB max raw
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function analyze(): FileStats[] {
  const results: FileStats[] = [];

  for (const target of TARGETS) {
    const filePath = path.join(DIST_DIR, target.name);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}. Run "bun run build && bun run build:min" first.`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath);
    const gzipped = zlib.gzipSync(content);

    results.push({
      name: target.name,
      rawBytes: content.length,
      gzipBytes: gzipped.length,
      maxRawBytes: target.maxRawBytes,
    });
  }

  return results;
}

const isMarkdown = process.argv.includes('--markdown');
const stats = analyze();

if (isMarkdown) {
  console.log('### 📦 Bundle Size Summary\n');
  console.log('| Asset | Size | Gzip Size | Budget Status |');
  console.log('|---|---|---|---|');
  for (const s of stats) {
    const status = s.maxRawBytes && s.rawBytes > s.maxRawBytes ? '❌ Over Budget' : '✅ Within Budget';
    console.log(`| \`${s.name}\` | **${formatBytes(s.rawBytes)}** | ${formatBytes(s.gzipBytes)} | ${status} |`);
  }
} else {
  console.log('\n📦 AgentReady.js Bundle Stats:');
  console.log('─'.repeat(60));
  for (const s of stats) {
    const rawFmt = formatBytes(s.rawBytes).padEnd(10);
    const gzipFmt = formatBytes(s.gzipBytes).padEnd(10);
    const budgetFmt = s.maxRawBytes ? `(budget: ${formatBytes(s.maxRawBytes)})` : '';
    const status = s.maxRawBytes && s.rawBytes > s.maxRawBytes ? '❌ OVER BUDGET' : '✅ OK';
    console.log(`  ${s.name.padEnd(20)} | Raw: ${rawFmt} | Gzip: ${gzipFmt} | ${status} ${budgetFmt}`);
  }
  console.log(`${'─'.repeat(60)}\n`);
}

// Exit non-zero if over budget
for (const s of stats) {
  if (s.maxRawBytes && s.rawBytes > s.maxRawBytes) {
    console.error(`❌ Bundle ${s.name} (${formatBytes(s.rawBytes)}) exceeded limit of ${formatBytes(s.maxRawBytes)}!`);
    process.exit(1);
  }
}
