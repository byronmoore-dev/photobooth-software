import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecapPlan, generateRecap } from '../src/main/video/recapGenerator';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const runFfmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg fixture is unavailable'));
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (chunk) => (error += String(chunk)));
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(error))));
  });

describe('session recap generator', () => {
  it('builds a deterministic three-shot timeline and clamps its first segment', () => {
    const plan = createRecapPlan([
      { index: 2, capturedAt: '2026-08-10T00:00:02Z', offsetMs: 2600 },
      { index: 0, capturedAt: '2026-08-10T00:00:00Z', offsetMs: 500 },
      { index: 1, capturedAt: '2026-08-10T00:00:01Z', offsetMs: 1500 },
    ]);

    expect(plan.items.map((item) => item.startMs)).toEqual([0, 350, 1450]);
    expect(plan.durationMs).toBe(8900);
  });

  it('renders a playable portrait H.264 recap from video, originals, and final print', async () => {
    if (!ffmpegPath) throw new Error('FFmpeg fixture is unavailable');
    const folder = await mkdtemp(path.join(tmpdir(), 'camera-booth-recap-'));
    folders.push(folder);
    const video = path.join(folder, 'raw.mp4');
    const output = path.join(folder, 'recap.partial.mp4');
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=20',
      '-t',
      '4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-y',
      video,
    ]);
    const originals = await Promise.all(
      ['#b8a58a', '#8f7765', '#cab9a5'].map(async (background, index) => {
        const file = path.join(folder, `original-${index + 1}.jpg`);
        await sharp({ create: { width: 320, height: 180, channels: 3, background } })
          .jpeg()
          .toFile(file);
        return file;
      }),
    );
    const finalPath = path.join(folder, 'final.jpg');
    await sharp({ create: { width: 200, height: 300, channels: 3, background: '#f1ece4' } })
      .jpeg()
      .toFile(finalPath);

    const plan = await generateRecap({
      ffmpegPath,
      videoPath: video,
      originalPaths: originals,
      finalPath,
      outputPath: output,
      markers: [
        { index: 0, capturedAt: '2026-08-10T00:00:00Z', offsetMs: 600 },
        { index: 1, capturedAt: '2026-08-10T00:00:01Z', offsetMs: 1700 },
        { index: 2, capturedAt: '2026-08-10T00:00:02Z', offsetMs: 2800 },
      ],
      title: 'Test Event',
      width: 180,
      height: 320,
    });

    const header = await readFile(output);
    expect(header.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect((await stat(output)).size).toBeGreaterThan(1_000);
    expect(plan.durationMs).toBe(8900);
  }, 30_000);
});
