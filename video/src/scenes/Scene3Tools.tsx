/** Scene 3 — Tools & inspector: slowed footage of the live tool list + activity feed. */

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { FOOTAGE, NARRATION, FPS } from '../manifest';
import { Caption, Narration, SlowedFootage } from '../components';

export const Scene3Tools: React.FC = () => {
  const sceneFrames = Math.round((NARRATION.scene3 + 1.6) * FPS);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <SlowedFootage clip="clip3-tools" footageSeconds={FOOTAGE['clip3-tools']} sceneFrames={sceneFrames} />
      <Caption text="7 core tools + one typed tool per form — derived, not hand-written" />
      <Narration scene="scene3" />
    </AbsoluteFill>
  );
};