/**
 * Synthetic TEST media for the proof of concept (no Pexels key / recitation available yet).
 * - Background: animated nebula gradients, 1080x1920 @ 25 fps (deliberately != 30 fps and < 4K),
 *   with an 8-bit "frame code" strip (top-left) encoding the source frame number. Decoding it in the
 *   output proves the background plays at 1x and loops instead of being stretched.
 * - Audio: soft 220 Hz drone + 880 Hz beeps exactly at each scene start, to verify A/V sync.
 * Neither file is Quranic content; they are test signals only.
 */
import { ffmpeg } from '../media/ffmpeg.ts';

/** 8 squares, bit k = (sourceFrame >> k) & 1, white = 1 (1080-canvas px). */
export const FRAME_CODE = { x: 40, y: 40, cell: 40, pitch: 50, bits: 8 } as const;
export const BEEP_HZ = 880;
export const BEEP_SECONDS = 0.12;

export async function makeTestBackground(out: string, seconds: number): Promise<void> {
  const fps = 25;
  const fc = FRAME_CODE;
  const strip = `drawbox=x=${fc.x - 10}:y=${fc.y - 10}:w=${fc.pitch * fc.bits + 10}:h=${fc.cell + 20}:color=black:t=fill`;
  const bits = Array.from({ length: fc.bits }, (_, k) =>
    `drawbox=x=${fc.x + k * fc.pitch}:y=${fc.y}:w=${fc.cell}:h=${fc.cell}:color=white:t=fill:enable='eq(mod(floor(n/${2 ** k}),2),1)'`,
  );
  await ffmpeg([
    '-f', 'lavfi', '-i', `gradients=s=1080x1920:r=${fps}:d=${seconds}:speed=0.015:nb_colors=4:c0=0x3245ff:c1=0xb845ed:c2=0x060913:c3=0x1f232e:type=radial`,
    '-vf', [strip, ...bits, 'format=yuv420p'].join(','),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-g', String(fps), '-an', out,
  ]);
}

export async function makeTestAudio(out: string, seconds: number, beepStartsSec: readonly number[]): Promise<void> {
  const beeps = beepStartsSec.map((s) => `between(t,${s.toFixed(4)},${(s + BEEP_SECONDS).toFixed(4)})`).join('+');
  const expr = `0.06*sin(2*PI*220*t)+0.5*sin(2*PI*${BEEP_HZ}*t)*(${beeps || '0'})`;
  await ffmpeg(['-f', 'lavfi', '-i', `aevalsrc='${expr}|${expr}':s=48000:d=${seconds}`, '-c:a', 'pcm_s16le', out]);
}
