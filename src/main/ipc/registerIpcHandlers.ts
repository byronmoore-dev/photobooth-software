import { app, dialog, ipcMain } from 'electron';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { CameraAdapter } from '../camera/CameraAdapter';
import { CanonCameraAdapter } from '../camera/CanonCameraAdapter';
import { EventStorage } from '../storage/eventStorage';
import { SessionStorage } from '../storage/sessionStorage';
import { renderPhotoLayout } from '../layout/renderPhotoLayout';
import { WindowsPrinterAdapter } from '../printer/WindowsPrinterAdapter';
import { UploadQueue } from '../cloud/uploadQueue';
import { Logger } from '../logging/logger';
import { clampCopies, eventSetupIssues, isEventActive, normalizeLayoutConfig } from '../../shared/defaults';
import type { EventConfig, LayoutConfig, SessionMetadata } from '../../shared/types';

const imageDataUrl = async (file: string) => `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;
const validateJpeg = async (file: string) => {
  const metadata = await sharp(file).metadata();
  if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height)
    throw new Error('Camera returned an invalid JPEG');
};

export function registerIpcHandlers(owner: () => BrowserWindow | null, logger = new Logger()) {
  const events = new EventStorage();
  const sessions = new SessionStorage(events);
  const printer = new WindowsPrinterAdapter(owner);
  const uploads = new UploadQueue(sessions);
  const previewRoot = path.join(app.getPath('temp'), 'camera-booth-preview');
  const layoutAssetRoot = path.join(app.getPath('userData'), 'layout-assets');
  let camera: CameraAdapter | null = null;

  const railImagePath = (config: LayoutConfig) => {
    if (!config.railImageAssetId) return undefined;
    if (!/^[0-9a-f-]{36}$/i.test(config.railImageAssetId)) throw new Error('Invalid rail artwork identifier');
    return path.join(layoutAssetRoot, `${config.railImageAssetId}.png`);
  };

  const pruneOldPreviews = async (current: string) => {
    const cutoff = Date.now() - 30 * 60_000;
    const entries = await readdir(previewRoot, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const candidate = path.join(previewRoot, entry.name);
          if (candidate === current || path.dirname(candidate) !== previewRoot) return;
          const details = await stat(candidate).catch(() => null);
          if (details && details.mtimeMs < cutoff) await rm(candidate, { recursive: true, force: true });
        }),
    );
  };

  const getCamera = async () => {
    if (!camera) {
      camera = new CanonCameraAdapter();
      camera.setFrameHandler((frame) => owner()?.webContents.send('camera:frame', frame));
      camera.setStatusHandler((status) => owner()?.webContents.send('camera:statusChanged', status));
    }
    return camera;
  };

  const assertSender = (event: IpcMainInvokeEvent) => {
    if (event.sender.id !== owner()?.webContents.id) throw new Error('Rejected IPC call from an unknown renderer');
  };

  const channel = <T extends unknown[], R>(name: string, handler: (...args: T) => Promise<R>) => {
    ipcMain.handle(name, async (event, ...args: T) => {
      assertSender(event);
      try {
        return await handler(...args);
      } catch (error) {
        logger.error(`IPC ${name} failed`, error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  };

  const renderFinal = async (config: EventConfig, metadata: SessionMetadata) => {
    const output = sessions.finalPath(config, metadata.id);
    const temporary = sessions.temporaryFinalPath(config, metadata.id);
    await rm(temporary, { force: true });
    await renderPhotoLayout({
      photos: metadata.originalPaths,
      outputPath: temporary,
      config: config.layout,
      railImagePath: railImagePath(config.layout),
    });
    await validateJpeg(temporary);
    await rm(output, { force: true });
    await rename(temporary, output);
    return output;
  };

  const managedImagePath = (config: EventConfig, input: string) => {
    const candidate = path.resolve(input);
    const roots = [
      path.resolve(events.eventFolder(config)),
      path.resolve(path.join(app.getPath('temp'), 'camera-booth-preview')),
    ];
    if (!roots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`))) {
      throw new Error('Print path is outside Camera Booth storage');
    }
    return candidate;
  };

  channel('event:load', () => events.load());
  channel('event:save', async (config: EventConfig) => {
    const saved = await events.save(config);
    logger.info('Event settings saved', { eventId: saved.id });
    return saved;
  });
  channel('event:create', async (config: EventConfig) => {
    const created = await events.create(config);
    logger.info('Event created', { eventId: created.id, eventDate: created.eventDate });
    return created;
  });
  channel('event:chooseFolder', () => events.chooseFolder());
  channel('event:openFolder', () => events.openFolder());

  channel('camera:connect', async () => {
    const adapter = await getCamera();
    await adapter.connect();
    const status = await adapter.getStatus();
    logger.info('Camera connected', { productName: status.productName, firmware: status.firmware });
    return status;
  });
  channel('camera:disconnect', async () => {
    if (camera) await camera.disconnect();
  });
  channel('camera:startLiveView', async () => {
    const adapter = await getCamera();
    const frame = await adapter.startLiveView();
    return { status: await adapter.getStatus(), frame };
  });
  channel('camera:status', async () => (await getCamera()).getStatus());

  channel('session:create', async (test = false) => {
    const config = await events.load();
    if (!isEventActive(config)) throw new Error('Complete today’s event setup before starting a session.');
    const metadata = await sessions.create(config, Boolean(test));
    logger.info('Session created', { sessionId: metadata.id, test: metadata.test });
    return sessions.view(config, metadata);
  });
  channel('camera:capture', async (sessionId: string, index: number) => {
    if (!Number.isInteger(index) || index < 0 || index > 2) throw new Error('Invalid capture index');
    const config = await events.load();
    await sessions.get(config, sessionId);
    const destination = sessions.originalPath(config, sessionId, index);
    const temporary = sessions.temporaryOriginalPath(config, sessionId, index);
    await rm(temporary, { force: true });
    try {
      const photo = await (await getCamera()).capture(temporary);
      await validateJpeg(temporary);
      await rm(destination, { force: true });
      await rename(temporary, destination);
      await sessions.update(config, sessionId, (metadata) => {
        metadata.originalPaths[index] = destination;
        metadata.status = `original-${index + 1}-saved`;
        return metadata;
      });
      logger.info('Original captured', { sessionId, index: index + 1, flashFired: true });
      return { ...photo, path: destination };
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  });
  channel('session:get', async (id: string) => {
    const config = await events.load();
    return sessions.view(config, await sessions.get(config, id));
  });
  channel('session:render', async (id: string) => {
    const config = await events.load();
    let metadata = await sessions.get(config, id);
    if (metadata.originalPaths.filter(Boolean).length !== 3) throw new Error('Session does not contain 3 originals');
    metadata = await sessions.update(config, id, (current) => {
      current.status = 'processing';
      return current;
    });
    try {
      const finalPath = await renderFinal(config, metadata);
      metadata = await sessions.update(config, id, (current) => {
        current.finalPath = finalPath;
        current.status = 'ready';
        return current;
      });
      if (metadata.uploadEnabled) void uploads.enqueue(config, metadata);
      logger.info('Final layout rendered', { sessionId: id });
      return sessions.view(config, metadata);
    } catch (error) {
      await sessions.update(config, id, (current) => {
        current.status = 'render-error';
        current.errors.push({
          at: new Date().toISOString(),
          step: 'render',
          message: error instanceof Error ? error.message : String(error),
        });
        return current;
      });
      throw error;
    }
  });
  channel('session:recent', async () => {
    const config = await events.load();
    return Promise.all((await sessions.recent(config)).map((metadata) => sessions.summary(metadata)));
  });
  channel('session:recover', async () => {
    const config = await events.load();
    if (!config.id) return { recovered: 0, interrupted: 0, pendingUploads: 0 };
    const summary = await sessions.recover(config, validateJpeg, (metadata) => renderFinal(config, metadata));
    void uploads.retryPending(config);
    logger.info('Startup recovery completed', summary);
    return summary;
  });

  channel('printer:list', () => printer.listPrinters());
  channel('printer:print', async (id: string, copies: number) => {
    const config = await events.load();
    const metadata = await sessions.get(config, id);
    if (!metadata.finalPath) throw new Error('Final image is not ready');
    const safeCopies = clampCopies(copies, config.printer.maxCopies);
    const result = await printer.print({
      imagePath: metadata.finalPath,
      printerName: config.printer.name,
      copies: safeCopies,
      paperSize: config.printer.paperSize,
      orientation: config.printer.orientation,
    });
    await sessions.update(config, id, (current) => {
      current.requestedCopies = safeCopies;
      current.printStatus = result.submitted ? 'submitted' : 'error';
      current.status = result.submitted ? 'complete' : 'print-error';
      if (!result.submitted)
        current.errors.push({ at: new Date().toISOString(), step: 'print', message: result.message });
      return current;
    });
    logger.info('Print request completed', { sessionId: id, submitted: result.submitted, copies: safeCopies });
    return result;
  });
  channel('printer:testPrint', async (imagePath: string) => {
    const config = await events.load();
    return printer.testPrint({
      imagePath: managedImagePath(config, imagePath),
      printerName: config.printer.name,
      paperSize: config.printer.paperSize,
      orientation: config.printer.orientation,
    });
  });

  channel('layout:preview', async (input: LayoutConfig) => {
    const config = normalizeLayoutConfig(input);
    await mkdir(previewRoot, { recursive: true });
    const previewDirectory = await mkdtemp(path.join(previewRoot, 'render-'));
    const photos: string[] = [];
    const colors = [
      ['#c9b8a3', '#6f6258'],
      ['#b9aaa0', '#4f4945'],
      ['#c7beb4', '#5b544d'],
    ];
    for (let index = 0; index < 3; index++) {
      const file = path.join(previewDirectory, `sample-${index}.jpg`);
      const [start, end] = colors[index];
      const svg = Buffer.from(
        `<svg width="1600" height="1100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="800" cy="420" r="220" fill="#ead6c2"/><path d="M400 1100 Q800 580 1200 1100" fill="#f6f2ec"/><text x="70" y="1000" fill="white" font-size="64" font-family="Arial">PREVIEW ${index + 1}</text></svg>`,
      );
      await sharp(svg).jpeg({ quality: 90 }).toFile(file);
      photos.push(file);
    }
    const outputPath = path.join(previewDirectory, 'layout-preview.jpg');
    await renderPhotoLayout({ photos, outputPath, config, railImagePath: railImagePath(config) });
    const result = { path: outputPath, dataUrl: await imageDataUrl(outputPath) };
    void pruneOldPreviews(previewDirectory);
    return result;
  });

  channel('layout:chooseRailImage', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Rail Artwork',
      properties: ['openFile'],
      filters: [{ name: 'PNG artwork', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const metadata = await sharp(source).metadata();
    if (metadata.format !== 'png' || !metadata.width || !metadata.height) {
      throw new Error('Choose a valid PNG image for the print rail.');
    }
    if (metadata.width < 300 || metadata.height < 1200) {
      throw new Error('Rail artwork must be at least 300 × 1200 pixels.');
    }
    const assetId = crypto.randomUUID();
    await mkdir(layoutAssetRoot, { recursive: true });
    await sharp(source)
      .rotate()
      .png()
      .toFile(path.join(layoutAssetRoot, `${assetId}.png`));
    logger.info('Rail artwork imported', { assetId, name: path.basename(source) });
    return { assetId, name: path.basename(source) };
  });

  channel('diagnostics:run', async () => {
    const config = await events.load();
    if (!isEventActive(config)) {
      return [{ label: 'Event setup', status: 'fail' as const, detail: eventSetupIssues(config).join(' ') }];
    }
    const results: Array<{ label: string; status: 'pass' | 'warning' | 'fail'; detail: string }> = [];
    try {
      await events.writable(config);
      results.push({
        label: 'Local storage',
        status: 'pass',
        detail: 'A test file was written and removed successfully.',
      });
    } catch (error) {
      results.push({
        label: 'Local storage',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      const disk = await statfs(config.baseFolder);
      const gigabytes = Number(disk.bavail * disk.bsize) / 1024 ** 3;
      results.push({
        label: 'Disk space',
        status: gigabytes < 5 ? 'warning' : 'pass',
        detail: `${gigabytes.toFixed(1)} GB available`,
      });
    } catch {
      results.push({ label: 'Disk space', status: 'warning', detail: 'Available disk space could not be read.' });
    }
    let diagnosticPhoto = '';
    try {
      const adapter = await getCamera();
      await adapter.connect();
      await adapter.startLiveView();
      const status = await adapter.getStatus();
      results.push({ label: 'Camera & live view', status: 'pass', detail: status.message });
      results.push({
        label: 'Camera power',
        status: 'warning',
        detail: 'Use Canon ACK-E18 AC power for event-length operation; USB does not power the T6i.',
      });
      const folder = path.join(events.eventFolder(config), 'diagnostics');
      await mkdir(folder, { recursive: true });
      diagnosticPhoto = path.join(folder, 'test-capture.jpg');
      await adapter.capture(diagnosticPhoto);
      await validateJpeg(diagnosticPhoto);
      results.push({ label: 'Test capture', status: 'pass', detail: 'A valid JPEG was downloaded from the camera.' });
    } catch (error) {
      results.push({ label: 'Camera', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
    }
    if (diagnosticPhoto) {
      try {
        const output = path.join(events.eventFolder(config), 'diagnostics', 'test-layout.jpg');
        await renderPhotoLayout({
          photos: [diagnosticPhoto, diagnosticPhoto, diagnosticPhoto],
          outputPath: output,
          config: config.layout,
          railImagePath: railImagePath(config.layout),
        });
        await validateJpeg(output);
        results.push({
          label: 'Layout renderer',
          status: 'pass',
          detail: 'The production JPEG layout rendered successfully.',
        });
      } catch (error) {
        results.push({
          label: 'Layout renderer',
          status: 'fail',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const printers = await printer.listPrinters();
    const printerReady = config.printer.name
      ? printers.some((item) => item.name === config.printer.name)
      : printers.length > 0;
    results.push({
      label: 'Windows printer',
      status: printerReady ? 'pass' : 'warning',
      detail: printerReady
        ? config.printer.name || 'Windows default printer'
        : 'Choose an available printer before the event.',
    });
    const pending = (await sessions.all(config)).filter(
      (item) => item.uploadEnabled && item.uploadStatus !== 'complete',
    ).length;
    results.push({
      label: 'Pending uploads',
      status: pending ? 'warning' : 'pass',
      detail: pending ? `${pending} session${pending === 1 ? '' : 's'} waiting` : 'No uploads waiting',
    });
    if (config.sharing.enabled) {
      results.push({
        label: 'S3 upload service',
        status: config.sharing.uploadEndpoint ? 'pass' : 'warning',
        detail: config.sharing.uploadEndpoint ? 'Presigned-upload service configured' : 'Add an upload service URL.',
      });
      results.push({
        label: 'Supabase',
        status: config.sharing.supabaseUrl ? 'pass' : 'warning',
        detail: config.sharing.supabaseUrl ? 'Project URL configured' : 'Add a Supabase project URL.',
      });
      try {
        const origin = new URL(config.sharing.uploadEndpoint).origin;
        await fetch(origin, { method: 'HEAD', signal: AbortSignal.timeout(5_000) });
        results.push({ label: 'Internet', status: 'pass', detail: 'The upload service is reachable.' });
      } catch {
        results.push({
          label: 'Internet',
          status: 'warning',
          detail: 'Cloud service is unavailable; offline capture and printing still work.',
        });
      }
    } else {
      results.push({ label: 'Cloud sharing', status: 'pass', detail: 'Disabled — offline mode ready' });
    }
    return results;
  });

  channel('upload:retryPending', async () => uploads.retryPending(await events.load()));
  channel('system:getVersion', async () => app.getVersion());
  channel('system:setKiosk', async (enabled: boolean) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid kiosk setting');
    const window = owner();
    if (!window) return false;
    window.setKiosk(enabled);
    return window.isKiosk();
  });
  channel('system:logs', () => logger.readRecent());

  return async () => {
    if (camera) await camera.disconnect();
  };
}
