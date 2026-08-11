import type { SessionView } from '@shared/types';

export interface WindowsCameraDevice {
  deviceId: string;
  label: string;
}

const MIME_PREFERENCES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] as const;

export const chooseRecorderMimeType = (supported: (mimeType: string) => boolean) =>
  MIME_PREFERENCES.find(supported) ?? '';

const requireMediaDevices = () => {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
    throw new Error('Windows camera access is unavailable on this device.');
  }
  return navigator.mediaDevices;
};

export const createWindowsCameraStream = (deviceId: string) =>
  requireMediaDevices().getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 30 },
    },
  });

export const discoverWindowsCameras = async (): Promise<WindowsCameraDevice[]> => {
  const mediaDevices = requireMediaDevices();
  const permissionStream = await mediaDevices.getUserMedia({ audio: false, video: true });
  try {
    const inputs = (await mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
    return inputs.map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label.trim() || `Windows camera ${index + 1}`,
    }));
  } finally {
    permissionStream.getTracks().forEach((track) => track.stop());
  }
};

interface ActiveRecording {
  sessionId: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  writeQueue: Promise<void>;
  chunkFailure?: Error;
}

class WindowsCameraRecorder {
  private active?: ActiveRecording;

  async start(sessionId: string, deviceId: string): Promise<SessionView> {
    if (this.active) throw new Error('A Windows camera recording is already active.');
    const stream = await createWindowsCameraStream(deviceId);
    const mimeType = chooseRecorderMimeType(MediaRecorder.isTypeSupported);
    if (!mimeType) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('This Windows installation cannot encode a compatible camera recording.');
    }

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    const active: ActiveRecording = { sessionId, recorder, stream, writeQueue: Promise.resolve() };
    this.active = active;
    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data.size) return;
      const buffer = event.data.arrayBuffer();
      active.writeQueue = active.writeQueue
        .then(async () => window.booth.session.appendExternalVideo(sessionId, await buffer))
        .catch((reason) => {
          active.chunkFailure = reason instanceof Error ? reason : new Error(String(reason));
        });
    });

    try {
      const session = await window.booth.session.startExternalVideo(sessionId, mimeType, new Date().toISOString());
      await new Promise<void>((resolve, reject) => {
        recorder.addEventListener('start', () => resolve(), { once: true });
        recorder.addEventListener('error', () => reject(new Error('The Windows camera could not start recording.')), {
          once: true,
        });
        recorder.start(1_000);
      });
      return session;
    } catch (reason) {
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      this.active = undefined;
      throw reason;
    }
  }

  async stop(sessionId: string): Promise<SessionView> {
    const active = this.active;
    if (!active || active.sessionId !== sessionId) {
      return window.booth.session.stopExternalVideo(sessionId, new Date().toISOString());
    }
    const endedAt = new Date().toISOString();
    try {
      if (active.recorder.state !== 'inactive') {
        await new Promise<void>((resolve, reject) => {
          active.recorder.addEventListener('stop', () => resolve(), { once: true });
          active.recorder.addEventListener(
            'error',
            () => reject(new Error('The Windows camera stopped unexpectedly.')),
            { once: true },
          );
          active.recorder.stop();
        });
      }
      await active.writeQueue;
      if (active.chunkFailure) throw active.chunkFailure;
      return await window.booth.session.stopExternalVideo(sessionId, endedAt);
    } finally {
      active.stream.getTracks().forEach((track) => track.stop());
      this.active = undefined;
    }
  }
}

export const windowsCameraRecorder = new WindowsCameraRecorder();
