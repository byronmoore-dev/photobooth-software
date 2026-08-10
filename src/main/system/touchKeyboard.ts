import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

interface TouchKeyboardOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  canAccess?: (file: string) => Promise<unknown>;
  launch?: (file: string) => void;
}

export const windowsTouchKeyboardCandidates = (environment: NodeJS.ProcessEnv = process.env) => {
  const commonFolders = [
    environment.CommonProgramW6432,
    environment.CommonProgramFiles,
    environment['CommonProgramFiles(x86)'],
    environment.ProgramFiles ? path.join(environment.ProgramFiles, 'Common Files') : undefined,
    'C:\\Program Files\\Common Files',
  ].filter((folder): folder is string => Boolean(folder));

  const unique = new Map<string, string>();
  for (const folder of commonFolders) {
    const candidate = path.join(folder, 'microsoft shared', 'ink', 'TabTip.exe');
    unique.set(candidate.toLowerCase(), candidate);
  }
  return [...unique.values()];
};

const launchDetached = (file: string) => {
  const child = spawn(file, [], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
};

export async function showWindowsTouchKeyboard(options: TouchKeyboardOptions = {}) {
  if ((options.platform ?? process.platform) !== 'win32') return false;
  const canAccess = options.canAccess ?? access;
  const launch = options.launch ?? launchDetached;

  for (const candidate of windowsTouchKeyboardCandidates(options.environment)) {
    try {
      await canAccess(candidate);
      launch(candidate);
      return true;
    } catch {
      // Try the next Windows installation path.
    }
  }
  return false;
}
