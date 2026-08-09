import type { CameraStatus, CapturedPhoto } from '../../shared/types';

export interface VideoRecordingStart {
  startedAt: string;
}

export interface VideoRecordingResult {
  startedAt: string;
  endedAt: string;
  frameCount: number;
  droppedFrames: number;
  fileSize: number;
  framesPerSecond: number;
}

export interface CameraAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  startLiveView(): Promise<string>;
  stopLiveView(): Promise<void>;
  capture(destinationPath: string): Promise<CapturedPhoto>;
  startRecording(ffmpegPath: string, destinationPath: string): Promise<VideoRecordingStart>;
  stopRecording(): Promise<VideoRecordingResult>;
  getStatus(): Promise<CameraStatus>;
  setFrameHandler(handler: (frame: string) => void): void;
  setStatusHandler(handler: (status: CameraStatus) => void): void;
}
