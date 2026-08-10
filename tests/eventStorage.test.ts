import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const paths = vi.hoisted(() => ({ userData: '', documents: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? paths.userData : paths.documents),
  },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}));

import { createDefaultConfig, localDateInputValue } from '../src/shared/defaults';
import { EventStorage } from '../src/main/storage/eventStorage';

describe('event lifecycle storage', () => {
  beforeEach(async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'camera-booth-events-'));
    paths.userData = path.join(root, 'user-data');
    paths.documents = path.join(root, 'documents');
  });

  it('saves an incomplete event draft without creating intermediate event folders', async () => {
    const storage = new EventStorage();
    const draft = { ...createDefaultConfig(paths.documents), id: 'draft-event' };
    const saved = await storage.save(draft);

    expect(saved.createdAt).toBe('');
    await expect(readFile(path.join(draft.baseFolder, draft.id, 'event.json'))).rejects.toThrow();
  });

  it('creates an immutable event record and rejects a duplicate Event ID', async () => {
    const storage = new EventStorage();
    const draft = {
      ...createDefaultConfig(path.join(paths.documents, 'events')),
      id: 'summer-gala',
      description: 'Summer Gala',
      eventDate: localDateInputValue(),
      layout: {
        ...createDefaultConfig('').layout,
        railImageAssetId: '11111111-1111-4111-8111-111111111111',
        railImageName: 'gala.png',
      },
    };
    const created = await storage.create(draft);
    const stored = JSON.parse(await readFile(path.join(draft.baseFolder, draft.id, 'event.json'), 'utf8')) as {
      id: string;
      createdAt: string;
    };

    expect(created.createdAt).not.toBe('');
    expect(stored).toMatchObject({ id: 'summer-gala', createdAt: created.createdAt });
    await expect(storage.save({ ...created, id: 'renamed-event' })).rejects.toThrow(/cannot change/);
    await expect(storage.create(draft)).rejects.toThrow(/already exists/);
  });
});
