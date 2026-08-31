/** Shared scene scaffolding: footage player with hold-last-frame, captions, narration. */

import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import { Video } from '@remotion/media';
import { staticFile } from 'remotion';
import { COLORS, FONT } from './manifest';

export const Narration: React.FC<{ scene: string; leadSeconds?: number }> = ({
  scene,
  leadSeconds = 0.6,
}) => (
  <Sequence from={Math.round(leadSeconds * 30)} layout="none">
    <Audio src={staticFile(`voiceover/${scene}.m4a`)} />
  </Sequence>
);

/** Footage that plays at natural speed, then freezes on its last frame. */
export const Footage: React.FC<{ clip: string; footageSeconds: number; sceneFrames: number }> = ({
  clip,
  footageSeconds,
  sceneFrames,
}) => {
  const fps = 30;
  const footageFrames = Math.round(footageSeconds * fps);
  const hold = Math.max(0, sceneFrames - footageFrames);
  return (
    <>
      <Sequence durationInFrames={footageFrames}>
        <Video
          src={staticFile(`footage/${clip}.webm`)}
          style={{ width: 1920, height: 1080, objectFit: 'cover' }}
        />
      </Sequence>
      {hold > 0 ? (
        <Sequence from={footageFrames} durationInFrames={hold}>
          <Freeze frame={footageFrames - 1}>
            <Video
              src={staticFile(`footage/${clip}.webm`)}
              style={{ width: 1920, height: 1080, objectFit: 'cover' }}
            />
          </Freeze>
        </Sequence>
      ) : null}
    </>
  );
};

/** Slow motion variant: playbackRate stretches footage to cover the scene. */
export const SlowedFootage: React.FC<{ clip: string; footageSeconds: number; sceneFrames: number }> = ({
  clip,
  footageSeconds,
  sceneFrames,
}) => {
  const fps = 30;
  const target = sceneFrames / fps;
  const rate = Math.max(0.55, Math.min(1, footageSeconds / target));
  const stretched = footageSeconds / rate;
  const frames = Math.round(stretched * fps);
  const hold = Math.max(0, sceneFrames - frames);
  return (
    <>
      <Sequence durationInFrames={frames}>
        <Video
          src={staticFile(`footage/${clip}.webm`)}
          playbackRate={rate}
          style={{ width: 1920, height: 1080, objectFit: 'cover' }}
        />
      </Sequence>
      {hold > 0 ? (
        <Sequence from={frames} durationInFrames={hold}>
          <Freeze frame={frames - 1}>
            <Video
              src={staticFile(`footage/${clip}.webm`)}
              playbackRate={rate}
              style={{ width: 1920, height: 1080, objectFit: 'cover' }}
            />
          </Freeze>
        </Sequence>
      ) : null}
    </>
  );
};

export const Caption: React.FC<{ text: string; delaySeconds?: number }> = ({ text, delaySeconds = 0.4 }) => {
  const frame = useCurrentFrame();
  const fps = useVideoConfig().fps;
  const from = Math.round(delaySeconds * fps);
  const opacity = interpolate(frame, [from, from + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 36,
        display: 'flex',
        justifyContent: 'center',
        opacity,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: 'rgba(12, 17, 29, 0.90)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${COLORS.line}`,
          borderRadius: 16,
          padding: '12px 28px',
          color: COLORS.ink,
          fontFamily: FONT,
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: 0.2,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          maxWidth: 1300,
          textAlign: 'center',
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const TitleChip: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [4, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <div
      style={{
        position: 'absolute',
        top: 24,
        right: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        opacity,
        background: 'rgba(12, 17, 29, 0.90)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${COLORS.line}`,
        borderRadius: 999,
        padding: '10px 22px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ width: 12, height: 12, borderRadius: 999, background: COLORS.ok }} />
      <div style={{ color: COLORS.ink, fontFamily: FONT, fontSize: 24, fontWeight: 800 }}>
        AgentReady <span style={{ color: COLORS.muted, fontWeight: 500 }}>— {text}</span>
      </div>
    </div>
  );
};

export const DarkFill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>{children}</AbsoluteFill>
);