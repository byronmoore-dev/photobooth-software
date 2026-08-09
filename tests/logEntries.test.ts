import { describe, expect, it } from 'vitest';
import { parseLogEntries } from '../src/main/logging/logEntries';

describe('log entry parsing', () => {
  it('returns valid structured entries', () => {
    const entries = parseLogEntries(
      `${JSON.stringify({ at: '2026-08-07T10:00:00.000Z', level: 'info', message: 'Ready', details: { count: 3 } })}\n`,
    );
    expect(entries).toEqual([
      { at: '2026-08-07T10:00:00.000Z', level: 'info', message: 'Ready', details: { count: 3 } },
    ]);
  });

  it('ignores a partial crash line without losing earlier entries', () => {
    const contents = `${JSON.stringify({ at: '2026-08-07T10:00:00.000Z', level: 'error', message: 'Camera stopped' })}\n{"at":`;
    expect(parseLogEntries(contents)).toHaveLength(1);
  });

  it('rejects malformed severity and timestamps', () => {
    expect(
      parseLogEntries(
        `${JSON.stringify({ at: 'not-a-date', level: 'info', message: 'Bad date' })}\n${JSON.stringify({ at: '2026-08-07T10:00:00.000Z', level: 'debug', message: 'Bad level' })}`,
      ),
    ).toEqual([]);
  });
});
