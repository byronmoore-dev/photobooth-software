import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWriteJson, readJsonWithBackup } from '../src/main/storage/atomicFile';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('atomic JSON storage', () => {
  it('keeps valid JSON and a recoverable previous version', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'camera-booth-atomic-'));
    folders.push(folder);
    const target = path.join(folder, 'state.json');
    await atomicWriteJson(target, { version: 1 });
    await atomicWriteJson(target, { version: 2 });
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ version: 2 });
    await writeFile(target, '{incomplete');
    await expect(readJsonWithBackup(target)).resolves.toEqual({ version: 1 });
  });
});
