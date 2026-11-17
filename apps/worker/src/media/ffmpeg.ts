import { spawn } from 'node:child_process';

export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}
export function ffprobeBin(): string {
  return process.env.FFPROBE_PATH?.trim() || 'ffprobe';
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Runs a binary without a shell (no injection), rejects with the stderr tail on failure. */
export function run(bin: string, args: readonly string[], opts: { onStderr?: (chunk: string) => void } = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      stderr += s;
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
      opts.onStderr?.(s);
    });
    child.on('error', (err) => reject(new Error(`cannot start ${bin}: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${bin} exited with ${code}\n${stderr.slice(-4000)}`));
    });
  });
}

/** Runs ffmpeg and returns raw stdout bytes (e.g. -f rawvideo -). */
export function ffmpegRaw(args: readonly string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpegBin(), ['-hide_banner', '-nostdin', '-v', 'error', ...args], { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => (code === 0 ? resolvePromise(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited with ${code}
${stderr.slice(-2000)}`))));
  });
}

export const ffmpeg = (args: readonly string[], opts?: { onStderr?: (chunk: string) => void }) =>
  run(ffmpegBin(), ['-hide_banner', '-nostdin', '-y', ...args], opts);

export interface ProbeStream {
  index: number;
  codec_type: 'video' | 'audio' | string;
  codec_name: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  nb_read_frames?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
}
export interface ProbeResult {
  streams: ProbeStream[];
  format: { format_name: string; duration: string; size: string; bit_rate: string };
}

export async function ffprobe(path: string, countFrames = false): Promise<ProbeResult> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format'];
  if (countFrames) args.push('-count_frames');
  const { stdout } = await run(ffprobeBin(), [...args, path]);
  return JSON.parse(stdout) as ProbeResult;
}
