import { app, BrowserWindow, powerSaveBlocker, session } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc/registerIpcHandlers';
import { Logger } from './logging/logger';

let mainWindow: BrowserWindow | null = null;
let blocker: number | null = null;
let cleanup: (() => Promise<void>) | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const logger = new Logger();
    process.on('uncaughtException', (error) =>
      logger.error('Uncaught main-process exception', error.stack ?? error.message),
    );
    process.on('unhandledRejection', (reason) => logger.error('Unhandled main-process rejection', String(reason)));
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 1100,
      minHeight: 720,
      backgroundColor: '#f3f2ef',
      autoHideMenuBar: true,
      fullscreenable: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    mainWindow.setMenu(null);
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    mainWindow.webContents.on('render-process-gone', (_event, details) =>
      logger.error('Renderer process exited', details),
    );
    mainWindow.on('unresponsive', () => logger.warn('Main window became unresponsive'));
    cleanup = registerIpcHandlers(() => mainWindow, logger);
    blocker = powerSaveBlocker.start('prevent-display-sleep');

    if (process.env.VITE_DEV_SERVER_URL) {
      await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      await mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
    }
    logger.info('Application started', { version: app.getVersion(), packaged: app.isPackaged });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (blocker !== null && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    if (cleanup) void cleanup();
  });
}
