import { access, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { EventConfig, RecoverySummary, SessionMetadata, SessionSummary, SessionView } from '../../shared/types';
import { normalizeSessionMetadata } from '../../shared/defaults';
import { atomicWriteJson, readJsonWithBackup } from './atomicFile';
import { EventStorage } from './eventStorage';

const SESSION_ID = /^(?:test-)?[A-Za-z0-9-]{12,80}$/;
const markerSuffix = (markers: SessionMetadata['videoMarkers']) => {
  const offsets = [...markers]
    .sort((left, right) => left.index - right.index)
    .map((marker) => `${String(Math.max(0, Math.round(marker.offsetMs))).padStart(6, '0')}ms`);
  return offsets.length === 3 ? `__shots-${offsets.join('-')}` : '';
};

export class SessionStorage {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly events: Pick<EventStorage, 'eventFolder'>) {}

  private assertId(id: string) {
    if (!SESSION_ID.test(id)) throw new Error('Invalid session ID');
    return id;
  }

  private folder(config: EventConfig, id: string) {
    return path.join(this.events.eventFolder(config), 'sessions', this.assertId(id));
  }

  private metadataPath(config: EventConfig, id: string) {
    return path.join(this.folder(config, id), 'session.json');
  }

  async create(config: EventConfig, test = false): Promise<SessionMetadata> {
    const now = new Date().toISOString();
    const id = `${test ? 'test-' : ''}${now.replace(/[:.]/g, '-').slice(0, 19)}-${crypto.randomUUID().slice(0, 6)}`;
    const metadata: SessionMetadata = {
      schemaVersion: 4,
      id,
      eventId: config.id,
      createdAt: now,
      updatedAt: now,
      status: 'created',
      originalPaths: [],
      uploadEnabled: config.sharing.enabled && !test,
      uploadStatus: config.sharing.enabled && !test ? 'pending' : 'disabled',
      uploadedFiles: [],
      videoEnabled: config.capture.sessionVideoEnabled && !test,
      videoStatus: config.capture.sessionVideoEnabled && !test ? 'pending' : 'disabled',
      videoMarkers: [],
      recapStatus: config.capture.sessionVideoEnabled && !test ? 'pending' : 'disabled',
      errors: [],
      test,
    };
    await mkdir(this.folder(config, id), { recursive: true });
    await this.save(config, metadata);
    return metadata;
  }

  originalPath(config: EventConfig, id: string, index: number) {
    return path.join(this.folder(config, id), `original-${String(index + 1).padStart(2, '0')}.jpg`);
  }

  temporaryOriginalPath(config: EventConfig, id: string, index: number) {
    return `${this.originalPath(config, id, index)}.part`;
  }

  finalPath(config: EventConfig, id: string) {
    return path.join(this.folder(config, id), 'final.jpg');
  }

  temporaryFinalPath(config: EventConfig, id: string) {
    return `${this.finalPath(config, id)}.part`;
  }

  videoPath(config: EventConfig, id: string, markers: SessionMetadata['videoMarkers'] = []) {
    return path.join(this.folder(config, id), `session-video${markerSuffix(markers)}.mp4`);
  }

  temporaryVideoPath(config: EventConfig, id: string) {
    return path.join(this.folder(config, id), 'session-video.partial.mp4');
  }

  interruptedVideoPath(config: EventConfig, id: string) {
    return path.join(this.folder(config, id), 'session-video.interrupted.mp4');
  }

  recapPath(config: EventConfig, id: string, markers: SessionMetadata['videoMarkers'] = []) {
    return path.join(this.folder(config, id), `session-recap${markerSuffix(markers)}.mp4`);
  }

  temporaryRecapPath(config: EventConfig, id: string) {
    return path.join(this.folder(config, id), 'session-recap.partial.mp4');
  }

  isManagedVideoPath(config: EventConfig, id: string, file: string, asset: 'raw' | 'recap') {
    const candidate = path.resolve(file);
    if (path.dirname(candidate) !== path.resolve(this.folder(config, id))) return false;
    const prefix = asset === 'raw' ? 'session-video' : 'session-recap';
    return new RegExp(`^${prefix}(?:__shots-\\d{6,}ms-\\d{6,}ms-\\d{6,}ms)?\\.mp4$`, 'i').test(
      path.basename(candidate),
    );
  }

  async save(config: EventConfig, input: SessionMetadata) {
    const metadata = normalizeSessionMetadata({ ...input, updatedAt: new Date().toISOString() });
    await mkdir(this.folder(config, metadata.id), { recursive: true });
    await atomicWriteJson(this.metadataPath(config, metadata.id), metadata);
    return metadata;
  }

  async get(config: EventConfig, id: string) {
    return normalizeSessionMetadata(await readJsonWithBackup<unknown>(this.metadataPath(config, id)));
  }

  async update(config: EventConfig, id: string, change: (current: SessionMetadata) => SessionMetadata | void) {
    this.assertId(id);
    const previous = this.locks.get(id) ?? Promise.resolve();
    let updated: SessionMetadata | undefined;
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const current = await this.get(config, id);
        updated = change(current) ?? current;
        updated = await this.save(config, updated);
      });
    const queued = operation.finally(() => {
      if (this.locks.get(id) === queued) this.locks.delete(id);
    });
    this.locks.set(id, queued);
    await operation;
    return updated!;
  }

  async view(config: EventConfig, metadata: SessionMetadata): Promise<SessionView> {
    const toData = async (file?: string) => {
      if (!file) return undefined;
      try {
        return `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;
      } catch {
        return undefined;
      }
    };
    const originals = await Promise.all(metadata.originalPaths.map(toData));
    return {
      ...metadata,
      originalDataUrls: originals.filter((item): item is string => Boolean(item)),
      finalDataUrl: await toData(metadata.finalPath),
      videoUrl: metadata.videoStatus === 'ready' && metadata.videoPath ? this.videoUrl(metadata.id) : undefined,
      recapUrl:
        metadata.recapStatus === 'ready' && metadata.recapPath ? this.videoUrl(metadata.id, 'recap') : undefined,
    };
  }

  videoUrl(id: string, asset: 'raw' | 'recap' = 'raw') {
    return `camera-booth-video://session/${encodeURIComponent(this.assertId(id))}?asset=${asset}`;
  }

  async summary(metadata: SessionMetadata): Promise<SessionSummary> {
    let finalDataUrl: string | undefined;
    if (metadata.finalPath) {
      try {
        finalDataUrl = `data:image/jpeg;base64,${(await readFile(metadata.finalPath)).toString('base64')}`;
      } catch {
        finalDataUrl = undefined;
      }
    }
    return {
      ...metadata,
      finalDataUrl,
      videoUrl: metadata.videoStatus === 'ready' && metadata.videoPath ? this.videoUrl(metadata.id) : undefined,
      recapUrl:
        metadata.recapStatus === 'ready' && metadata.recapPath ? this.videoUrl(metadata.id, 'recap') : undefined,
    };
  }

  async all(config: EventConfig): Promise<SessionMetadata[]> {
    const root = path.join(this.events.eventFolder(config), 'sessions');
    let names: string[] = [];
    try {
      names = await readdir(root);
    } catch {
      return [];
    }
    const records = await Promise.all(
      names
        .filter((name) => SESSION_ID.test(name))
        .map(async (name) => {
          try {
            return await this.get(config, name);
          } catch {
            return null;
          }
        }),
    );
    return records
      .filter((item): item is SessionMetadata => Boolean(item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async recent(config: EventConfig) {
    return (await this.all(config)).slice(0, 30);
  }

  async recover(
    config: EventConfig,
    validateImage: (file: string) => Promise<void>,
    renderFinal: (metadata: SessionMetadata) => Promise<string>,
  ): Promise<RecoverySummary> {
    const summary: RecoverySummary = { recovered: 0, interrupted: 0, pendingUploads: 0 };
    for (const metadata of await this.all(config)) {
      let changed = false;
      await Promise.all([
        ...[0, 1, 2].map((index) => rm(this.temporaryOriginalPath(config, metadata.id, index), { force: true })),
        rm(this.temporaryFinalPath(config, metadata.id), { force: true }),
        rm(this.temporaryRecapPath(config, metadata.id), { force: true }),
      ]);
      if (metadata.recapStatus === 'processing') {
        metadata.recapStatus = 'interrupted';
        metadata.errors.push({
          at: new Date().toISOString(),
          step: 'recap-recovery',
          message: 'Recap generation was interrupted and will be retried in the background.',
        });
        changed = true;
      } else if (metadata.recapStatus === 'ready') {
        try {
          if (!metadata.recapPath || (await stat(metadata.recapPath)).size === 0) throw new Error('Missing recap');
        } catch {
          metadata.recapStatus = 'interrupted';
          metadata.recapPath = undefined;
          changed = true;
        }
      }
      if (['recording', 'processing'].includes(metadata.videoStatus)) {
        const partial = this.temporaryVideoPath(config, metadata.id);
        const interrupted = this.interruptedVideoPath(config, metadata.id);
        try {
          if ((await stat(partial)).size > 0) {
            await rm(interrupted, { force: true });
            await rename(partial, interrupted);
          } else {
            await rm(partial, { force: true });
          }
        } catch {
          // No partial recording was recoverable.
        }
        metadata.videoStatus = 'interrupted';
        metadata.videoEndedAt = new Date().toISOString();
        metadata.errors.push({
          at: new Date().toISOString(),
          step: 'video-recovery',
          message: 'Session video was interrupted. The photo session was preserved.',
        });
        changed = true;
      } else if (metadata.videoStatus === 'ready') {
        try {
          if (!metadata.videoPath || (await stat(metadata.videoPath)).size === 0) throw new Error('Missing video');
        } catch {
          metadata.videoStatus = 'failed';
          metadata.videoPath = undefined;
          metadata.errors.push({
            at: new Date().toISOString(),
            step: 'video-recovery',
            message: 'The session video file was missing or empty. The photo session was preserved.',
          });
          changed = true;
        }
      }
      if (metadata.uploadStatus === 'uploading') {
        metadata.uploadStatus = 'pending';
        changed = true;
      }
      if (metadata.uploadEnabled && metadata.uploadStatus !== 'complete') summary.pendingUploads++;

      const validOriginals: string[] = [];
      for (const file of metadata.originalPaths) {
        try {
          await access(file);
          await validateImage(file);
          validOriginals.push(file);
        } catch {
          // Preserve the metadata record while excluding an invalid file from recovery.
        }
      }

      if (validOriginals.length === 3) {
        let finalValid = false;
        if (metadata.finalPath) {
          try {
            await validateImage(metadata.finalPath);
            finalValid = true;
          } catch {
            finalValid = false;
          }
        }
        if (!finalValid) {
          metadata.originalPaths = validOriginals;
          metadata.finalPath = await renderFinal(metadata);
          metadata.status = 'ready';
          summary.recovered++;
          changed = true;
        }
      } else if (!['complete', 'print-error', 'interrupted'].includes(metadata.status)) {
        metadata.status = 'interrupted';
        metadata.errors.push({
          at: new Date().toISOString(),
          step: 'recovery',
          message: `Session stopped after ${validOriginals.length} of 3 photos. Saved originals were preserved.`,
        });
        summary.interrupted++;
        changed = true;
      }

      if (changed) await this.save(config, metadata);
    }
    return summary;
  }
}
