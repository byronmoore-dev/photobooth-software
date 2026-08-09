import { copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const temporaryPath = (target: string) => `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;

async function atomicWriteFile(target: string, contents: string | Buffer) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = temporaryPath(target);
  const backup = `${target}.bak`;
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await copyFile(target, backup);
  } catch {
    // A first write has no source file to back up.
  }

  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function atomicWriteJson(target: string, value: unknown) {
  await atomicWriteFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonWithBackup<T>(target: string): Promise<T> {
  try {
    return JSON.parse(await readFile(target, 'utf8')) as T;
  } catch (primaryError) {
    try {
      return JSON.parse(await readFile(`${target}.bak`, 'utf8')) as T;
    } catch {
      throw primaryError;
    }
  }
}
