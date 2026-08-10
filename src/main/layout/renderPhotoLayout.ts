import sharp from 'sharp';
import type { LayoutConfig } from '../../shared/types';
import { getLayoutPreset } from '../../shared/layoutPresets';

interface LayoutRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LayoutGeometry {
  rail: LayoutRegion;
  photos: LayoutRegion[];
}

export function getLayoutGeometry(config: LayoutConfig): LayoutGeometry {
  switch (config.preset) {
    case 'side-rail-one-landscape': {
      const railWidth = Math.round(config.width / 6);
      return {
        rail: { left: 0, top: 0, width: railWidth, height: config.height },
        photos: [{ left: railWidth, top: 0, width: config.width - railWidth, height: config.height }],
      };
    }
    case 'center-rail-two-stack': {
      const railHeight = Math.round(config.height / 6);
      const photoHeight = Math.floor((config.height - railHeight) / 2);
      return {
        rail: { left: 0, top: photoHeight, width: config.width, height: railHeight },
        photos: [
          { left: 0, top: 0, width: config.width, height: photoHeight },
          { left: 0, top: photoHeight + railHeight, width: config.width, height: photoHeight },
        ],
      };
    }
    case 'side-rail-three-stack': {
      const railWidth = Math.round(config.width / 4);
      const photoHeight = Math.floor(config.height / 3);
      return {
        rail: { left: 0, top: 0, width: railWidth, height: config.height },
        photos: [0, 1, 2].map((index) => ({
          left: railWidth,
          top: index * photoHeight,
          width: config.width - railWidth,
          height: photoHeight,
        })),
      };
    }
  }
}

export async function renderPhotoLayout(input: {
  photos: string[];
  outputPath: string;
  config: LayoutConfig;
  railImagePath?: string;
}) {
  const preset = getLayoutPreset(input.config.preset);
  if (input.photos.length !== preset.photoCount) {
    throw new Error(`${preset.photoCount} photo${preset.photoCount === 1 ? '' : 's'} required for ${preset.name}`);
  }

  const geometry = getLayoutGeometry(input.config);
  const composites: sharp.OverlayOptions[] = [];
  for (const [index, region] of geometry.photos.entries()) {
    const image = await sharp(input.photos[index])
      .rotate()
      .resize(region.width, region.height, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: input.config.quality, chromaSubsampling: '4:4:4' })
      .toBuffer();
    composites.push({ input: image, left: region.left, top: region.top });
  }

  if (input.railImagePath) {
    const artwork = await sharp(input.railImagePath)
      .rotate()
      .resize(geometry.rail.width, geometry.rail.height, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
    composites.push({ input: artwork, left: geometry.rail.left, top: geometry.rail.top });
  }

  await sharp({
    create: {
      width: input.config.width,
      height: input.config.height,
      channels: 3,
      background: input.config.background,
    },
  })
    .composite(composites)
    .jpeg({ quality: input.config.quality, chromaSubsampling: '4:4:4' })
    .toFile(input.outputPath);
  return input.outputPath;
}
