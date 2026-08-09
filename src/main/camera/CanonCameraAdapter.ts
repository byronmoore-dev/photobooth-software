import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CameraAdapter } from './CameraAdapter';
import type { CameraStatus, CapturedPhoto } from '../../shared/types';

interface BridgeMessage {
  type: string;
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
  jpeg?: string;
  status?: CameraStatus;
}
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class CanonCameraAdapter implements CameraAdapter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private frameHandler: (frame: string) => void = () => {};
  private statusHandler: (status: CameraStatus) => void = () => {};
  private lastFrame = '';
  private lastStatus: CameraStatus = {
    detected: false,
    connected: false,
    liveView: false,
    message: 'Canon camera disconnected',
  };
  private ready: Promise<void> | null = null;

  setFrameHandler(handler: (frame: string) => void) {
    this.frameHandler = handler;
  }
  setStatusHandler(handler: (status: CameraStatus) => void) {
    this.statusHandler = handler;
  }

  private bridgePath() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'camera-bridge', 'CanonCameraBridge.exe')
      : path.join(process.cwd(), 'dist-camera-bridge', 'CanonCameraBridge.exe');
  }

  private ensureBridge() {
    if (this.child && !this.child.killed) return this.ready!;
    const executable = this.bridgePath();
    this.child = spawn(executable, [], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Canon camera bridge did not start')), 10000);
      const lines = createInterface({ input: this.child!.stdout });
      lines.on('line', (line) => {
        let message: BridgeMessage;
        try {
          message = JSON.parse(line) as BridgeMessage;
        } catch {
          return;
        }
        if (message.type === 'ready') {
          clearTimeout(timeout);
          resolve();
          return;
        }
        if (message.type === 'frame' && message.jpeg) {
          this.lastFrame = `data:image/jpeg;base64,${message.jpeg}`;
          this.frameHandler(this.lastFrame);
          return;
        }
        if (message.type === 'status' && message.status) {
          this.lastStatus = message.status;
          this.statusHandler(this.lastStatus);
          return;
        }
        if (message.type === 'cameraError' && message.error) {
          this.lastStatus = { ...this.lastStatus, liveView: false, message: message.error };
          this.statusHandler(this.lastStatus);
          return;
        }
        if (message.type === 'response' && message.id) {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.ok) pending.resolve(message.result);
          else pending.reject(new Error(message.error || 'Canon camera command failed'));
        }
      });
      this.child!.stderr.on('data', (data) => {
        const message = String(data).trim();
        if (message) this.lastStatus = { ...this.lastStatus, message };
      });
      this.child!.once('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Could not start Canon camera bridge: ${error.message}`));
      });
      this.child!.once('exit', () => {
        this.child = null;
        this.ready = null;
        this.lastStatus = {
          detected: false,
          connected: false,
          liveView: false,
          message: 'Canon camera bridge stopped',
        };
        this.statusHandler(this.lastStatus);
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error('Canon camera bridge stopped'));
        }
        this.pending.clear();
      });
    });
    process.once('exit', () => {
      if (this.child && !this.child.killed) this.child.kill();
    });
    return this.ready;
  }

  private async command<T>(command: string, args: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    await this.ensureBridge();
    const id = crypto.randomUUID();
    const response = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Canon camera ${command} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    });
    this.child!.stdin.write(`${JSON.stringify({ id, command, args })}\n`);
    return response;
  }

  async connect() {
    this.lastStatus = await this.command<CameraStatus>('connect');
  }
  async disconnect() {
    if (!this.child) return;
    try {
      await this.command<CameraStatus>('disconnect');
      await this.command('shutdown');
    } catch {
      /* process may already be gone */
    }
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    this.ready = null;
  }
  async startLiveView() {
    this.lastStatus = await this.command<CameraStatus>('startLiveView');
    if (this.lastFrame) return this.lastFrame;
    return new Promise<string>((resolve, reject) => {
      const previous = this.frameHandler;
      const timer = setTimeout(() => {
        this.frameHandler = previous;
        reject(new Error('No live-view frames received from the Canon camera'));
      }, 8000);
      this.frameHandler = (frame) => {
        previous(frame);
        clearTimeout(timer);
        this.frameHandler = previous;
        resolve(frame);
      };
    });
  }
  async stopLiveView() {
    if (this.child) this.lastStatus = await this.command<CameraStatus>('stopLiveView');
  }
  async capture(destinationPath: string): Promise<CapturedPhoto> {
    const result = await this.command<{ path: string; capturedAt: string }>(
      'capture',
      { path: destinationPath },
      40000,
    );
    const buffer = await readFile(result.path);
    return {
      path: result.path,
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      capturedAt: result.capturedAt,
    };
  }
  async getStatus() {
    if (!this.child) return this.lastStatus;
    this.lastStatus = await this.command<CameraStatus>('status');
    return this.lastStatus;
  }
}
