/** Scene 7 — Outro: tagline + links. */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { COLORS, FONT, MONO, NARRATION, FPS } from '../manifest';
import { Narration } from '../components';

const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const Scene7Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const sceneFrames = Math.round((NARRATION.scene7 + 3) * FPS);
  const fadeOut = interpolate(frame, [sceneFrames - 20, sceneFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{
        opacity: fadeOut,
        background: `radial-gradient(1200px 700px at 50% 120%, ${COLORS.accentSoft}, transparent), ${COLORS.bg}`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 30,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          color: COLORS.ink,
          fontFamily: FONT,
          opacity: interpolate(frame, [4, 14], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease,
          }),
        }}
      >
        <div
          style={{
            width: 60,
            height: 64,
            borderRadius: 18,
            background: COLORS.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 34,
          }}
        >
          ⌂
        </div>
        <div style={{ fontSize: 88, fontWeight: 800, letterSpacing: -2 }}>AgentReady</div>
      </div>

      <div
        style={{
          opacity: interpolate(frame, [14, 26], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease,
          }),
          color: COLORS.muted,
          fontFamily: FONT,
          fontSize: 38,
          fontWeight: 500,
        }}
      >
        One script. Any site. Any agent.
      </div>

      <div
        style={{
          opacity: interpolate(frame, [40, 55], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          color: '#D6BBFB',
          fontFamily: MONO,
          fontSize: 28,
        }}
      >
        github.com/doggy8088/agentready · MIT
      </div>

      <Narration scene="scene7" />
    </AbsoluteFill>
  );
};