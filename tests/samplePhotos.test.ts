import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BUNDLED_SAMPLE_PHOTO_NAMES, bundledSamplePhotoPaths } from '../src/main/layout/samplePhotos';

describe('bundled layout preview photos', () => {
  it('resolves repository assets in development and extra resources when packaged', () => {
    expect(
      bundledSamplePhotoPaths({ packaged: false, appPath: 'C:\\Camera Booth', resourcesPath: 'C:\\resources' }),
    ).toEqual(BUNDLED_SAMPLE_PHOTO_NAMES.map((name) => path.join('C:\\Camera Booth', 'assets', 'sample-photos', name)));
    expect(
      bundledSamplePhotoPaths({ packaged: true, appPath: 'C:\\Camera Booth', resourcesPath: 'C:\\resources' }),
    ).toEqual(BUNDLED_SAMPLE_PHOTO_NAMES.map((name) => path.join('C:\\resources', 'sample-photos', name)));
  });

  it('contains three valid landscape JPEG assets', async () => {
    const photos = bundledSamplePhotoPaths({
      packaged: false,
      appPath: process.cwd(),
      resourcesPath: process.cwd(),
    });
    const metadata = await Promise.all(photos.map((photo) => sharp(photo).metadata()));

    expect(metadata).toHaveLength(3);
    for (const image of metadata) {
      expect(image.format).toBe('jpeg');
      expect(image.width).toBeGreaterThan(image.height ?? Number.POSITIVE_INFINITY);
      expect(image.width).toBeGreaterThanOrEqual(999);
    }
  });
});
