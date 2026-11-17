import type { CSSProperties } from 'react';
import type { Branding } from '@instantreels/core';
import { FONT_FAMILIES } from './fonts.ts';
import { px } from './layout.ts';

export interface BrandingLayerProps {
  branding: Branding;
  scale: number;
  width: number;
  height: number;
}

/** Persistent footer: small QR code, institutional label at the very bottom (both optional). */
export function BrandingLayer({ branding, scale, width, height }: BrandingLayerProps) {
  const u = px(scale);
  const qr = branding.qr;
  const label: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: u(branding.labelBottom),
    textAlign: 'center',
    fontFamily: `'${FONT_FAMILIES.label}', serif`,
    fontSize: u(branding.labelSize),
    lineHeight: 1.3,
    color: branding.labelColor,
    letterSpacing: u(1.5),
    textShadow: `0 0 ${u(10)} #060913`,
  };
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      {qr && qr.visible && (
        <div
          data-role="qr"
          style={{
            position: 'absolute',
            left: u(qr.centerX - qr.size / 2),
            bottom: u(qr.bottom),
            width: u(qr.size),
            height: u(qr.size),
            boxSizing: 'border-box',
            // white frame: with the image's own ~2-module margin this gives a >= 4-module quiet zone
            padding: u(qr.size * 0.06),
            background: '#ffffff',
            borderRadius: u(12),
          }}
        >
          <img src={qr.src} alt="" style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
      )}
      {branding.labelVisible && (
        <div style={label}>
          <span data-role="label">{branding.label}</span>
        </div>
      )}
    </div>
  );
}
