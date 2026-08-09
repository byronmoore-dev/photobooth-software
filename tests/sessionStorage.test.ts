import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
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
});
