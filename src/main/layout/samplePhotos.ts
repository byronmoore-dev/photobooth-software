import path from 'node:path';

export const BUNDLED_SAMPLE_PHOTO_NAMES = ['booth-sample-1.jpg', 'booth-sample-2.jpg', 'booth-sample-3.jpg'] as const;

export function bundledSamplePhotoPaths(input: { packaged: boolean; appPath: string; resourcesPath: string }) {
  const root = input.packaged
    ? path.join(input.resourcesPath, 'sample-photos')
    : path.join(input.appPath, 'assets', 'sample-photos');
  return BUNDLED_SAMPLE_PHOTO_NAMES.map((name) => path.join(root, name));
}
