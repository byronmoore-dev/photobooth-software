import sharp from 'sharp';
import type { LayoutConfig } from '../../shared/types';
import { getLayoutPreset } from '../../shared/layoutPresets';

export interface LayoutGeometry {
  railWidth: number;
  photoWidth: number;
  photoHeight: number;
}

const escapeXml = (value: string) =>
  value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;',
    };
    return entities[character];
  });

export function getLayoutGeometry(config: LayoutConfig): LayoutGeometry {
  const preset = getLayoutPreset(config.preset);
  const railWidth = Math.round(config.width * (preset.railWidthPercent / 100));
  return {
    railWidth,
    photoWidth: config.width - railWidth,
    photoHeight: Math.floor(config.height / 3),
  };
}

const fitVerticalFontSize = (text: string, requested: number, availableLength: number) => {
  if (!text) return requested;
  return Math.max(36, Math.min(requested, Math.floor(availableLength / (text.length * 0.62))));
};

async function renderSideRailThreeStack(
  photos: string[],
  outputPath: string,
  config: LayoutConfig,
  railImagePath?: string,
) {
  const geometry = getLayoutGeometry(config);
  const composites: sharp.OverlayOptions[] = [];

  for (let index = 0; index < 3; index++) {
    const image = await sharp(photos[index])
      .rotate()
      .resize(geometry.photoWidth, geometry.photoHeight, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: config.quality, chromaSubsampling: '4:4:4' })
      .toBuffer();
    composites.push({ input: image, left: geometry.railWidth, top: index * geometry.photoHeight });
  }

  const mainSize = fitVerticalFontSize(config.text, config.fontSize, config.height - 300);
  const detailSize = fitVerticalFontSize(config.detail, Math.max(30, Math.round(mainSize * 0.32)), config.height - 360);
  if (railImagePath) {
    const artwork = await sharp(railImagePath)
      .rotate()
      .resize(geometry.railWidth, config.height, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
    composites.push({ input: artwork, left: 0, top: 0 });
  }

  const fontFamily = config.typeface === 'editorial-serif' ? 'Georgia, serif' : 'Segoe UI, sans-serif';
  const rail = Buffer.from(`
    <svg width="${geometry.railWidth}" height="${config.height}" xmlns="http://www.w3.org/2000/svg">
      ${
        railImagePath
          ? ''
          : `<rect width="100%" height="100%" fill="${config.background}"/>
      <circle cx="${Math.round(geometry.railWidth / 2)}" cy="105" r="18" fill="none" stroke="${config.textColor}" stroke-width="5"/>
      <line x1="${Math.round(geometry.railWidth / 2)}" y1="150" x2="${Math.round(geometry.railWidth / 2)}" y2="270" stroke="${config.textColor}" stroke-width="3" opacity="0.45"/>`
      }
      <g transform="translate(${Math.round(geometry.railWidth * 0.43)} ${Math.round(config.height / 2)}) rotate(-90)">
        <text x="0" y="0" text-anchor="middle" dominant-baseline="middle" fill="${config.textColor}" font-family="${fontFamily}" font-weight="600" font-size="${mainSize}" letter-spacing="-2">${escapeXml(config.text)}</text>
      </g>
      ${
        config.detail
          ? `<g transform="translate(${Math.round(geometry.railWidth * 0.76)} ${Math.round(config.height / 2)}) rotate(-90)">
        <text x="0" y="0" text-anchor="middle" dominant-baseline="middle" fill="${config.textColor}" opacity="0.78" font-family="${fontFamily}" font-weight="500" font-size="${detailSize}" letter-spacing="3">${escapeXml(config.detail)}</text>
      </g>`
          : ''
      }
    </svg>
  `);
  composites.push({ input: rail, left: 0, top: 0 });

  await sharp({
    create: { width: config.width, height: config.height, channels: 3, background: config.background },
  })
    .composite(composites)
    .jpeg({ quality: config.quality, chromaSubsampling: '4:4:4' })
    .toFile(outputPath);
}

const renderers: Record<LayoutConfig['preset'], typeof renderSideRailThreeStack> = {
  'side-rail-three-stack': renderSideRailThreeStack,
};

export async function renderPhotoLayout(input: {
  photos: string[];
  outputPath: string;
  config: LayoutConfig;
  railImagePath?: string;
}) {
  if (input.photos.length !== 3) throw new Error('Three photos are required');
  await renderers[input.config.preset](input.photos, input.outputPath, input.config, input.railImagePath);
  return input.outputPath;
}
