/** Scene 2 — How it works: semantic HTML → structured WebMCP tools (animated diagram). */

import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { COLORS, FONT, MONO } from '../manifest';
import { Narration } from '../components';

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const Card: React.FC<{
  from: number;
  title: string;
  lines: string[];
  accent: string;
  width: number;
}> = ({ from, title, lines, accent, width }) => {
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
        translate: interpolate(frame, [from, from + 16], ['0px 26px', '0px 0px'], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: ease,
        }),
        width,
        background: COLORS.bgSoft,
        border: `1px solid ${COLORS.line}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 18,
        padding: '26px 30px',
        fontFamily: FONT,
      }}
    >
      <div style={{ color: accent, fontSize: 24, fontWeight: 700, marginBottom: 14 }}>{title}</div>
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            color: COLORS.ink,
            fontFamily: MONO,
            fontSize: 24,
            padding: '7px 0',
            opacity: interpolate(frame, [from + 10 + i * 6, from + 22 + i * 6], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
};

const Arrow: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [from, from + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', opacity: grow }}>
      <div style={{ width: 80 * grow, height: 2, background: COLORS.accent }} />
      <div style={{ color: COLORS.accent, fontSize: 30, marginLeft: -6 }}>▸</div>
    </div>
  );
};

export const Scene2How: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 44,
      }}
    >
      <div style={{ color: COLORS.ink, fontFamily: FONT, fontSize: 44, fontWeight: 800 }}>
        How it works <span style={{ color: COLORS.muted, fontWeight: 500 }}>— progressive enhancement</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Card
          from={10}
          title="Your existing site"
          accent={COLORS.ok}
          width={440}
          lines={[
            '<form aria-label="Search">',
            '  <input name="q">',
            '  <select name="category">',
            '  <button>Search</button>',
          ]}
        />
        <Arrow from={28} />
        <Card
          from={44}
          title="AgentReady runtime"
          accent={COLORS.accent}
          width={460}
          lines={['semantic discovery', 'safety policy', 'tool synthesis', 'inspector + approvals']}
        />
        <Arrow from={62} />
        <Card
          from={78}
          title="WebMCP tools"
          accent={COLORS.ok}
          width={500}
          lines={[
            'search_products({ q, max_price })',
            'find_on_page("add to cart")',
            'fill_form({ Email: … })',
            'submit_form(…)  ← human approves',
          ]}
        />
      </div>

      <div
        style={{
          color: COLORS.muted,
          fontFamily: FONT,
          fontSize: 28,
          opacity: interpolate(frame, [110, 125], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease,
          }),
        }}
      >
        document.modelContext.registerTool(…) — the open standard, no lock-in
      </div>

      <Narration scene="scene2" />
    </AbsoluteFill>
  );
};