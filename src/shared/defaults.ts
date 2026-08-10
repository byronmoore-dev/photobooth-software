import type { EventConfig, LayoutConfig, SessionMetadata } from './types';
import { DEFAULT_LAYOUT_PRESET } from './layoutPresets';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const number = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
};
const color = (value: unknown, fallback: string) => (/^#[0-9a-f]{6}$/i.test(text(value)) ? text(value) : fallback);

export const localDateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const validDateInput = (value: unknown) => {
  const candidate = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';
  const [year, month, day] = candidate.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? candidate : '';
};

export const createDefaultConfig = (baseFolder: string): EventConfig => ({
  schemaVersion: 7,
  id: '',
  createdAt: '',
  eventDate: '',
  description: '',
  baseFolder,
  display: { kioskMode: true },
  capture: {
    countdownSeconds: 8,
    previewMs: 2000,
    mirrorLiveView: true,
    sessionVideoEnabled: false,
    camera: 'canon',
  },
  layout: {
    preset: DEFAULT_LAYOUT_PRESET.id,
    width: DEFAULT_LAYOUT_PRESET.width,
    height: DEFAULT_LAYOUT_PRESET.height,
    quality: DEFAULT_LAYOUT_PRESET.defaults.quality,
    background: DEFAULT_LAYOUT_PRESET.defaults.background,
    text: DEFAULT_LAYOUT_PRESET.defaults.text,
    detail: '',
    textColor: DEFAULT_LAYOUT_PRESET.defaults.textColor,
    fontSize: DEFAULT_LAYOUT_PRESET.defaults.fontSize,
    typeface: DEFAULT_LAYOUT_PRESET.defaults.typeface,
    railImageAssetId: '',
    railImageName: '',
  },
  printer: {
    name: '',
    paperSize: '4 × 6 in',
    orientation: 'portrait',
    defaultCopies: 1,
    maxCopies: 5,
  },
  sharing: {
    enabled: false,
    uploadOriginals: true,
    uploadFinal: true,
    qrEnabled: true,
    supabaseUrl: '',
    supabaseAnonKey: '',
    uploadEndpoint: '',
    publicBaseUrl: '',
  },
});

export const normalizeLayoutConfig = (value: unknown, fallback?: LayoutConfig): LayoutConfig => {
  const defaults = fallback ?? createDefaultConfig('').layout;
  const source = record(value);
  return {
    preset: DEFAULT_LAYOUT_PRESET.id,
    width: DEFAULT_LAYOUT_PRESET.width,
    height: DEFAULT_LAYOUT_PRESET.height,
    quality: Math.round(number(source.quality, defaults.quality, 70, 100)),
    background: color(source.background, defaults.background),
    text: text(source.text, defaults.text).slice(0, 120),
    detail: text(source.detail).slice(0, 180),
    textColor: color(source.textColor, defaults.textColor),
    fontSize: Math.round(number(source.fontSize, defaults.fontSize, 36, 220)),
    typeface: source.typeface === 'modern-sans' ? 'modern-sans' : defaults.typeface,
    railImageAssetId: /^[0-9a-f-]{36}$/i.test(text(source.railImageAssetId)) ? text(source.railImageAssetId) : '',
    railImageName: text(source.railImageName).trim().slice(0, 180),
  };
};

export const normalizeEventConfig = (value: unknown, baseFolder: string): EventConfig => {
  const defaults = createDefaultConfig(baseFolder);
  const source = record(value);
  const display = record(source.display);
  const capture = record(source.capture);
  const sourceSchemaVersion = typeof source.schemaVersion === 'number' ? source.schemaVersion : 0;
  const printer = record(source.printer);
  const sharing = record(source.sharing);
  const maxCopies = Math.round(number(printer.maxCopies, defaults.printer.maxCopies, 1, 20));
  const description = text(source.description).trim().slice(0, 500);
  const layoutSource = record(source.layout);
  const layout = normalizeLayoutConfig(layoutSource, defaults.layout);
  const id = text(source.id)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  const storedCreatedAt = text(source.createdAt);
  const storedEventDate = validDateInput(source.eventDate);
  const createdAt = Number.isNaN(Date.parse(storedCreatedAt))
    ? id && storedEventDate && !('createdAt' in source)
      ? `${storedEventDate}T12:00:00.000Z`
      : ''
    : storedCreatedAt;
  if (!('detail' in layoutSource) && description) layout.detail = description.slice(0, 180);
  return {
    schemaVersion: 7,
    id,
    createdAt,
    eventDate: storedEventDate,
    description,
    baseFolder: text(source.baseFolder, baseFolder) || baseFolder,
    display: { kioskMode: bool(display.kioskMode, defaults.display.kioskMode) },
    capture: {
      countdownSeconds:
        sourceSchemaVersion < 6 && capture.countdownSeconds === 3
          ? defaults.capture.countdownSeconds
          : Math.round(number(capture.countdownSeconds, defaults.capture.countdownSeconds, 1, 10)),
      previewMs:
        sourceSchemaVersion < 6 && capture.previewMs === 1000
          ? defaults.capture.previewMs
          : Math.round(number(capture.previewMs, defaults.capture.previewMs, 250, 10000)),
      mirrorLiveView: bool(capture.mirrorLiveView, defaults.capture.mirrorLiveView),
      sessionVideoEnabled: bool(capture.sessionVideoEnabled, defaults.capture.sessionVideoEnabled),
      camera: 'canon',
    },
    layout,
    printer: {
      name: text(printer.name).slice(0, 260),
      paperSize: ['4 × 6 in', '5 × 7 in'].includes(text(printer.paperSize))
        ? text(printer.paperSize)
        : defaults.printer.paperSize,
      orientation: printer.orientation === 'landscape' ? 'landscape' : 'portrait',
      defaultCopies: Math.round(number(printer.defaultCopies, defaults.printer.defaultCopies, 1, maxCopies)),
      maxCopies,
    },
    sharing: {
      enabled: bool(sharing.enabled, defaults.sharing.enabled),
      uploadOriginals: bool(sharing.uploadOriginals, defaults.sharing.uploadOriginals),
      uploadFinal: bool(sharing.uploadFinal, defaults.sharing.uploadFinal),
      qrEnabled: bool(sharing.qrEnabled, defaults.sharing.qrEnabled),
      supabaseUrl: text(sharing.supabaseUrl).trim().slice(0, 2048),
      supabaseAnonKey: text(sharing.supabaseAnonKey).trim().slice(0, 4096),
      uploadEndpoint: text(sharing.uploadEndpoint).trim().slice(0, 2048),
      publicBaseUrl: text(sharing.publicBaseUrl).trim().slice(0, 2048),
    },
  };
};

export const normalizeSessionMetadata = (value: unknown): SessionMetadata => {
  const source = record(value);
  const createdAt = text(source.createdAt, new Date().toISOString());
  const videoStatuses = new Set(['disabled', 'pending', 'recording', 'processing', 'ready', 'failed', 'interrupted']);
  const videoStatus = text(source.videoStatus);
  const recapStatuses = new Set(['disabled', 'pending', 'processing', 'ready', 'failed', 'interrupted']);
  const recapStatus = text(source.recapStatus);
  const videoEnabled = bool(source.videoEnabled, false);
  return {
    schemaVersion: 4,
    id: text(source.id),
    eventId: text(source.eventId),
    createdAt,
    updatedAt: text(source.updatedAt, createdAt),
    status: text(source.status, 'created'),
    originalPaths: Array.isArray(source.originalPaths)
      ? source.originalPaths.filter((item): item is string => typeof item === 'string')
      : [],
    finalPath: text(source.finalPath) || undefined,
    requestedCopies: typeof source.requestedCopies === 'number' ? source.requestedCopies : undefined,
    printStatus: text(source.printStatus) || undefined,
    uploadEnabled: bool(source.uploadEnabled, false),
    uploadStatus: text(source.uploadStatus) || undefined,
    uploadedFiles: Array.isArray(source.uploadedFiles)
      ? source.uploadedFiles.filter((item): item is string => typeof item === 'string')
      : [],
    remoteSessionId: text(source.remoteSessionId) || undefined,
    qrUrl: text(source.qrUrl) || undefined,
    videoEnabled,
    videoStatus: videoStatuses.has(videoStatus)
      ? (videoStatus as SessionMetadata['videoStatus'])
      : bool(source.videoEnabled, false)
        ? 'pending'
        : 'disabled',
    videoPath: text(source.videoPath) || undefined,
    videoStartedAt: text(source.videoStartedAt) || undefined,
    videoEndedAt: text(source.videoEndedAt) || undefined,
    videoFrameCount:
      typeof source.videoFrameCount === 'number' && Number.isFinite(source.videoFrameCount)
        ? Math.max(0, Math.floor(source.videoFrameCount))
        : undefined,
    videoDroppedFrames:
      typeof source.videoDroppedFrames === 'number' && Number.isFinite(source.videoDroppedFrames)
        ? Math.max(0, Math.floor(source.videoDroppedFrames))
        : undefined,
    videoMarkers: Array.isArray(source.videoMarkers)
      ? source.videoMarkers.flatMap((item) => {
          const marker = record(item);
          const index = typeof marker.index === 'number' ? Math.floor(marker.index) : -1;
          const capturedAt = text(marker.capturedAt);
          const offsetMs =
            typeof marker.offsetMs === 'number' && Number.isFinite(marker.offsetMs)
              ? Math.max(0, Math.round(marker.offsetMs))
              : -1;
          return index >= 0 && capturedAt && offsetMs >= 0 ? [{ index, capturedAt, offsetMs }] : [];
        })
      : [],
    recapStatus: recapStatuses.has(recapStatus)
      ? (recapStatus as SessionMetadata['recapStatus'])
      : videoEnabled
        ? 'pending'
        : 'disabled',
    recapPath: text(source.recapPath) || undefined,
    recapStartedAt: text(source.recapStartedAt) || undefined,
    recapCompletedAt: text(source.recapCompletedAt) || undefined,
    recapDurationMs:
      typeof source.recapDurationMs === 'number' && Number.isFinite(source.recapDurationMs)
        ? Math.max(0, Math.round(source.recapDurationMs))
        : undefined,
    errors: Array.isArray(source.errors)
      ? (source.errors.filter((item) => item && typeof item === 'object') as SessionMetadata['errors'])
      : [],
    test: bool(source.test, false),
  };
};

export const requireEventId = (config: EventConfig) => {
  if (!config.id) throw new Error('Add an Event ID before leaving Settings.');
  return config;
};

export const eventDraftIssues = (config: EventConfig) => {
  const issues: string[] = [];
  if (!config.id.trim()) issues.push('Add an Event ID.');
  if (!config.eventDate) issues.push('Choose an event date.');
  if (!config.description.trim()) issues.push('Add an event description.');
  if (!config.baseFolder.trim()) issues.push('Choose an event folder.');
  return issues;
};

export const eventSetupIssues = (config: EventConfig, today = localDateInputValue()) => {
  const issues = eventDraftIssues(config);
  if (!config.createdAt) issues.push('Create the event.');
  if (config.eventDate && config.eventDate !== today) {
    issues.push(`This setup is active only on ${config.eventDate}.`);
  }
  return issues;
};

export const isEventConfigured = (config: EventConfig) =>
  eventDraftIssues(config).length === 0 && Boolean(config.createdAt);

export const isEventDraftComplete = (config: EventConfig) => eventDraftIssues(config).length === 0;

export const isEventActive = (config: EventConfig, today = localDateInputValue()) =>
  isEventConfigured(config) && config.eventDate === today;

export const clampCopies = (copies: number, maximum: number) =>
  Math.max(1, Math.min(Math.max(1, Math.floor(maximum)), Math.floor(Number.isFinite(copies) ? copies : 1)));
