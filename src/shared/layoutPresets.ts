import type { LayoutConfig, LayoutPresetId, PhotoCount, RailArtworkCache } from './types';

export interface LayoutPresetSummary {
  id: LayoutPresetId;
  name: string;
  description: string;
  printSize: string;
  photoSize: string;
  railSize: string;
  artworkSize: string;
  width: number;
  height: number;
  photoCount: PhotoCount;
  orientation: 'portrait' | 'landscape';
  defaults: {
    background: string;
    quality: number;
  };
}

export const LAYOUT_PRESETS: readonly LayoutPresetSummary[] = [
  {
    id: 'side-rail-one-landscape',
    name: 'Landscape Feature',
    description: 'One hero photograph beside a vertical artwork rail.',
    printSize: '6 × 4 in',
    photoSize: '5 × 4 in',
    railSize: '1 × 4 in',
    artworkSize: '300 × 1200 px',
    width: 1800,
    height: 1200,
    photoCount: 1,
    orientation: 'landscape',
    defaults: {
      background: '#e8e2d8',
      quality: 92,
    },
  },
  {
    id: 'center-rail-two-stack',
    name: 'Center Rail Pair',
    description: 'Two photographs separated by a horizontal artwork rail.',
    printSize: '4 × 6 in',
    photoSize: '4 × 2.5 in each',
    railSize: '4 × 1 in',
    artworkSize: '1200 × 300 px',
    width: 1200,
    height: 1800,
    photoCount: 2,
    orientation: 'portrait',
    defaults: {
      background: '#e8e2d8',
      quality: 92,
    },
  },
  {
    id: 'side-rail-three-stack',
    name: 'Side Rail Trio',
    description: 'Three photographs stacked beside a vertical artwork rail.',
    printSize: '4 × 6 in',
    photoSize: '3 × 2 in each',
    railSize: '1 × 6 in',
    artworkSize: '300 × 1800 px',
    width: 1200,
    height: 1800,
    photoCount: 3,
    orientation: 'portrait',
    defaults: {
      background: '#e8e2d8',
      quality: 92,
    },
  },
];

export const DEFAULT_LAYOUT_PRESET = LAYOUT_PRESETS[2];

export const getLayoutPreset = (id: LayoutPresetId) =>
  LAYOUT_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_LAYOUT_PRESET;

export const applyLayoutPreset = (
  current: LayoutConfig,
  id: LayoutPresetId,
  artworkCache?: RailArtworkCache,
): LayoutConfig => {
  const preset = getLayoutPreset(id);
  const rememberedArtwork =
    artworkCache?.[preset.id] ??
    (current.preset === preset.id && current.railImageAssetId
      ? { assetId: current.railImageAssetId, name: current.railImageName }
      : undefined);
  return {
    ...current,
    preset: preset.id,
    width: preset.width,
    height: preset.height,
    ...preset.defaults,
    railImageAssetId: rememberedArtwork?.assetId ?? '',
    railImageName: rememberedArtwork?.name ?? '',
  };
};
