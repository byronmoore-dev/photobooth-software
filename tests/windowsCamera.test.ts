import { describe, expect, it } from 'vitest';
import { chooseRecorderMimeType } from '../src/renderer/video/windowsCamera';

describe('Windows camera recording', () => {
  it('prefers VP9 and falls back to a plain WebM recorder', () => {
    expect(chooseRecorderMimeType((type) => type.includes('vp9'))).toBe('video/webm;codecs=vp9');
    expect(chooseRecorderMimeType((type) => type === 'video/webm')).toBe('video/webm');
  });

  it('rejects environments without a compatible WebM encoder', () => {
    expect(chooseRecorderMimeType(() => false)).toBe('');
  });
});
