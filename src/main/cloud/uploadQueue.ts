import { readFile } from 'node:fs/promises';
import type { EventConfig, SessionMetadata } from '../../shared/types';
import { SessionStorage } from '../storage/sessionStorage';

/** Offline-safe queue. session.json is the durable queue record. */
export class UploadQueue {
  private readonly running = new Set<string>();

  constructor(private readonly sessions: SessionStorage) {}

  async enqueue(config: EventConfig, input: SessionMetadata) {
    if (!config.sharing.enabled || !config.sharing.uploadEndpoint || this.running.has(input.id)) return;
    this.running.add(input.id);
    try {
      const session = await this.sessions.update(config, input.id, (current) => {
        current.uploadStatus = 'uploading';
        return current;
      });
      const files = [
        ...(config.sharing.uploadOriginals
          ? session.originalPaths.map((file, index) => ({ file, name: `original-${index + 1}.jpg` }))
          : []),
        ...(config.sharing.uploadFinal && session.finalPath ? [{ file: session.finalPath, name: 'final.jpg' }] : []),
      ];
      const response = await fetch(config.sharing.uploadEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.sharing.supabaseAnonKey ? { authorization: `Bearer ${config.sharing.supabaseAnonKey}` } : {}),
        },
        body: JSON.stringify({
          eventId: session.eventId,
          sessionId: session.id,
          files: files.map((item) => item.name),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Upload service returned ${response.status}`);
      const payload = (await response.json()) as {
        uploads: Record<string, string>;
        remoteSessionId?: string;
        sessionUrl?: string;
      };

      for (const item of files) {
        if (session.uploadedFiles?.includes(item.name)) continue;
        const url = payload.uploads[item.name];
        if (!url) throw new Error(`Missing upload URL for ${item.name}`);
        const upload = await fetch(url, {
          method: 'PUT',
          body: await readFile(item.file),
          headers: { 'content-type': 'image/jpeg' },
          signal: AbortSignal.timeout(90_000),
        });
        if (!upload.ok) throw new Error(`Upload failed for ${item.name}`);
        await this.sessions.update(config, session.id, (current) => {
          current.uploadedFiles = [...new Set([...(current.uploadedFiles ?? []), item.name])];
          return current;
        });
      }

      await this.sessions.update(config, session.id, (current) => {
        current.uploadStatus = 'complete';
        current.remoteSessionId = payload.remoteSessionId;
        current.qrUrl = payload.sessionUrl;
        return current;
      });
    } catch (error) {
      await this.sessions
        .update(config, input.id, (current) => {
          current.uploadStatus = 'pending';
          current.errors.push({
            at: new Date().toISOString(),
            step: 'upload',
            message: error instanceof Error ? error.message : String(error),
          });
          return current;
        })
        .catch(() => undefined);
    } finally {
      this.running.delete(input.id);
    }
  }

  async retryPending(config: EventConfig) {
    const pending = (await this.sessions.all(config)).filter(
      (session) => session.uploadEnabled && session.uploadStatus !== 'complete',
    );
    pending.forEach((session) => void this.enqueue(config, session));
    return pending.length;
  }
}
