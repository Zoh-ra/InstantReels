import type { RenderDocument } from '@instantreels/core';
import { ffmpeg } from '../media/ffmpeg.ts';

export interface EncodePreset {
  name: '2160p30' | '1080p30';
  width: number;
  height: number;
  level: string;
  crf: number;
  maxrate: string;
  bufsize: string;
  x264Preset: string;
}

export const PRESETS: Record<EncodePreset['name'], EncodePreset> = {
  '2160p30': { name: '2160p30', width: 2160, height: 3840, level: '5.1', crf: 18, maxrate: '45M', bufsize: '90M', x264Preset: 'medium' },
  '1080p30': { name: '1080p30', width: 1080, height: 1920, level: '4.1', crf: 19, maxrate: '12M', bufsize: '24M', x264Preset: 'medium' },
};

/**
 * Builds the FFmpeg argument list (no shell). Layout:
 *  bg (looped at native speed, CFR-resampled, cover-cropped, dimmed)
 *  + concat of scene stills, each exactly (end-start) frames with alpha fade-in
 *  + persistent branding still
 *  + audio (padded/trimmed to the exact duration)
 */
export function buildComposeArgs(doc: RenderDocument, stills: { persistentPng: string; scenePngs: string[] }, preset: EncodePreset, outPath: string): string[] {
  if (stills.scenePngs.length !== doc.scenes.length) throw new Error('stills/scenes mismatch');
  const { fps, totalFrames } = doc;
  const W = preset.width;
  const H = preset.height;
  const durationSec = (totalFrames / fps).toFixed(6);
  const args: string[] = [];
  const filters: string[] = [];

  // input 0: background
  if (doc.background.kind === 'video') {
    if (doc.background.loop) args.push('-stream_loop', '-1');
    args.push('-i', doc.background.src);
    const bg = doc.background;
    filters.push(
      `[0:v]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,` +
        `eq=brightness=${bg.brightness.toFixed(3)},drawbox=x=0:y=0:w=iw:h=ih:color=black@${bg.dimOpacity.toFixed(3)}:t=fill,` +
        `trim=end_frame=${totalFrames},setpts=PTS-STARTPTS,format=gbrp[bg]`,
    );
  } else {
    args.push('-f', 'lavfi', '-i', `color=c=${doc.background.color.slice(0, 7)}:s=${W}x${H}:r=${fps}`);
    filters.push(`[0:v]trim=end_frame=${totalFrames},setpts=PTS-STARTPTS,format=gbrp[bg]`);
  }

  // input 1: persistent layer
  args.push('-loop', '1', '-framerate', String(fps), '-i', stills.persistentPng);
  filters.push(`[1:v]scale=${W}:${H}:flags=lanczos,format=rgba,trim=end_frame=${totalFrames},setpts=PTS-STARTPTS[brand]`);

  // inputs 2..: scene stills
  const sceneLabels: string[] = [];
  doc.scenes.forEach((scene, i) => {
    const input = 2 + i;
    const frames = scene.endFrame - scene.startFrame;
    args.push('-loop', '1', '-framerate', String(fps), '-i', stills.scenePngs[i] as string);
    const fade = Math.min(doc.sceneFadeInFrames, frames);
    const fadeFilter = fade > 0 ? `,fade=t=in:s=0:n=${fade}:alpha=1` : '';
    filters.push(`[${input}:v]scale=${W}:${H}:flags=lanczos,format=rgba,trim=end_frame=${frames},setpts=PTS-STARTPTS${fadeFilter}[s${i}]`);
    sceneLabels.push(`[s${i}]`);
  });
  filters.push(`${sceneLabels.join('')}concat=n=${sceneLabels.length}:v=1:a=0,setpts=PTS-STARTPTS[scenes]`);
  filters.push(`[bg][scenes]overlay=x=0:y=0:eof_action=pass:format=gbrp[v1]`);
  // RGB compositing, then a single explicit BT.709 conversion (matches the bt709 tags below)
  filters.push(`[v1][brand]overlay=x=0:y=0:eof_action=pass:format=gbrp,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[vout]`);

  const audioInput = 2 + doc.scenes.length;
  if (doc.audio) {
    args.push('-i', doc.audio.src);
    filters.push(`[${audioInput}:a]aresample=48000,apad,atrim=end=${durationSec}[aout]`);
  }

  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (doc.audio) args.push('-map', '[aout]');
  args.push(
    '-frames:v', String(totalFrames),
    '-r', String(fps), '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', preset.x264Preset, '-crf', String(preset.crf),
    '-maxrate', preset.maxrate, '-bufsize', preset.bufsize,
    '-profile:v', 'high', '-level:v', preset.level, '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
  );
  if (doc.audio) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
  args.push('-t', durationSec, '-movflags', '+faststart', outPath);
  return args;
}

export async function compose(doc: RenderDocument, stills: { persistentPng: string; scenePngs: string[] }, preset: EncodePreset, outPath: string, onProgress?: (frame: number) => void): Promise<number> {
  const t0 = performance.now();
  await ffmpeg(buildComposeArgs(doc, stills, preset, outPath), {
    onStderr: (s) => {
      const m = /frame=\s*(\d+)/.exec(s);
      if (m && onProgress) onProgress(Number(m[1]));
    },
  });
  return performance.now() - t0;
}
