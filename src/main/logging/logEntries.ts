import type { LogEntry } from '../../shared/types';

const isLevel = (value: unknown): value is LogEntry['level'] =>
  value === 'info' || value === 'warn' || value === 'error';

export function parseLogEntries(contents: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (
        typeof parsed.at !== 'string' ||
        Number.isNaN(Date.parse(parsed.at)) ||
        !isLevel(parsed.level) ||
        typeof parsed.message !== 'string'
      ) {
        continue;
      }
      entries.push({ at: parsed.at, level: parsed.level, message: parsed.message, details: parsed.details });
    } catch {
      // A partial final line can remain after a hard power loss.
    }
  }
  return entries;
}
