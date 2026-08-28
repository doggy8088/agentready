/**
 * Measures footage clip durations into video/public/footage/durations.json
 * so the composition can size scenes to the real recordings.
 *
 *   bun scripts/measure-footage.ts
 */

import { getVideoMetadata } from '@remotion/media-utils';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const DIR = path.join(ROOT, 'video', 'public', 'footage');
const clips = ['clip1-search', 'clip2-checkout', 'clip3-tools', 'clip4-spa'];

const manifest: Record<string, { file: string; seconds: number; width: number; height: number }> = {};
for (const clip of clips) {
  const file = `${clip}.webm`;
  const meta = await getVideoMetadata(path.join(DIR, file));
  manifest[clip] = {
    file: `footage/${file}`,
    seconds: meta.durationInSeconds,
    width: meta.width,
    height: meta.height,
  };
  console.log(`${clip}: ${meta.durationInSeconds.toFixed(1)}s ${meta.width}×${meta.height}`);
}
writeFileSync(path.join(DIR, 'durations.json'), JSON.stringify(manifest, null, 2));
console.log('footage manifest written');