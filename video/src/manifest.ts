/** Shared design tokens + measured timeline data for the demo video. */

export const COLORS = {
  bg: '#0C111D',
  bgSoft: '#141C2E',
  ink: '#FFFFFF',
  muted: '#98A2B3',
  accent: '#7F56D9',
  accentSoft: 'rgba(127,86,217,0.18)',
  ok: '#12B76A',
  warn: '#F79009',
  danger: '#F97066',
  line: 'rgba(255,255,255,0.10)',
};

export const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", monospace';

export const FPS = 30;

/** Narration durations measured by scripts/generate-narration.ts (afinfo). */
export const NARRATION: Record<string, number> = {
  scene1: 12.5,
  scene2: 17.6,
  scene3: 17.5,
  scene4: 15.5,
  scene5: 12.2,
  scene6: 11.0,
  scene7: 3.7,
};

/** Footage clip durations measured by scripts (mediabunny). */
export const FOOTAGE: Record<string, number> = {
  'clip1-search': 6.6,
  'clip2-checkout': 13.3,
  'clip3-tools': 8.1,
  'clip4-spa': 7.6,
};

export const round1 = (n: number): number => Math.round(n * 10) / 10;