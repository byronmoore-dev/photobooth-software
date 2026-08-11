import { contextBridge, ipcRenderer } from 'electron';
import type { BoothApi } from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;
const api: BoothApi = {
  event: {
    load: () => invoke('event:load'),
    save: (c) => invoke('event:save', c),
    create: (c) => invoke('event:create', c),
    chooseFolder: () => invoke('event:chooseFolder'),
    openFolder: () => invoke('event:openFolder'),
  },
  camera: {
    connect: () => invoke('camera:connect'),
    disconnect: () => invoke('camera:disconnect'),
    startLiveView: () => invoke('camera:startLiveView'),
    autofocus: () => invoke('camera:autofocus'),
    capture: (id, index) => invoke('camera:capture', id, index),
    status: () => invoke('camera:status'),
    onFrame: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, frame: string) => callback(frame);
      ipcRenderer.on('camera:frame', listener);
      return () => ipcRenderer.removeListener('camera:frame', listener);
    },
    onStatus: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status);
      ipcRenderer.on('camera:statusChanged', listener);
      return () => ipcRenderer.removeListener('camera:statusChanged', listener);
    },
  },
  session: {
    create: (test) => invoke('session:create', test),
    get: (id) => invoke('session:get', id),
    startVideo: (id) => invoke('session:startVideo', id),
    stopVideo: (id) => invoke('session:stopVideo', id),
    startExternalVideo: (id, mimeType, startedAt) => invoke('session:startExternalVideo', id, mimeType, startedAt),
    appendExternalVideo: (id, chunk) => invoke('session:appendExternalVideo', id, chunk),
    stopExternalVideo: (id, endedAt) => invoke('session:stopExternalVideo', id, endedAt),
    failVideo: (id, message) => invoke('session:failVideo', id, message),
    retryRecap: (id) => invoke('session:retryRecap', id),
    render: (id) => invoke('session:render', id),
    recent: () => invoke('session:recent'),
    recover: () => invoke('session:recover'),
  },
  printer: {
    list: () => invoke('printer:list'),
    print: (id, copies) => invoke('printer:print', id, copies),
    testPrint: (path) => invoke('printer:testPrint', path),
    testConnection: () => invoke('printer:testConnection'),
  },
  layout: {
    preview: (config) => invoke('layout:preview', config),
    chooseRailImage: (config) => invoke('layout:chooseRailImage', config),
  },
  diagnostics: { run: () => invoke('diagnostics:run') },
  upload: { retryPending: () => invoke('upload:retryPending') },
  system: {
    getVersion: () => invoke('system:getVersion'),
    setKiosk: (enabled) => invoke('system:setKiosk', enabled),
    showTouchKeyboard: () => invoke('system:showTouchKeyboard'),
    logs: () => invoke('system:logs'),
  },
};
contextBridge.exposeInMainWorld('booth', api);
