/**
 * Generates per-scene narration audio with the free, local macOS `say` TTS
 * (swap for ElevenLabs or your own voice later — see docs/VIDEO_SCRIPT.md).
 * Output: video/public/voiceover/sceneN.m4a + a durations.json manifest.
 *
 *   bun scripts/generate-narration.ts
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const OUT = path.join(ROOT, 'video', 'public', 'voiceover');
mkdirSync(OUT, { recursive: true });

const VOICE = process.env.SAY_VOICE ?? 'Samantha';
const RATE = process.env.SAY_RATE ?? '175';

interface Scene {
  id: string;
  text: string;
}

const SCENES: Scene[] = [
  {
    id: 'scene1',
    text:
      'This is a completely ordinary online store. I did not build any AI integration. ' +
      'I added one script tag, and now ChatGPT can shop it. This is AgentReady.',
  },
  {
    id: 'scene2',
    text:
      'This is the entire integration. AgentReady reads the page semantic HTML: forms, buttons, labels. ' +
      'It registers structured WebMCP tools through document modelContext. No SDK, no rewrite, no backend. ' +
      'The web stays exactly the same for humans.',
  },
  {
    id: 'scene3',
    text:
      'Instead of exposing a hundred click this div tools, AgentReady derives a small semantic surface. ' +
      'Seven core tools, plus one real tool per form, with a typed JSON schema. Fewer, clearer tools ' +
      'make the agent better at choosing the right one.',
  },
  {
    id: 'scene4',
    text:
      'AgentReady is safe by design. Passwords and card fields are never exposed to the agent. ' +
      'Not their existence, not their values. And consequential actions, like submitting an order, ' +
      'wait for a human tap. The agent proposes. The person approves.',
  },
  {
    id: 'scene5',
    text:
      'Because AgentReady speaks the open WebMCP standard, the same website works with ChatGPT, ' +
      'with in-page agents like AskPage, and with any future client. No per-agent integrations.',
  },
  {
    id: 'scene6',
    text:
      'Single page apps change all the time. AgentReady watches the DOM and re-registers tools ' +
      'within milliseconds. Stale references resolve to nothing instead of crashing.',
  },
  {
    id: 'scene7',
    text: 'AgentReady. Make the web you already have, agent ready.',
  },
];

// aiff → m4a (Chrome-playable) with the built-in macOS converter.
function toM4a(aiff: string, m4a: string): void {
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, m4a], { stdio: 'pipe' });
}

/** afinfo prints "estimated duration: 12.345 sec" — parse it. */
function getDurationSeconds(file: string): number {
  const out = execFileSync('afinfo', [file], { encoding: 'utf8' });
  const m = out.match(/estimated duration:\s*([\d.]+)/);
  return m ? Number(m[1]) : 5;
}

const manifest: Record<string, { file: string; seconds: number }> = {};
for (const scene of SCENES) {
  const aiff = path.join(OUT, `${scene.id}.aiff`);
  const m4a = path.join(OUT, `${scene.id}.m4a`);
  if (!existsSync(m4a) || process.env.FORCE === '1') {
    execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', aiff, scene.text], { stdio: 'pipe' });
    toM4a(aiff, m4a);
  }
  const seconds = getDurationSeconds(m4a);
  manifest[scene.id] = { file: `voiceover/${scene.id}.m4a`, seconds };
  console.log(`${scene.id}: ${seconds.toFixed(1)}s`);
}
writeFileSync(path.join(OUT, 'durations.json'), JSON.stringify(manifest, null, 2));
console.log('manifest written');