/** Master composition — all scenes stitched with cross-fades. */

import React from 'react';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { NARRATION, FPS } from './manifest';
import { Scene0Title } from './scenes/Scene0Title';
import { Scene1Hook } from './scenes/Scene1Hook';
import { Scene2How } from './scenes/Scene2How';
import { Scene3Tools } from './scenes/Scene3Tools';
import { Scene4Safety } from './scenes/Scene4Safety';
import { Scene5Interop } from './scenes/Scene5Interop';
import { Scene6SPA } from './scenes/Scene6SPA';
import { Scene7Outro } from './scenes/Scene7Outro';

const frames = (seconds: number) => Math.round(seconds * FPS);
const TRANSITION_FRAMES = 15;

const SCENES = [
  { name: '00 Title', durationInFrames: frames(4.4), Component: Scene0Title },
  { name: '01 Hook — search', durationInFrames: frames(NARRATION.scene1 + 1.6), Component: Scene1Hook },
  { name: '02 How it works', durationInFrames: frames(NARRATION.scene2 + 1.4), Component: Scene2How },
  { name: '03 Tools & inspector', durationInFrames: frames(NARRATION.scene3 + 1.6), Component: Scene3Tools },
  { name: '04 Safety gate', durationInFrames: frames(NARRATION.scene4 + 2), Component: Scene4Safety },
  { name: '05 Open standard', durationInFrames: frames(NARRATION.scene5 + 1.4), Component: Scene5Interop },
  { name: '06 SPA re-synthesis', durationInFrames: frames(NARRATION.scene6 + 1.4), Component: Scene6SPA },
  { name: '07 Outro', durationInFrames: frames(NARRATION.scene7 + 3), Component: Scene7Outro },
];

export const totalDuration =
  SCENES.reduce((sum, s) => sum + s.durationInFrames, 0) - TRANSITION_FRAMES * (SCENES.length - 1);

export const AgentReadyDemo: React.FC = () => {
  return (
    <TransitionSeries>
      {SCENES.flatMap((scene, i) => {
        const items: React.ReactNode[] = [
          <TransitionSeries.Sequence
            key={scene.name}
            durationInFrames={scene.durationInFrames}
            name={scene.name}
          >
            <scene.Component />
          </TransitionSeries.Sequence>,
        ];
        if (i < SCENES.length - 1) {
          items.push(
            <TransitionSeries.Transition
              key={`transition-${scene.name}`}
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />
          );
        }
        return items;
      })}
    </TransitionSeries>
  );
};