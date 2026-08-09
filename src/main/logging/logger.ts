import { app } from 'electron';
import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseLogEntries } from './logEntries';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export class Logger {
  readonly folder = path.join(app.getPath('userData'), 'logs');
  readonly file = path.join(this.folder, 'camera-booth.log');
  private queue = Promise.resolve();

  write(level: 'info' | 'warn' | 'error', message: string, details?: unknown) {
    const entry = `${JSON.stringify({ at: new Date().toISOString(), level, message, details })}\n`;
    this.queue = this.queue
      .then(async () => {
        await mkdir(this.folder, { recursive: true });
        try {
          if ((await stat(this.file)).size >= MAX_LOG_BYTES) {
            await rm(`${this.file}.1`, { force: true });
            await rename(this.file, `${this.file}.1`);
          }
        } catch {
          // The log file does not exist yet.
        }
        await appendFile(this.file, entry, 'utf8');
      })
      .catch(() => undefined);
  }

  info(message: string, details?: unknown) {
    this.write('info', message, details);
  }
  warn(message: string, details?: unknown) {
    this.write('warn', message, details);
  }
  error(message: string, details?: unknown) {
    this.write('error', message, details);
  }

  async readRecent(limit = 200) {
    await this.queue;
    const contents = await Promise.all(
      [`${this.file}.1`, this.file].map((file) => readFile(file, 'utf8').catch(() => '')),
    );
    return parseLogEntries(contents.join('\n'))
      .slice(-Math.max(1, Math.min(500, limit)))
      .reverse();
  }
}
