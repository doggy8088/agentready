/**
 * Generates natural, studio-quality per-scene narration audio using the Gemini API
 * (Gemini 3.1 Flash Live / Native Audio).
 * Converts raw 24kHz PCM to high-quality .m4a audio and updates durations manifest.
 *
 *   bun scripts/generate-narration.ts
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Modality } from '@google/genai';

const ROOT = path.resolve(import.meta.dir, '..');
const OUT = path.join(ROOT, 'video', 'public', 'voiceover');
const MANIFEST_PATH = path.join(ROOT, 'video', 'src', 'manifest.ts');
mkdirSync(OUT, { recursive: true });

const VOICE = process.env.GEMINI_VOICE ?? 'Puck'; // Puck (energetic/clear), Kore (calm/warm), Aoede (expressive/crisp), Fenrir, Charon

interface Scene {
  id: string;
  text: string;
}

const SCENES: Scene[] = [
  {
    id: 'scene1',
    text:
      'This is a completely ordinary online store. I did not build any custom AI integration. ' +
      'I added one script tag, and now ChatGPT can shop it directly. This is AgentReady.',
  },
  {
    id: 'scene2',
    text:
      'This is the entire integration. AgentReady reads the page semantic HTML: forms, buttons, and labels. ' +
      'It registers structured WebMCP tools through document dot modelContext. No SDK, no rewrite, no backend. ' +
      'The web stays exactly the same for humans.',
  },
  {
    id: 'scene3',
    text:
      'Instead of exposing a hundred messy click-this-div tools, AgentReady derives a small, semantic surface. ' +
      'Seven core tools, plus one real tool per form, with a typed JSON schema. Fewer, clearer tools ' +
      'make the agent significantly better at choosing the right one.',
  },
  {
    id: 'scene4',
    text:
      'AgentReady is safe by design. Passwords and card fields are never exposed to the agent — ' +
      'not their existence, and not their values. And consequential actions, like submitting an order, ' +
      'wait for a human tap. The agent proposes; the person approves.',
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

async function generateSpeechGemini(text: string, voice: string): Promise<Buffer> {
  const ai = new GoogleGenAI({});
  const chunks: Buffer[] = [];
  let doneResolver: () => void;
  const donePromise = new Promise<void>((resolve) => {
    doneResolver = resolve;
  });

  const session = await ai.live.connect({
    model: 'gemini-3.1-flash-live-preview',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
      systemInstruction: {
        parts: [
          {
            text:
              'You are a professional, confident, natural keynote presenter demonstrating a breakthrough developer product. ' +
              'Speak with clear articulation, natural pacing, and an engaging tone. ' +
              'Read ONLY the exact narration text provided. Do not add any greeting, filler, or commentary.',
          },
        ],
      },
    },
    callbacks: {
      onmessage: (msg: any) => {
        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.data) {
              chunks.push(Buffer.from(part.inlineData.data, 'base64'));
            }
          }
        }
        if (msg.serverContent?.turnComplete) {
          doneResolver();
        }
      },
      onerror: (err: any) => {
        console.error('Gemini Live API error:', err);
        doneResolver();
      },
    },
  });

  session.sendRealtimeInput({ text });
  await donePromise;
  session.close();

  return Buffer.concat(chunks);
}

function pcmToM4a(pcmBuffer: Buffer, m4aPath: string): void {
  const tempPcm = m4aPath + '.pcm';
  writeFileSync(tempPcm, pcmBuffer);
  try {
    execFileSync('ffmpeg', ['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', tempPcm, m4aPath], {
      stdio: 'pipe',
    });
  } finally {
    if (existsSync(tempPcm)) unlinkSync(tempPcm);
  }
}

function getDurationSeconds(file: string): number {
  try {
    const out = execFileSync('afinfo', [file], { encoding: 'utf8' });
    const m = out.match(/estimated duration:\s*([\d.]+)/);
    if (m) return Math.round(Number(m[1]) * 10) / 10;
  } catch {
    // fallback to ffprobe
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { encoding: 'utf8' }
    );
    const num = Number(out.trim());
    if (!isNaN(num)) return Math.round(num * 10) / 10;
  }
  return 5.0;
}

async function main() {
  console.log(`🎙️  Generating narration with Gemini Live API (Voice: ${VOICE})...\n`);

  const manifest: Record<string, { file: string; seconds: number }> = {};
  const durations: Record<string, number> = {};

  for (const scene of SCENES) {
    const m4a = path.join(OUT, `${scene.id}.m4a`);
    console.log(`Generating ${scene.id}... ("${scene.text.slice(0, 45)}...")`);

    const pcm = await generateSpeechGemini(scene.text, VOICE);
    if (pcm.length === 0) {
      throw new Error(`Failed to receive audio from Gemini API for ${scene.id}`);
    }
    pcmToM4a(pcm, m4a);

    const seconds = getDurationSeconds(m4a);
    durations[scene.id] = seconds;
    manifest[scene.id] = { file: `voiceover/${scene.id}.m4a`, seconds };
    console.log(`  ✓ ${scene.id}.m4a (${seconds.toFixed(1)}s, ${pcm.length} bytes)\n`);
  }

  // Write durations.json
  const manifestJsonPath = path.join(OUT, 'durations.json');
  writeFileSync(manifestJsonPath, JSON.stringify(manifest, null, 2));
  console.log(`✅ Saved ${manifestJsonPath}`);

  // Update video/src/manifest.ts
  if (existsSync(MANIFEST_PATH)) {
    let manifestContent = readFileSync(MANIFEST_PATH, 'utf8');
    const narrationBlock = `export const NARRATION: Record<string, number> = {\n${Object.entries(durations)
      .map(([k, v]) => `  ${k}: ${v.toFixed(1)},`)
      .join('\n')}\n};`;

    manifestContent = manifestContent.replace(
      /export const NARRATION: Record<string, number> = \{[\s\S]*?\};/,
      narrationBlock
    );
    writeFileSync(MANIFEST_PATH, manifestContent);
    console.log(`✅ Updated ${MANIFEST_PATH} with new durations`);
  }

  console.log('\n🎉 Narration generation complete!');
}

main().catch((err) => {
  console.error('Fatal error generating narration:', err);
  process.exit(1);
});