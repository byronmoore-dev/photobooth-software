import { spawn } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import type { SessionMetadata } from '../../shared/types';

const LIVE_BEFORE_MS = 1_150;
const LIVE_AFTER_MS = 650;
const PHOTO_MS = 700;
const FINAL_MS = 1_400;

interface RecapTimelineItem {
  index: number;
  startMs: number;
  durationMs: number;
  photoDurationMs: number;
}

export interface RecapPlan {
  items: RecapTimelineItem[];
  finalDurationMs: number;
  durationMs: number;
}

interface GenerateRecapInput {
  ffmpegPath: string;
  videoPath: string;
  originalPaths: string[];
  finalPath: string;
  outputPath: string;
  markers: SessionMetadata['videoMarkers'];
  title: string;
  signal?: AbortSignal;
  width?: number;
  height?: number;
}

export const createRecapPlan = (markers: SessionMetadata['videoMarkers']): RecapPlan => {
  const ordered = [...markers].sort((left, right) => left.index - right.index);
  if (ordered.length !== 3 || ordered.some((marker, index) => marker.index !== index)) {
    throw new Error('A recap requires one shutter timestamp for each of the three photos');
  }
  const items = ordered.map((marker) => ({
    index: marker.index,
    startMs: Math.max(0, marker.offsetMs - LIVE_BEFORE_MS),
    durationMs: LIVE_BEFORE_MS + LIVE_AFTER_MS,
    photoDurationMs: PHOTO_MS,
  }));
  return {
    items,
    finalDurationMs: FINAL_MS,
    durationMs: items.reduce((total, item) => total + item.durationMs + item.photoDurationMs, FINAL_MS),
  };
};

const portraitFilter = (
  source: string,
  label: string,
  width: number,
  height: number,
  durationMs: number,
  trimStartMs?: number,
) => {
  const backgroundWidth = Math.max(180, Math.floor(width / 3));
  const backgroundHeight = Math.max(320, Math.floor(height / 3));
  const foregroundWidth = width - Math.max(40, Math.round(width * 0.075));
  const foregroundHeight = height - Math.max(80, Math.round(height * 0.09));
  const trim =
    trimStartMs === undefined
      ? `trim=duration=${durationMs / 1000}`
      : `trim=start=${trimStartMs / 1000}:duration=${durationMs / 1000}`;
  return [
    `${source}${trim},setpts=PTS-STARTPTS,split=2[${label}bg0][${label}fg0]`,
    `[${label}bg0]scale=${backgroundWidth}:${backgroundHeight}:force_original_aspect_ratio=increase,crop=${backgroundWidth}:${backgroundHeight},gblur=sigma=18,scale=${width}:${height},eq=brightness=-0.14:saturation=0.7[${label}bg]`,
    `[${label}fg0]scale=${foregroundWidth}:${foregroundHeight}:force_original_aspect_ratio=decrease[${label}fg]`,
    `[${label}bg][${label}fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p[${label}]`,
  ];
};

export const generateRecap = async (input: GenerateRecapInput) => {
  if (input.originalPaths.length !== 3) throw new Error('A recap requires exactly three original photos');
  const plan = createRecapPlan(input.markers);
  const width = input.width ?? 1080;
  const height = input.height ?? 1920;
  if (width < 160 || height < 240 || width % 2 || height % 2) throw new Error('Recap dimensions must be even');

  const filters = ['[0:v]split=3[raw0][raw1][raw2]'];
  for (const item of plan.items) {
    filters.push(
      ...portraitFilter(`[raw${item.index}]`, `clip${item.index}`, width, height, item.durationMs, item.startMs),
    );
    filters.push(...portraitFilter(`[${item.index + 1}:v]`, `photo${item.index}`, width, height, item.photoDurationMs));
  }
  filters.push(...portraitFilter('[4:v]', 'final', width, height, plan.finalDurationMs));
  filters.push('[clip0][photo0][clip1][photo1][clip2][photo2][final]concat=n=7:v=1:a=0[outv]');

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input.videoPath];
  for (const photo of input.originalPaths) args.push('-loop', '1', '-framerate', '30', '-i', photo);
  args.push('-loop', '1', '-framerate', '30', '-i', input.finalPath);
  args.push(
    '-filter_complex_threads',
    '2',
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[outv]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-threads',
    '2',
    '-movflags',
    '+faststart',
    '-metadata',
    `title=${input.title.slice(0, 120)}`,
    '-f',
    'mp4',
    input.outputPath,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      child.kill();
      finish(new Error('Recap generation was interrupted'));
    };
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000);
    });
    child.once('error', (error) => finish(new Error(`Could not start the recap encoder: ${error.message}`)));
    child.once('exit', (code) => {
      if (code === 0) finish();
      else finish(new Error(stderr.trim() || `Recap encoder exited with code ${code ?? 'unknown'}`));
    });
    if (child.pid) {
      try {
        setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // Encoding remains limited to two threads if process priority cannot be changed.
      }
    }
    if (input.signal?.aborted) abort();
    else input.signal?.addEventListener('abort', abort, { once: true });
  });
  return plan;
};

interface QueueJob {
  key: string;
  run(signal: AbortSignal): Promise<void>;
}

export class RecapQueue {
  private readonly pending: QueueJob[] = [];
  private readonly keys = new Set<string>();
  private active: AbortController | null = null;
  private draining = false;

  enqueue(key: string, run: QueueJob['run']) {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.pending.push({ key, run });
    void this.drain();
    return true;
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length) {
        const job = this.pending.shift()!;
        this.active = new AbortController();
        try {
          await job.run(this.active.signal);
        } catch {
          // Jobs own their persisted failure state; keep the queue moving.
        } finally {
          this.keys.delete(job.key);
          this.active = null;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  dispose() {
    this.pending.length = 0;
    this.keys.clear();
    this.active?.abort();
  }
}
