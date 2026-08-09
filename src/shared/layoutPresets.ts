import type { LayoutConfig, LayoutPresetId, LayoutTypefaceId } from './types';

export interface LayoutPresetSummary {
  id: LayoutPresetId;
  name: string;
  description: string;
  printSize: string;
  photoSize: string;
  railSize: string;
  width: number;
  height: number;
  railWidthPercent: number;
  defaults: {
    text: string;
    background: string;
    textColor: string;
    fontSize: number;
    quality: number;
    typeface: LayoutTypefaceId;
  };
}

export const LAYOUT_PRESETS: readonly LayoutPresetSummary[] = [
  {
    id: 'side-rail-three-stack',
    name: 'Editorial Side Rail',
    description: 'Three wide photographs with a vertical event-information rail.',
    printSize: '4 × 6 in',
    photoSize: '3 × 2 in each',
    railSize: '1 in',
    width: 1200,
    height: 1800,
    railWidthPercent: 25,
    defaults: {
      text: 'Congratulations',
      background: '#e8e2d8',
      textColor: '#1c1b1a',
      fontSize: 96,
      quality: 92,
      typeface: 'editorial-serif',
    },
  },
];

export const DEFAULT_LAYOUT_PRESET = LAYOUT_PRESETS[0];

export const getLayoutPreset = (id: LayoutPresetId) =>
  LAYOUT_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_LAYOUT_PRESET;

export const applyLayoutPreset = (current: LayoutConfig, id: LayoutPresetId): LayoutConfig => {
  const preset = getLayoutPreset(id);
  return {
    ...current,
    preset: preset.id,
    width: preset.width,
    height: preset.height,
    ...preset.defaults,
    railImageAssetId: '',
    railImageName: '',
  };
};
