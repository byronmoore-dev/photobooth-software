import { describe, expect, it } from 'vitest';
import { captureErrorMessage, isRecoverableFlashError } from '../src/renderer/app/captureErrors';

describe('capture error classification', () => {
  it('recognizes Canon flash misses as recoverable', () => {
    expect(
      isRecoverableFlashError(
        new Error('The Canon flash did not fire. Raise the T6i built-in flash and wait for it to charge.'),
      ),
    ).toBe(true);
    expect(
      isRecoverableFlashError(
        new Error('The Canon photo did not include flash confirmation. Check that the built-in flash is raised.'),
      ),
    ).toBe(true);
    expect(
      isRecoverableFlashError(
        new Error(
          "Error invoking remote method 'camera:capture': Error: The Canon flash did not fire. Wait for it to charge.",
        ),
      ),
    ).toBe(true);
  });

  it('leaves camera and transfer failures on the fatal error path', () => {
    expect(isRecoverableFlashError(new Error('Camera disconnected during capture'))).toBe(false);
    expect(isRecoverableFlashError(new Error('Timed out waiting for the camera'))).toBe(false);
  });

  it('normalizes non-Error rejection values for display', () => {
    expect(captureErrorMessage('Flash unavailable')).toBe('Flash unavailable');
  });
});
