/** Scene 5 — Open standard: one site, every agent. */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { COLORS, FONT, MONO } from '../manifest';
import { Narration } from '../components';

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const AgentCard: React.FC<{ from: number; emoji: string; name: string; note: string }> = ({
  from,
  emoji,
  name,
  note,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [from, from + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  return (
    <div
      style={{
        opacity,
        width: 420,
        background: COLORS.bgSoft,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 18,
        padding: '26px 30px',
        fontFamily: FONT,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 46 }}>{emoji}</div>
      <div style={{ color: COLORS.ink, fontSize: 32, fontWeight: 700, marginTop: 8 }}>{name}</div>
      <div style={{ color: COLORS.muted, fontSize: 22, marginTop: 6, fontFamily: MONO }}>{note}</div>
    </div>
  );
};

export const Scene5Interop: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 46,
      }}
    >
      <div style={{ color: COLORS.ink, fontFamily: FONT, fontSize: 44, fontWeight: 800 }}>
        One website. <span style={{ color: COLORS.accent }}>Every agent.</span>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        <AgentCard from={8} emoji="🤖" name="ChatGPT" note="in-app browser · WebMCP by default" />
        <AgentCard from={20} emoji="🌐" name="Chrome 149+" note="chrome://flags/#enable-webmcp-testing" />
        <AgentCard from={32} emoji="🧩" name="AskPage" note="in-page agent · getTools() / executeTool()" />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          opacity: interpolate(frame, [50, 64], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease,
          }),
        }}
      >
        <div style={{ width: 160, height: 2, background: COLORS.accent }} />
        <div
          style={{
            border: `2px solid ${COLORS.accent}`,
            borderRadius: 14,
            padding: '14px 28px',
            color: COLORS.ink,
            fontFamily: FONT,
            fontSize: 30,
            fontWeight: 700,
          }}
        >
          the same WebMCP tools
        </div>
        <div style={{ width: 160, height: 2, background: COLORS.accent }} />
      </div>

      <Narration scene="scene5" />
    </AbsoluteFill>
  );
};