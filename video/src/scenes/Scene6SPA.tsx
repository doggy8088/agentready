/** Scene 6 — SPA: dynamic form injection → tool appears live. */

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { FOOTAGE, NARRATION, FPS } from '../manifest';
import { Caption, Narration, SlowedFootage } from '../components';

export const Scene6SPA: React.FC = () => {
  const sceneFrames = Math.round((NARRATION.scene6 + 1.4) * FPS);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <SlowedFootage clip="clip4-spa" footageSeconds={FOOTAGE['clip4-spa']} sceneFrames={sceneFrames} />
      <Caption text="DOM changed → newsletter_subscription registered in milliseconds" />
      <Narration scene="scene6" />
    </AbsoluteFill>
  );
};