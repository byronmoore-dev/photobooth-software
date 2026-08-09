import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import { getLayoutGeometry, renderPhotoLayout } from '../src/main/layout/renderPhotoLayout';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

describe('photo layout renderer', () => {
  it('defines a 1 inch rail and three exact 3 by 2 inch photo regions at 300 DPI', () => {
    expect(getLayoutGeometry(createDefaultConfig('').layout)).toEqual({
      railWidth: 300,
      photoWidth: 900,
      photoHeight: 600,
    });
  });

  it('requires exactly three photographs', async () => {
    await expect(
      renderPhotoLayout({ photos: [], outputPath: 'unused.jpg', config: createDefaultConfig('').layout }),
    ).rejects.toThrow(/Three photos/);
  });

  it('creates the configured 4 by 6 JPEG with three vertically distinct photo regions', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'camera-booth-render-'));
    folders.push(folder);
    const photos = await Promise.all(
      ['#e53935', '#43a047', '#1e88e5'].map(async (background, index) => {
        const file = path.join(folder, `${index}.jpg`);
        await sharp({ create: { width: 900, height: 600, channels: 3, background } })
          .jpeg()
          .toFile(file);
        return file;
      }),
    );
    const outputPath = path.join(folder, 'layout.jpg');
    const config = createDefaultConfig('').layout;
    await renderPhotoLayout({ photos, outputPath, config });
    const metadata = await sharp(outputPath).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 1200, height: 1800 });

    const { data, info } = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [...data.subarray(offset, offset + 3)];
    };
    expect(pixel(1050, 300)[0]).toBeGreaterThan(180);
    expect(pixel(1050, 900)[1]).toBeGreaterThan(100);
    expect(pixel(1050, 1500)[2]).toBeGreaterThan(160);
  });

  it('scales managed PNG artwork across the full information rail', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'camera-booth-rail-'));
    folders.push(folder);
    const photos = await Promise.all(
      [0, 1, 2].map(async (index) => {
        const file = path.join(folder, `${index}.jpg`);
        await sharp({ create: { width: 900, height: 600, channels: 3, background: '#eeeeee' } })
          .jpeg()
          .toFile(file);
        return file;
      }),
    );
    const railImagePath = path.join(folder, 'flowers.png');
    await sharp({ create: { width: 300, height: 1800, channels: 4, background: '#be185d' } })
      .png()
      .toFile(railImagePath);
    const outputPath = path.join(folder, 'with-rail.jpg');
    await renderPhotoLayout({
      photos,
      outputPath,
      config: createDefaultConfig('').layout,
      railImagePath,
    });

    const pixel = await sharp(outputPath).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer();
    expect(pixel[0]).toBeGreaterThan(150);
    expect(pixel[2]).toBeGreaterThan(60);
  });
});
