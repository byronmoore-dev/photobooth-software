import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import { applyLayoutPreset } from '../src/shared/layoutPresets';
import type { LayoutPresetId } from '../src/shared/types';
import { getLayoutGeometry, renderPhotoLayout } from '../src/main/layout/renderPhotoLayout';

const folders: string[] = [];
afterEach(async () => Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))));

const layoutFor = (preset: LayoutPresetId) => applyLayoutPreset(createDefaultConfig('').layout, preset);

const createPhotos = async (folder: string, colors: string[]) =>
  Promise.all(
    colors.map(async (background, index) => {
      const file = path.join(folder, `${index}.jpg`);
      await sharp({ create: { width: 1500, height: 1000, channels: 3, background } })
        .jpeg()
        .toFile(file);
      return file;
    }),
  );

const pixelReader = async (file: string) => {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels;
    return [...data.subarray(offset, offset + 3)];
  };
};

describe('photo layout renderer', () => {
  it('defines exact 300 DPI regions for all three layouts', () => {
    expect(getLayoutGeometry(layoutFor('side-rail-one-landscape'))).toEqual({
      rail: { left: 0, top: 0, width: 300, height: 1200 },
      photos: [{ left: 300, top: 0, width: 1500, height: 1200 }],
    });
    expect(getLayoutGeometry(layoutFor('center-rail-two-stack'))).toEqual({
      rail: { left: 0, top: 750, width: 1200, height: 300 },
      photos: [
        { left: 0, top: 0, width: 1200, height: 750 },
        { left: 0, top: 1050, width: 1200, height: 750 },
      ],
    });
    expect(getLayoutGeometry(layoutFor('side-rail-three-stack'))).toEqual({
      rail: { left: 0, top: 0, width: 300, height: 1800 },
      photos: [
        { left: 300, top: 0, width: 900, height: 600 },
        { left: 300, top: 600, width: 900, height: 600 },
        { left: 300, top: 1200, width: 900, height: 600 },
      ],
    });
  });

  it('requires the photo count selected by the layout', async () => {
    await expect(
      renderPhotoLayout({ photos: [], outputPath: 'unused.jpg', config: layoutFor('side-rail-one-landscape') }),
    ).rejects.toThrow(/1 photo required/);
    await expect(
      renderPhotoLayout({ photos: [], outputPath: 'unused.jpg', config: layoutFor('center-rail-two-stack') }),
    ).rejects.toThrow(/2 photos required/);
    await expect(
      renderPhotoLayout({ photos: [], outputPath: 'unused.jpg', config: layoutFor('side-rail-three-stack') }),
    ).rejects.toThrow(/3 photos required/);
  });

  it.each([
    ['side-rail-one-landscape' as const, ['#e53935'], 1800, 1200],
    ['center-rail-two-stack' as const, ['#e53935', '#43a047'], 1200, 1800],
    ['side-rail-three-stack' as const, ['#e53935', '#43a047', '#1e88e5'], 1200, 1800],
  ])('renders %s at its production dimensions', async (preset, colors, width, height) => {
    const folder = await mkdtemp(path.join(tmpdir(), 'camera-booth-render-'));
    folders.push(folder);
    const photos = await createPhotos(folder, colors);
    const outputPath = path.join(folder, 'layout.jpg');
    await renderPhotoLayout({ photos, outputPath, config: layoutFor(preset) });
    await expect(sharp(outputPath).metadata()).resolves.toMatchObject({ format: 'jpeg', width, height });
  });

  it('places both photos around the center artwork rail', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'camera-booth-center-rail-'));
    folders.push(folder);
    const photos = await createPhotos(folder, ['#e53935', '#43a047']);
    const railImagePath = path.join(folder, 'rail.png');
    await sharp({ create: { width: 1200, height: 300, channels: 4, background: '#1e88e5' } })
      .png()
      .toFile(railImagePath);
    const outputPath = path.join(folder, 'layout.jpg');
    await renderPhotoLayout({
      photos,
      outputPath,
      config: layoutFor('center-rail-two-stack'),
      railImagePath,
    });
    const pixel = await pixelReader(outputPath);
    expect(pixel(600, 300)[0]).toBeGreaterThan(180);
    expect(pixel(600, 900)[2]).toBeGreaterThan(160);
    expect(pixel(600, 1500)[1]).toBeGreaterThan(100);
  });
});
