import { app, dialog, shell } from 'electron';
import { access, constants, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { EventConfig } from '../../shared/types';
import { createDefaultConfig, eventDraftIssues, normalizeEventConfig, requireEventId } from '../../shared/defaults';
import { atomicWriteJson, readJsonWithBackup } from './atomicFile';

export class EventStorage {
  private readonly configPath = path.join(app.getPath('userData'), 'active-event.json');
  private readonly defaultBaseFolder = path.join(app.getPath('documents'), 'Camera Booth Events');

  async load(): Promise<EventConfig> {
    try {
      return normalizeEventConfig(await readJsonWithBackup<unknown>(this.configPath), this.defaultBaseFolder);
    } catch {
      return createDefaultConfig(this.defaultBaseFolder);
    }
  }

  async save(input: EventConfig) {
    const config = normalizeEventConfig(input, this.defaultBaseFolder);
    const previous = await this.load();
    if (config.createdAt) {
      if (!previous.createdAt || config.createdAt !== previous.createdAt) {
        throw new Error('Use Create Event to establish a new event.');
      }
      if (
        config.id !== previous.id ||
        config.eventDate !== previous.eventDate ||
        config.baseFolder !== previous.baseFolder
      ) {
        throw new Error(
          'Event ID, date, and folder cannot change after the event is created. Start a new event instead.',
        );
      }
    }
    await atomicWriteJson(this.configPath, config);
    if (config.id && config.createdAt) {
      await mkdir(this.eventFolder(config), { recursive: true });
      await atomicWriteJson(path.join(this.eventFolder(config), 'event.json'), config);
    }
    return config;
  }

  async create(input: EventConfig) {
    const config = normalizeEventConfig(input, this.defaultBaseFolder);
    const issues = eventDraftIssues(config);
    if (issues.length) throw new Error(issues.join(' '));
    const folder = this.eventFolder(config);
    try {
      await access(path.join(folder, 'event.json'));
      throw new Error('That Event ID already exists. Choose a unique Event ID.');
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('That Event ID')) throw error;
    }
    const created = { ...config, createdAt: new Date().toISOString() };
    await mkdir(folder, { recursive: true });
    await atomicWriteJson(this.configPath, created);
    await atomicWriteJson(path.join(folder, 'event.json'), created);
    return created;
  }

  eventFolder(config: EventConfig) {
    return path.join(config.baseFolder, config.id);
  }

  async chooseFolder() {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  }

  async openFolder() {
    const config = requireEventId(await this.load());
    await mkdir(this.eventFolder(config), { recursive: true });
    const error = await shell.openPath(this.eventFolder(config));
    if (error) throw new Error(error);
  }

  async writable(config: EventConfig) {
    const folder = this.eventFolder(requireEventId(config));
    await mkdir(folder, { recursive: true });
    await access(folder, constants.W_OK);
    const probe = path.join(folder, `.write-test-${crypto.randomUUID()}`);
    const handle = await open(probe, 'wx');
    await handle.close();
    await rm(probe, { force: true });
    return true;
  }
}
