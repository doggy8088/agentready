/** Scene 0 — Cold-open title card (no narration). */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { COLORS, FONT, MONO } from '../manifest';

const CODE_LINE = '<script src="agentready.js" defer></script>';
const ease = Easing.bezier(0.16, 1, 0.3, 1);

export const Scene0Title: React.FC = () => {
  const frame = useCurrentFrame();
  const chars = Math.round(
    interpolate(frame, [52, 92], [0, CODE_LINE.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
  );
  const fade = (from: number, dur = 14) =>
    interpolate(frame, [from, from + dur], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: ease,
    });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 700px at 70% -10%, ${COLORS.accentSoft}, transparent), ${COLORS.bg}`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 32,
      }}
    >
      <div style={{ opacity: fade(4), display: 'flex', alignItems: 'center', gap: 18, color: COLORS.ink, fontFamily: FONT }}>
        <div
          style={{
            width: 64,
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
        <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: -2 }}>AgentReady</div>
      </div>

      <div style={{ opacity: fade(22), color: COLORS.muted, fontFamily: FONT, fontSize: 40, fontWeight: 500 }}>
        One script. Any site. Any agent.
      </div>

      <div style={{ opacity: fade(40) }}>
        <div
          style={{
            background: COLORS.bgSoft,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 16,
            padding: '20px 32px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ width: 14, height: 14, borderRadius: 999, background: '#F97066' }} />
            <div style={{ width: 14, height: 14, borderRadius: 999, background: '#F79009' }} />
            <div style={{ width: 14, height: 14, borderRadius: 999, background: '#12B76A' }} />
          </div>
          <div style={{ color: '#D6BBFB', fontFamily: MONO, fontSize: 33, whiteSpace: 'pre' }}>
            {CODE_LINE.slice(0, chars)}
            {frame >= 52 && frame < 92 && frame % 30 < 15 ? (
              <span style={{ color: COLORS.accent }}>▍</span>
            ) : null}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};