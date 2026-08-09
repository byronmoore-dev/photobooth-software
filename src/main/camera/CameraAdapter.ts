import type { CameraStatus, CapturedPhoto } from '../../shared/types';

export interface CameraAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  startLiveView(): Promise<string>;
  stopLiveView(): Promise<void>;
  capture(destinationPath: string): Promise<CapturedPhoto>;
  getStatus(): Promise<CameraStatus>;
  setFrameHandler(handler: (frame: string) => void): void;
  setStatusHandler(handler: (status: CameraStatus) => void): void;
}
