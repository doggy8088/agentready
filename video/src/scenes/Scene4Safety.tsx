/** Scene 4 — Safety: checkout footage with the human approval gate. */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { COLORS, FONT, FOOTAGE, NARRATION, FPS } from '../manifest';
import { Caption, Narration, SlowedFootage } from '../components';

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const SafetyPill: React.FC<{ from: number; icon: string; label: string; color: string }> = ({
  from,
  icon,
  label,
  color,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [from, from + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  return (
    <div
      style={{
        opacity,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'rgba(12,17,29,0.85)',
        border: `1px solid ${COLORS.line}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 12,
        padding: '12px 18px',
        color: COLORS.ink,
        fontFamily: FONT,
        fontSize: 26,
        fontWeight: 600,
      }}
    >
      <span style={{ fontSize: 26 }}>{icon}</span>
      {label}
    </div>
  );
};

export const Scene4Safety: React.FC = () => {
  const sceneFrames = Math.round((NARRATION.scene4 + 2) * FPS);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <SlowedFootage clip="clip2-checkout" footageSeconds={FOOTAGE['clip2-checkout']} sceneFrames={sceneFrames} />
      <div
        style={{
          position: 'absolute',
          right: 56,
          top: 120,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <SafetyPill from={40} icon="🙈" label="password · card → never exposed" color={COLORS.danger} />
        <SafetyPill from={130} icon="🙋" label="submit → human approval" color={COLORS.warn} />
      </div>
      <Caption text="The agent proposes. The person approves." />
      <Narration scene="scene4" />
    </AbsoluteFill>
  );
};