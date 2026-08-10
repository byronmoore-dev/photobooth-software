import { describe, expect, it } from 'vitest';
import { acceptsTouchKeyboard } from '../src/renderer/app/touchKeyboard';
import { showWindowsTouchKeyboard, windowsTouchKeyboardCandidates } from '../src/main/system/touchKeyboard';

describe('touch keyboard input targeting', () => {
  it('accepts editable text, numeric, and multiline fields', () => {
    expect(acceptsTouchKeyboard({ tagName: 'input', type: 'text' })).toBe(true);
    expect(acceptsTouchKeyboard({ tagName: 'input', type: 'number' })).toBe(true);
    expect(acceptsTouchKeyboard({ tagName: 'textarea' })).toBe(true);
    expect(acceptsTouchKeyboard({ tagName: 'div', contentEditable: true })).toBe(true);
  });

  it('ignores controls that have their own touch UI or cannot be edited', () => {
    expect(acceptsTouchKeyboard({ tagName: 'input', type: 'date' })).toBe(false);
    expect(acceptsTouchKeyboard({ tagName: 'input', type: 'checkbox' })).toBe(false);
    expect(acceptsTouchKeyboard({ tagName: 'input', readOnly: true })).toBe(false);
    expect(acceptsTouchKeyboard({ tagName: 'textarea', disabled: true })).toBe(false);
    expect(acceptsTouchKeyboard({ tagName: 'select' })).toBe(false);
  });
});

describe('Windows touch keyboard launcher', () => {
  it('does nothing outside Windows', async () => {
    const launched: string[] = [];
    await expect(
      showWindowsTouchKeyboard({
        platform: 'darwin',
        canAccess: async () => undefined,
        launch: (file) => launched.push(file),
      }),
    ).resolves.toBe(false);
    expect(launched).toEqual([]);
  });

  it('launches the first available native TabTip executable', async () => {
    const environment = { CommonProgramFiles: 'D:\\Windows Common' };
    const candidates = windowsTouchKeyboardCandidates(environment);
    const launched: string[] = [];
    const available = candidates[0];

    await expect(
      showWindowsTouchKeyboard({
        platform: 'win32',
        environment,
        canAccess: async (file) => {
          if (file !== available) throw new Error('missing');
        },
        launch: (file) => launched.push(file),
      }),
    ).resolves.toBe(true);
    expect(launched).toEqual([available]);
    expect(available).toMatch(/TabTip\.exe$/);
  });
});
