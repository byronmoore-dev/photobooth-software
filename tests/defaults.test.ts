import { describe, expect, it } from 'vitest';
import {
  clampCopies,
  createDefaultConfig,
  eventSetupIssues,
  isEventActive,
  isEventConfigured,
  isEventDraftComplete,
  localDateInputValue,
  normalizeEventConfig,
  normalizeLayoutConfig,
  normalizeSessionMetadata,
  requireEventId,
} from '../src/shared/defaults';
import { applyLayoutPreset } from '../src/shared/layoutPresets';

describe('event configuration', () => {
  it('starts without fabricated event details', () => {
    const defaults = createDefaultConfig('C:\\Events');
    expect(defaults.id).toBe('');
    expect(defaults.description).toBe('');
    expect(defaults.eventDate).toBe('');
    expect(defaults.railArtworkCache).toEqual({});
    expect(defaults.capture).toMatchObject({
      countdownSeconds: 8,
      previewMs: 2000,
      sessionVideoEnabled: false,
      sessionVideoSource: 'canon-live-view',
      windowsVideoDeviceId: '',
    });
    expect(defaults.capture).not.toHaveProperty('transitionMs');
    expect(defaults.layout).not.toHaveProperty('text');
    expect(defaults.layout).not.toHaveProperty('detail');
  });

  it('sanitizes IDs and clamps dependent copy settings', () => {
    const normalized = normalizeEventConfig(
      {
        ...createDefaultConfig('C:\\Events'),
        id: '  Summer Gala! 2026  ',
        printer: { defaultCopies: 18, maxCopies: 3 },
      },
      'C:\\Events',
    );
    expect(normalized.id).toBe('Summer-Gala-2026');
    expect(normalized.printer).toMatchObject({ defaultCopies: 3, maxCopies: 3 });
  });

  it('rejects a missing event ID', () => {
    expect(() => requireEventId(createDefaultConfig('C:\\Events'))).toThrow(/Event ID/);
  });

  it('normalizes every output to a true 4 by 6 aspect ratio', () => {
    const layout = normalizeLayoutConfig({ width: 1600, height: 9999, preset: 'unknown' });
    expect(layout).toMatchObject({ preset: 'side-rail-three-stack', width: 1200, height: 1800 });
    expect(normalizeLayoutConfig({ preset: 'side-rail-one-landscape' })).toMatchObject({
      preset: 'side-rail-one-landscape',
      width: 1800,
      height: 1200,
    });
    expect(normalizeLayoutConfig({ preset: 'center-rail-two-stack' })).toMatchObject({
      preset: 'center-rail-two-stack',
      width: 1200,
      height: 1800,
    });
  });

  it('migrates a legacy layout without retaining app-generated rail copy', () => {
    const migrated = normalizeEventConfig(
      {
        schemaVersion: 2,
        id: 'legacy-event',
        description: 'Byron & Alex · August 2026',
        layout: { width: 1200, height: 3600, text: 'Congratulations', background: '#f5f1e8' },
      },
      'C:\\Events',
    );
    expect(migrated.schemaVersion).toBe(10);
    expect(migrated.createdAt).toBe('');
    expect(migrated.eventDate).toBe('');
    expect(migrated.layout).toMatchObject({
      preset: 'side-rail-three-stack',
      width: 1200,
      height: 1800,
    });
    expect(migrated.layout).not.toHaveProperty('text');
    expect(migrated.layout).not.toHaveProperty('detail');
  });

  it('remembers one rail artwork per layout and backfills the active legacy artwork', () => {
    const firstAsset = '11111111-1111-4111-8111-111111111111';
    const secondAsset = '22222222-2222-4222-8222-222222222222';
    const normalized = normalizeEventConfig(
      {
        ...createDefaultConfig('C:\\Events'),
        schemaVersion: 8,
        layout: {
          ...createDefaultConfig('').layout,
          railImageAssetId: firstAsset,
          railImageName: 'trio.png',
        },
        railArtworkCache: {
          'center-rail-two-stack': { assetId: secondAsset, name: 'pair.png' },
          invalid: { assetId: 'not-an-id', name: 'invalid.png' },
        },
      },
      'C:\\Events',
    );

    expect(normalized.schemaVersion).toBe(10);
    expect(normalized.railArtworkCache).toEqual({
      'center-rail-two-stack': { assetId: secondAsset, name: 'pair.png' },
      'side-rail-three-stack': { assetId: firstAsset, name: 'trio.png' },
    });

    const pairLayout = applyLayoutPreset(normalized.layout, 'center-rail-two-stack', normalized.railArtworkCache);
    expect(pairLayout).toMatchObject({
      preset: 'center-rail-two-stack',
      railImageAssetId: secondAsset,
      railImageName: 'pair.png',
    });
  });

  it('migrates the old untouched capture timing defaults and removes the photo pause', () => {
    const migrated = normalizeEventConfig(
      {
        ...createDefaultConfig('C:\\Events'),
        schemaVersion: 5,
        capture: {
          countdownSeconds: 3,
          previewMs: 1000,
          transitionMs: 2500,
          mirrorLiveView: true,
          camera: 'canon',
        },
      },
      'C:\\Events',
    );

    expect(migrated.capture).toMatchObject({ countdownSeconds: 8, previewMs: 2000 });
    expect(migrated.capture).not.toHaveProperty('transitionMs');
  });

  it('preserves intentional custom capture timings from older configurations', () => {
    const migrated = normalizeEventConfig(
      {
        ...createDefaultConfig('C:\\Events'),
        schemaVersion: 5,
        capture: { countdownSeconds: 6, previewMs: 1500, mirrorLiveView: false, camera: 'canon' },
      },
      'C:\\Events',
    );

    expect(migrated.capture).toMatchObject({ countdownSeconds: 6, previewMs: 1500, mirrorLiveView: false });
    expect(migrated.capture.sessionVideoEnabled).toBe(false);
  });

  it('migrates video metadata safely and rejects malformed shutter markers', () => {
    const migrated = normalizeSessionMetadata({
      id: 'session-1',
      videoEnabled: true,
      videoStatus: 'recording',
      videoMarkers: [
        { index: 0, capturedAt: '2026-08-09T12:00:00.000Z', offsetMs: 1200 },
        { index: -1, capturedAt: '', offsetMs: -5 },
      ],
    });

    expect(migrated.schemaVersion).toBe(7);
    expect(migrated.photoCount).toBe(3);
    expect(migrated.layout.preset).toBe('side-rail-three-stack');
    expect(migrated.videoStatus).toBe('recording');
    expect(migrated.videoSource).toBe('canon-live-view');
    expect(migrated.recapStatus).toBe('pending');
    expect(migrated.recapVersion).toBe(0);
    expect(migrated.videoMarkers).toEqual([{ index: 0, capturedAt: '2026-08-09T12:00:00.000Z', offsetMs: 1200 }]);

    const priorRecap = normalizeSessionMetadata({
      id: 'session-2',
      videoEnabled: true,
      videoStatus: 'ready',
      videoTimelineFramesPerSecond: 20,
      videoDurationMs: 32_550,
      recapStatus: 'ready',
      recapPath: 'C:\\Events\\session-recap.mp4',
    });
    expect(priorRecap).toMatchObject({
      schemaVersion: 7,
      videoTimelineFramesPerSecond: 20,
      videoDurationMs: 32_550,
      recapVersion: 1,
    });
  });

  it('preserves a selected Windows session-video feed', () => {
    const normalized = normalizeEventConfig(
      {
        ...createDefaultConfig('C:\\Events'),
        capture: {
          ...createDefaultConfig('').capture,
          sessionVideoEnabled: true,
          sessionVideoSource: 'windows-camera',
          windowsVideoDeviceId: 'surface-camera-device',
          windowsVideoDeviceName: 'Surface Rear Camera',
        },
      },
      'C:\\Events',
    );

    expect(normalized.capture).toMatchObject({
      sessionVideoEnabled: true,
      sessionVideoSource: 'windows-camera',
      windowsVideoDeviceId: 'surface-camera-device',
      windowsVideoDeviceName: 'Surface Rear Camera',
    });
  });

  it('requires complete setup and limits it to the configured local day', () => {
    const incomplete = createDefaultConfig('C:\\Events');
    expect(isEventConfigured(incomplete)).toBe(false);
    expect(eventSetupIssues(incomplete)).toEqual(
      expect.arrayContaining(['Add an Event ID.', 'Add an event description.']),
    );

    const draft = {
      ...incomplete,
      id: 'gala',
      description: 'Summer Gala',
      eventDate: localDateInputValue(),
      layout: {
        ...incomplete.layout,
        railImageAssetId: '11111111-1111-4111-8111-111111111111',
        railImageName: 'gala.png',
      },
    };
    expect(isEventDraftComplete(draft)).toBe(true);
    expect(isEventConfigured(draft)).toBe(false);

    const configured = { ...draft, createdAt: new Date().toISOString() };
    expect(isEventConfigured(configured)).toBe(true);
    expect(isEventActive(configured)).toBe(true);
    expect(isEventActive(configured, '2099-01-01')).toBe(false);
  });

  it('requires rail artwork even when an older event predates the artwork-only layouts', () => {
    const legacy = {
      ...createDefaultConfig('C:\\Events'),
      id: 'legacy-event',
      description: 'Legacy Event',
      eventDate: localDateInputValue(),
      createdAt: new Date().toISOString(),
    };

    expect(isEventConfigured(legacy)).toBe(false);
    expect(eventSetupIssues(legacy)).toContain('Add rail artwork.');
  });

  it('clears an invalid stored event date during migration', () => {
    const normalized = normalizeEventConfig(
      { ...createDefaultConfig('C:\\Events'), eventDate: '2026-02-31' },
      'C:\\Events',
    );
    expect(normalized.eventDate).toBe('');
  });

  it('clamps invalid print quantities', () => {
    expect(clampCopies(Number.NaN, 5)).toBe(1);
    expect(clampCopies(99, 5)).toBe(5);
    expect(clampCopies(-4, 5)).toBe(1);
  });
});
