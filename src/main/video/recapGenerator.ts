import { spawn } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import type { SessionMetadata } from '../../shared/types';

const REALTIME_BEFORE_SHUTTER_MS = 1_000;
const REALTIME_AFTER_SHUTTER_MS = 250;
const PHOTO_REVEAL_MS = 550;
const FINAL_REVEAL_MS = 1_200;
const TARGET_DURATION_MS = 13_500;

export const CURRENT_RECAP_VERSION = 2;

export interface RecapVideoSegment {
  kind: 'video';
  startMs: number;
  durationMs: number;
  speed: number;
  phase: 'accelerated' | 'shutter';
  shotIndex?: number;
}

interface RecapPhotoSegment {
  kind: 'photo';
  index: number;
  durationMs: number;
}

export interface RecapPlan {
  segments: Array<RecapVideoSegment | RecapPhotoSegment>;
  videoDurationMs: number;
  acceleratedSpeed: number;
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
  videoDurationMs: number;
  title: string;
  signal?: AbortSignal;
  width?: number;
  height?: number;
}

export const createRecapPlan = (markers: SessionMetadata['videoMarkers'], inputVideoDurationMs: number): RecapPlan => {
  const ordered = [...markers].sort((left, right) => left.index - right.index);
  if (ordered.length < 1 || ordered.length > 3 || ordered.some((marker, index) => marker.index !== index)) {
    throw new Error('A recap requires one sequential shutter timestamp for every photo');
  }
  const videoDurationMs = Math.max(1, Math.round(inputVideoDurationMs));
  if (!Number.isFinite(inputVideoDurationMs) || ordered.at(-1)!.offsetMs > videoDurationMs) {
    throw new Error('The raw video duration does not contain every shutter timestamp');
  }

  const segments: Array<RecapVideoSegment | RecapPhotoSegment> = [];
  let cursorMs = 0;
  for (const marker of ordered) {
    const shutterStartMs = Math.max(cursorMs, marker.offsetMs - REALTIME_BEFORE_SHUTTER_MS);
    if (shutterStartMs > cursorMs) {
      segments.push({
        kind: 'video',
        startMs: cursorMs,
        durationMs: shutterStartMs - cursorMs,
        speed: 1,
        phase: 'accelerated',
      });
    }
    const shutterEndMs = Math.min(
      videoDurationMs,
      Math.max(shutterStartMs, marker.offsetMs + REALTIME_AFTER_SHUTTER_MS),
    );
    if (shutterEndMs > shutterStartMs) {
      segments.push({
        kind: 'video',
        startMs: shutterStartMs,
        durationMs: shutterEndMs - shutterStartMs,
        speed: 1,
        phase: 'shutter',
        shotIndex: marker.index,
      });
    }
    segments.push({ kind: 'photo', index: marker.index, durationMs: PHOTO_REVEAL_MS });
    cursorMs = shutterEndMs;
  }
  if (cursorMs < videoDurationMs) {
    segments.push({
      kind: 'video',
      startMs: cursorMs,
      durationMs: videoDurationMs - cursorMs,
      speed: 1,
      phase: 'accelerated',
    });
  }

  const acceleratedInputMs = segments.reduce(
    (total, segment) => total + (segment.kind === 'video' && segment.phase === 'accelerated' ? segment.durationMs : 0),
    0,
  );
  const fixedOutputMs = segments.reduce(
    (total, segment) => total + (segment.kind === 'photo' || segment.phase === 'shutter' ? segment.durationMs : 0),
    FINAL_REVEAL_MS,
  );
  const acceleratedBudgetMs = Math.max(1, TARGET_DURATION_MS - fixedOutputMs);
  const acceleratedSpeed = acceleratedInputMs > 0 ? Math.max(1, acceleratedInputMs / acceleratedBudgetMs) : 1;
  for (const segment of segments) {
    if (segment.kind === 'video' && segment.phase === 'accelerated') segment.speed = acceleratedSpeed;
  }
  const durationMs = Math.round(
    segments.reduce(
      (total, segment) => total + (segment.kind === 'video' ? segment.durationMs / segment.speed : segment.durationMs),
      FINAL_REVEAL_MS,
    ),
  );
  return {
    segments,
    videoDurationMs,
    acceleratedSpeed,
    finalDurationMs: FINAL_REVEAL_MS,
    durationMs,
  };
};

const portraitFilter = (
  source: string,
  label: string,
  width: number,
  height: number,
  durationMs: number,
  trimStartMs?: number,
  speed = 1,
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
    `${source}${trim},setpts=(PTS-STARTPTS)/${speed.toFixed(6)},split=2[${label}bg0][${label}fg0]`,
    `[${label}bg0]scale=${backgroundWidth}:${backgroundHeight}:force_original_aspect_ratio=increase,crop=${backgroundWidth}:${backgroundHeight},gblur=sigma=18,scale=${width}:${height},eq=brightness=-0.14:saturation=0.7[${label}bg]`,
    `[${label}fg0]scale=${foregroundWidth}:${foregroundHeight}:force_original_aspect_ratio=decrease[${label}fg]`,
    `[${label}bg][${label}fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p[${label}]`,
  ];
};

export const generateRecap = async (input: GenerateRecapInput) => {
  if (input.originalPaths.length !== input.markers.length || input.originalPaths.length < 1) {
    throw new Error('A recap requires one original for every shutter timestamp');
  }
  const plan = createRecapPlan(input.markers, input.videoDurationMs);
  const width = input.width ?? 1080;
  const height = input.height ?? 1920;
  if (width < 160 || height < 240 || width % 2 || height % 2) throw new Error('Recap dimensions must be even');

  const videoSegments = plan.segments.filter((segment): segment is RecapVideoSegment => segment.kind === 'video');
  const rawLabels = videoSegments.map((_, index) => `[raw${index}]`).join('');
  const filters = videoSegments.length === 1 ? ['[0:v]null[raw0]'] : [`[0:v]split=${videoSegments.length}${rawLabels}`];
  for (const [index, segment] of videoSegments.entries()) {
    filters.push(
      ...portraitFilter(
        `[raw${index}]`,
        `video${index}`,
        width,
        height,
        segment.durationMs,
        segment.startMs,
        segment.speed,
      ),
    );
  }
  for (let index = 0; index < input.originalPaths.length; index++) {
    filters.push(...portraitFilter(`[${index + 1}:v]`, `photo${index}`, width, height, PHOTO_REVEAL_MS));
  }
  filters.push(
    ...portraitFilter(`[${input.originalPaths.length + 1}:v]`, 'final', width, height, plan.finalDurationMs),
  );
  let videoIndex = 0;
  const timelineLabels = plan.segments
    .map((segment) => (segment.kind === 'video' ? `[video${videoIndex++}]` : `[photo${segment.index}]`))
    .join('');
  filters.push(`${timelineLabels}[final]concat=n=${plan.segments.length + 1}:v=1:a=0[outv]`);

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
