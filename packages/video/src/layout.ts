/**
 * Default reel layout on the 1080×1920 design canvas (scaled for 4K).
 *  Top    : calligraphic Surah title        (≈ 150–300)
 *  Centre : Quranic content zone            (340 → 1920 − 330)
 *  Bottom : small QR (bottom 132, 150 px), label at the very bottom (bottom 64)
 * Side margins keep content away from the right-hand action rail of TikTok / Reels / Shorts.
 */
export const CONTENT_ZONE = { top: 340, bottom: 330, side: 96 } as const;

/** Minimum distance any rendered element must keep from the canvas edges. */
export const EDGE_MARGIN = 40;

export const px = (scale: number) => (n: number) => `${n * scale}px`;

export function withAlpha(hex: string, alpha: number): string {
  return hex.slice(0, 7) + Math.round(alpha * 255).toString(16).padStart(2, '0');
}
