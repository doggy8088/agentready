import React from 'react';
import { Composition } from 'remotion';
import { AgentReadyDemo, totalDuration } from './AgentReadyDemo';
import { FPS } from './manifest';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="AgentReadyDemo"
      component={AgentReadyDemo}
      durationInFrames={totalDuration}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};