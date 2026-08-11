import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import { applyLayoutPreset } from '../src/shared/layoutPresets';
import { SessionStorage } from '../src/main/storage/sessionStorage';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'camera-booth-session-'));
  folders.push(root);
  const config = { ...createDefaultConfig(root), id: 'test-event' };
  const storage = new SessionStorage({ eventFolder: () => path.join(root, config.id) });
  return { root, config, storage };
}

const writeJpeg = (file: string) =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: '#a89b88' } })
    .jpeg()
    .toFile(file);
const validateJpeg = async (file: string) => {
  const metadata = await sharp(file).metadata();
  if (metadata.format !== 'jpeg') throw new Error('invalid');
};

describe('session storage and recovery', () => {
  it('snapshots the selected layout and its capture count into each session', async () => {
    const { config, storage } = await fixture();
    config.layout = applyLayoutPreset(config.layout, 'center-rail-two-stack');
    await expect(storage.create(config)).resolves.toMatchObject({
      photoCount: 2,
      layout: { preset: 'center-rail-two-stack', width: 1200, height: 1800 },
    });
  });

  it('serializes concurrent metadata changes without losing either update', async () => {
    const { config, storage } = await fixture();
    const created = await storage.create(config);
    await Promise.all([
      storage.update(config, created.id, (current) => {
        current.printStatus = 'submitted';
      }),
      storage.update(config, created.id, (current) => {
        current.uploadStatus = 'complete';
      }),
    ]);
    await expect(storage.get(config, created.id)).resolves.toMatchObject({
      printStatus: 'submitted',
      uploadStatus: 'complete',
    });
  });

  it('rebuilds a missing final image when all originals survived', async () => {
    const { config, storage } = await fixture();
    let session = await storage.create(config);
    for (let index = 0; index < 3; index++) {
      const file = storage.originalPath(config, session.id, index);
      await writeJpeg(file);
      session.originalPaths.push(file);
    }
    session.status = 'processing';
    await storage.save(config, session);
    const summary = await storage.recover(config, validateJpeg, async (metadata) => {
      const output = storage.finalPath(config, metadata.id);
      await writeJpeg(output);
      return output;
    });
    expect(summary.recovered).toBe(1);
    const recovered = await storage.get(config, session.id);
    expect(recovered.status).toBe('ready');
    await expect(access(recovered.finalPath!)).resolves.toBeUndefined();
  });

  it('recovers a complete one-photo landscape session without waiting for extra originals', async () => {
    const { config, storage } = await fixture();
    config.layout = applyLayoutPreset(config.layout, 'side-rail-one-landscape');
    const session = await storage.create(config);
    const original = storage.originalPath(config, session.id, 0);
    await writeJpeg(original);
    session.originalPaths = [original];
    session.status = 'processing';
    await storage.save(config, session);

    const summary = await storage.recover(config, validateJpeg, async (metadata) => {
      expect(metadata.photoCount).toBe(1);
      const output = storage.finalPath(config, metadata.id);
      await writeJpeg(output);
      return output;
    });

    expect(summary.recovered).toBe(1);
    await expect(storage.get(config, session.id)).resolves.toMatchObject({ status: 'ready', photoCount: 1 });
  });

  it('marks a partial capture interrupted while preserving its original', async () => {
    const { config, storage } = await fixture();
    const session = await storage.create(config);
    const original = storage.originalPath(config, session.id, 0);
    await writeJpeg(original);
    session.originalPaths = [original];
    session.status = 'original-1-saved';
    await storage.save(config, session);
    const summary = await storage.recover(config, validateJpeg, async () => {
      throw new Error('should not render');
    });
    expect(summary.interrupted).toBe(1);
    await expect(storage.get(config, session.id)).resolves.toMatchObject({
      status: 'interrupted',
      originalPaths: [original],
    });
  });

  it('rejects traversal-style session IDs', async () => {
    const { config, storage } = await fixture();
    await expect(storage.get(config, '..\\outside')).rejects.toThrow(/Invalid session ID/);
    await expect(writeFile(path.join(config.baseFolder, 'untouched'), 'ok')).resolves.toBeUndefined();
  });

  it('loads only the finished strip for a Sessions grid summary', async () => {
    const { config, storage } = await fixture();
    const session = await storage.create(config);
    const finalPath = storage.finalPath(config, session.id);
    await writeJpeg(finalPath);
    session.finalPath = finalPath;
    session.originalPaths = ['not-loaded-1.jpg', 'not-loaded-2.jpg', 'not-loaded-3.jpg'];
    const summary = await storage.summary(session);

    expect(summary.finalDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(summary).not.toHaveProperty('originalDataUrls');
  });

  it('enables session video only for opted-in production sessions', async () => {
    const { config, storage } = await fixture();
    config.capture.sessionVideoEnabled = true;

    await expect(storage.create(config)).resolves.toMatchObject({ videoEnabled: true, videoStatus: 'pending' });
    await expect(storage.create(config, true)).resolves.toMatchObject({ videoEnabled: false, videoStatus: 'disabled' });
  });

  it('snapshots the selected Windows recording feed into the session', async () => {
    const { config, storage } = await fixture();
    config.capture.sessionVideoEnabled = true;
    config.capture.sessionVideoSource = 'windows-camera';
    config.capture.windowsVideoDeviceName = 'Surface Rear Camera';

    await expect(storage.create(config)).resolves.toMatchObject({
      schemaVersion: 7,
      videoEnabled: true,
      videoSource: 'windows-camera',
      videoSourceName: 'Surface Rear Camera',
      videoStatus: 'pending',
    });
  });

  it('quarantines an interrupted partial video while preserving session metadata', async () => {
    const { config, storage } = await fixture();
    config.capture.sessionVideoEnabled = true;
    const session = await storage.create(config);
    session.videoStatus = 'recording';
    session.videoStartedAt = new Date().toISOString();
    await writeFile(storage.temporaryVideoPath(config, session.id), Buffer.alloc(128, 1));
    await storage.save(config, session);

    await storage.recover(config, validateJpeg, async () => {
      throw new Error('should not render');
    });

    const recovered = await storage.get(config, session.id);
    expect(recovered.videoStatus).toBe('interrupted');
    expect(recovered.errors).toEqual(expect.arrayContaining([expect.objectContaining({ step: 'video-recovery' })]));
    await expect(access(storage.interruptedVideoPath(config, session.id))).resolves.toBeUndefined();
    await expect(access(storage.temporaryVideoPath(config, session.id))).rejects.toThrow();
  });

  it('quarantines an interrupted Windows camera recording', async () => {
    const { config, storage } = await fixture();
    config.capture.sessionVideoEnabled = true;
    config.capture.sessionVideoSource = 'windows-camera';
    const session = await storage.create(config);
    session.videoStatus = 'recording';
    session.videoStartedAt = new Date().toISOString();
    await writeFile(storage.temporaryExternalVideoPath(config, session.id), Buffer.alloc(128, 1));
    await storage.save(config, session);

    await storage.recover(config, validateJpeg, async () => {
      throw new Error('should not render');
    });

    await expect(storage.get(config, session.id)).resolves.toMatchObject({ videoStatus: 'interrupted' });
    await expect(access(storage.interruptedExternalVideoPath(config, session.id))).resolves.toBeUndefined();
    await expect(access(storage.temporaryExternalVideoPath(config, session.id))).rejects.toThrow();
  });

  it('exposes a stream URL only for an existing ready video', async () => {
    const { config, storage } = await fixture();
    const session = await storage.create(config);
    session.videoEnabled = true;
    session.videoStatus = 'ready';
    session.videoPath = storage.videoPath(config, session.id);
    await writeFile(session.videoPath, Buffer.alloc(128, 2));

    const summary = await storage.summary(session);
    expect(summary.videoUrl).toBe(`camera-booth-video://session/${session.id}?asset=raw`);
  });

  it('marks an interrupted recap for background regeneration', async () => {
    const { config, storage } = await fixture();
    const session = await storage.create(config);
    session.recapStatus = 'processing';
    await writeFile(storage.temporaryRecapPath(config, session.id), Buffer.alloc(128, 3));
    await storage.save(config, session);

    await storage.recover(config, validateJpeg, async () => {
      throw new Error('should not render');
    });

    await expect(storage.get(config, session.id)).resolves.toMatchObject({ recapStatus: 'interrupted' });
    await expect(access(storage.temporaryRecapPath(config, session.id))).rejects.toThrow();
  });

  it('uses self-describing shutter offsets in generated media names', async () => {
    const { config, storage } = await fixture();
    const session = await storage.create(config);
    const markers = [
      { index: 0, capturedAt: session.createdAt, offsetMs: 8421 },
      { index: 1, capturedAt: session.createdAt, offsetMs: 19734 },
      { index: 2, capturedAt: session.createdAt, offsetMs: 31062 },
    ];

    expect(path.basename(storage.videoPath(config, session.id, markers))).toBe(
      'session-video__shots-008421ms-019734ms-031062ms.mp4',
    );
    expect(path.basename(storage.recapPath(config, session.id, markers))).toBe(
      'session-recap__shots-008421ms-019734ms-031062ms.mp4',
    );
    expect(path.basename(storage.videoPath(config, session.id, markers.slice(0, 1)))).toBe(
      'session-video__shots-008421ms.mp4',
    );
  });
});
