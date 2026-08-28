/** Scene 1 — Hook: real footage, the agent shops an ordinary store. */

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { FOOTAGE, NARRATION, FPS } from '../manifest';
import { Caption, Footage, Narration, TitleChip } from '../components';

export const Scene1Hook: React.FC = () => {
  const sceneFrames = Math.round((NARRATION.scene1 + 1.6) * FPS);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Footage clip="clip1-search" footageSeconds={FOOTAGE['clip1-search']} sceneFrames={sceneFrames} />
      <TitleChip text="Level 0 — one script tag" />
      <Caption text="Agent calls search_products({ q, max_price }) on a site with zero AI code" />
      <Narration scene="scene1" />
    </AbsoluteFill>
  );
};