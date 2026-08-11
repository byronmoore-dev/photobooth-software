export type AppState =
  | 'IDLE'
  | 'COUNTDOWN'
  | 'CAPTURING'
  | 'PHOTO_PREVIEW'
  | 'FLASH_RETRY'
  | 'RESULT'
  | 'PRINTING'
  | 'COMPLETE'
  | 'ERROR'
  | 'SETUP';

export type LayoutPresetId = 'side-rail-one-landscape' | 'center-rail-two-stack' | 'side-rail-three-stack';
export type PhotoCount = 1 | 2 | 3;
export type SessionVideoSource = 'canon-live-view' | 'windows-camera';

export interface RailArtworkSelection {
  assetId: string;
  name: string;
}

export type RailArtworkCache = Partial<Record<LayoutPresetId, RailArtworkSelection>>;

interface LayoutConfigBase {
  width: number;
  height: number;
  quality: number;
  background: string;
  railImageAssetId: string;
  railImageName: string;
}

interface SideRailOneLandscapeLayoutConfig extends LayoutConfigBase {
  preset: 'side-rail-one-landscape';
}

interface CenterRailTwoStackLayoutConfig extends LayoutConfigBase {
  preset: 'center-rail-two-stack';
}

interface SideRailThreeStackLayoutConfig extends LayoutConfigBase {
  preset: 'side-rail-three-stack';
}

/** Discriminated union: add future preset-specific configuration types here. */
export type LayoutConfig =
  SideRailOneLandscapeLayoutConfig | CenterRailTwoStackLayoutConfig | SideRailThreeStackLayoutConfig;

export interface EventConfig {
  schemaVersion: 10;
  id: string;
  createdAt: string;
  eventDate: string;
  description: string;
  baseFolder: string;
  display: { kioskMode: boolean };
  capture: {
    countdownSeconds: number;
    previewMs: number;
    mirrorLiveView: boolean;
    sessionVideoEnabled: boolean;
    sessionVideoSource: SessionVideoSource;
    windowsVideoDeviceId: string;
    windowsVideoDeviceName: string;
    camera: 'canon';
  };
  layout: LayoutConfig;
  railArtworkCache: RailArtworkCache;
  printer: {
    name: string;
    paperSize: string;
    orientation: 'portrait' | 'landscape';
    defaultCopies: number;
    maxCopies: number;
  };
  sharing: {
    enabled: boolean;
    uploadOriginals: boolean;
    uploadFinal: boolean;
    qrEnabled: boolean;
    supabaseUrl: string;
    supabaseAnonKey: string;
    uploadEndpoint: string;
    publicBaseUrl: string;
  };
}

export interface CapturedPhoto {
  path: string;
  dataUrl: string;
  capturedAt: string;
}

export interface CameraStatus {
  detected: boolean;
  connected: boolean;
  liveView: boolean;
  message: string;
  productName?: string;
  firmware?: string;
  exposureMode?: string;
  automaticSettings?: string;
  autofocus?: boolean;
}

export interface PrinterInfo {
  name: string;
  displayName?: string;
  description?: string;
  isDefault: boolean;
  status?: number;
}

export interface PrintJobResult {
  submitted: boolean;
  jobId: string;
  message: string;
}

interface SessionError {
  at: string;
  step: string;
  message: string;
}

type SessionVideoStatus = 'disabled' | 'pending' | 'recording' | 'processing' | 'ready' | 'failed' | 'interrupted';
type SessionRecapStatus = 'disabled' | 'pending' | 'processing' | 'ready' | 'failed' | 'interrupted';

interface SessionVideoMarker {
  index: number;
  capturedAt: string;
  offsetMs: number;
}

export interface SessionMetadata {
  schemaVersion: 7;
  id: string;
  eventId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  photoCount: PhotoCount;
  layout: LayoutConfig;
  originalPaths: string[];
  finalPath?: string;
  requestedCopies?: number;
  printStatus?: string;
  uploadEnabled: boolean;
  uploadStatus?: string;
  uploadedFiles?: string[];
  remoteSessionId?: string;
  qrUrl?: string;
  videoEnabled: boolean;
  videoSource: SessionVideoSource;
  videoSourceName?: string;
  videoStatus: SessionVideoStatus;
  videoPath?: string;
  videoStartedAt?: string;
  videoEndedAt?: string;
  videoFrameCount?: number;
  videoDroppedFrames?: number;
  videoTimelineFramesPerSecond?: number;
  videoDurationMs?: number;
  videoMarkers: SessionVideoMarker[];
  recapStatus: SessionRecapStatus;
  recapVersion: number;
  recapPath?: string;
  recapStartedAt?: string;
  recapCompletedAt?: string;
  recapDurationMs?: number;
  errors: SessionError[];
  test?: boolean;
}

export interface SessionView extends SessionMetadata {
  originalDataUrls: string[];
  finalDataUrl?: string;
  videoUrl?: string;
  recapUrl?: string;
}

export interface SessionSummary extends SessionMetadata {
  finalDataUrl?: string;
  videoUrl?: string;
  recapUrl?: string;
}

export interface RecoverySummary {
  recovered: number;
  interrupted: number;
  pendingUploads: number;
}

export interface DiagnosticsResult {
  label: string;
  status: 'pass' | 'warning' | 'fail';
  detail: string;
}

export interface LogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  details?: unknown;
}

export interface BoothApi {
  event: {
    load(): Promise<EventConfig>;
    save(config: EventConfig): Promise<EventConfig>;
    create(config: EventConfig): Promise<EventConfig>;
    chooseFolder(): Promise<string | null>;
    openFolder(): Promise<void>;
  };
  camera: {
    connect(): Promise<CameraStatus>;
    disconnect(): Promise<void>;
    startLiveView(): Promise<{ status: CameraStatus; frame: string }>;
    capture(sessionId: string, index: number): Promise<CapturedPhoto>;
    status(): Promise<CameraStatus>;
    onFrame(callback: (frame: string) => void): () => void;
    onStatus(callback: (status: CameraStatus) => void): () => void;
  };
  session: {
    create(test?: boolean): Promise<SessionView>;
    get(id: string): Promise<SessionView>;
    startVideo(id: string): Promise<SessionView>;
    stopVideo(id: string): Promise<SessionView>;
    startExternalVideo(id: string, mimeType: string, startedAt: string): Promise<SessionView>;
    appendExternalVideo(id: string, chunk: ArrayBuffer): Promise<void>;
    stopExternalVideo(id: string, endedAt: string): Promise<SessionView>;
    failVideo(id: string, message: string): Promise<SessionView>;
    retryRecap(id: string): Promise<SessionView>;
    render(id: string): Promise<SessionView>;
    recent(): Promise<SessionSummary[]>;
    recover(): Promise<RecoverySummary>;
  };
  printer: {
    list(): Promise<PrinterInfo[]>;
    print(sessionId: string, copies: number): Promise<PrintJobResult>;
    testPrint(path: string): Promise<PrintJobResult>;
    testConnection(): Promise<PrintJobResult>;
  };
  layout: {
    preview(config: LayoutConfig): Promise<{ path: string; dataUrl: string }>;
    chooseRailImage(config: LayoutConfig): Promise<{ assetId: string; name: string } | null>;
  };
  diagnostics: { run(): Promise<DiagnosticsResult[]> };
  upload: { retryPending(): Promise<number> };
  system: {
    getVersion(): Promise<string>;
    setKiosk(enabled: boolean): Promise<boolean>;
    showTouchKeyboard(): Promise<boolean>;
    logs(): Promise<LogEntry[]>;
  };
}

declare global {
  interface Window {
    booth: BoothApi;
  }
}
