import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, WindowState } from './shared/desktop-api';
import type { NotePatch } from './shared/notes-types';
import type { SystemMetricsSample } from './shared/system-metrics-types';
import type { NotesWorkspaceState } from './shared/notes-workspace-types';
import type { CompanionSnapshot } from './shared/companion-types';
import type { AiSettings } from './shared/ai-settings-types';
import type { TerminalSessionsSnapshot } from './shared/terminal-types';

type WindowAction = 'minimize' | 'toggle-maximize' | 'toggle-always-on-top' | 'close';

function runWindowAction(action: WindowAction): Promise<WindowState> {
  return ipcRenderer.invoke('window:action', action);
}

const desktopApi: DesktopApi = {
  aiSettings: {
    get: () => ipcRenderer.invoke('ai-settings:get'),
    save: (settings) => ipcRenderer.invoke('ai-settings:save', settings),
    check: (settings) => ipcRenderer.invoke('ai-settings:check', settings),
    pickExecutable: () => ipcRenderer.invoke('ai-settings:pick'),
    onChanged: (listener) => {
      const callback = (_event: Electron.IpcRendererEvent, settings: AiSettings) => listener(settings);
      ipcRenderer.on('ai-settings:changed', callback);
      return () => ipcRenderer.removeListener('ai-settings:changed', callback);
    },
  },
  minimize: () => runWindowAction('minimize'),
  toggleMaximize: () => runWindowAction('toggle-maximize'),
  toggleAlwaysOnTop: () => runWindowAction('toggle-always-on-top'),
  close: async () => {
    await runWindowAction('close');
  },
  getWindowState: () => ipcRenderer.invoke('window:state'),
  onWindowStateChanged: (listener) => {
    const callback = (_event: Electron.IpcRendererEvent, state: WindowState) => listener(state);
    ipcRenderer.on('window:state-changed', callback);
    return () => ipcRenderer.removeListener('window:state-changed', callback);
  },
  createTerminal: (cols, rows, options) => ipcRenderer.invoke('terminal:create', { cols, rows, ...options }),
  sessions: {
    list: () => ipcRenderer.invoke('terminal-sessions:list'),
    read: (id) => ipcRenderer.invoke('terminal-sessions:read', id),
    connect: (id, ai) => ipcRenderer.invoke('terminal-sessions:connect', id, ai),
    remove: (id) => ipcRenderer.invoke('terminal-sessions:remove', id),
    onUpdate: (listener) => {
      const callback = (_event: Electron.IpcRendererEvent, snapshot: TerminalSessionsSnapshot) => listener(snapshot);
      ipcRenderer.on('terminal-sessions:update', callback);
      return () => ipcRenderer.removeListener('terminal-sessions:update', callback);
    },
  },
  writeTerminal: async (id, data) => { await ipcRenderer.invoke('terminal:write', { id, data }); },
  resizeTerminal: async (id, cols, rows) => { await ipcRenderer.invoke('terminal:resize', { id, cols, rows }); },
  closeTerminal: async (id) => { await ipcRenderer.invoke('terminal:close', { id }); },
  onTerminalData: (listener) => {
    const callback = (_event: Electron.IpcRendererEvent, message: { id: string; data: string }) => listener(message);
    ipcRenderer.on('terminal:data', callback);
    return () => ipcRenderer.removeListener('terminal:data', callback);
  },
  onTerminalExit: (listener) => {
    const callback = (_event: Electron.IpcRendererEvent, message: { id: string; exitCode: number; signal: number | null }) => listener(message);
    ipcRenderer.on('terminal:exit', callback);
    return () => ipcRenderer.removeListener('terminal:exit', callback);
  },
  readTerminalClipboard: () => ipcRenderer.invoke('terminal:clipboard-read'),
  writeTerminalClipboard: async (text) => { await ipcRenderer.invoke('terminal:clipboard-write', text); },
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    create: () => ipcRenderer.invoke('notes:create'),
    update: (id: string, patch: NotePatch) => ipcRenderer.invoke('notes:update', id, patch),
    remove: async (id: string) => { await ipcRenderer.invoke('notes:delete', id); },
    pickAttachment: (id: string) => ipcRenderer.invoke('notes:pick-attachment', id),
    readAttachment: (id: string, attachmentId: string) => ipcRenderer.invoke('notes:read-attachment', id, attachmentId),
    removeAttachment: async (id: string, attachmentId: string) => {
      await ipcRenderer.invoke('notes:remove-attachment', id, attachmentId);
    },
  },
  companion: {
    get: () => ipcRenderer.invoke('companion:get'),
    chat: (text) => ipcRenderer.invoke('companion:chat', text),
    cancel: () => ipcRenderer.invoke('companion:cancel'),
    clearChat: () => ipcRenderer.invoke('companion:clear-chat'),
    saveReport: (report) => ipcRenderer.invoke('companion:report', report),
    labelTerminal: (id, name) => ipcRenderer.invoke('companion:label', id, name),
    onUpdate: (listener) => {
      const callback = (_event: Electron.IpcRendererEvent, snapshot: CompanionSnapshot) => listener(snapshot);
      ipcRenderer.on('companion:update', callback);
      return () => ipcRenderer.removeListener('companion:update', callback);
    },
  },
  notesWorkspace: {
    getState: () => ipcRenderer.invoke('notes-workspace:state'),
    detach: (context) => ipcRenderer.invoke('notes-workspace:detach', context),
    merge: () => ipcRenderer.invoke('notes-workspace:merge'),
    focus: () => ipcRenderer.invoke('notes-workspace:focus'),
    setContext: (context) => ipcRenderer.invoke('notes-workspace:context', context),
    onStateChanged: (listener) => {
      const callback = (_event: Electron.IpcRendererEvent, state: NotesWorkspaceState) => listener(state);
      ipcRenderer.on('notes-workspace:changed', callback);
      return () => ipcRenderer.removeListener('notes-workspace:changed', callback);
    },
    onMergeRequested: (listener) => {
      const callback = () => listener();
      ipcRenderer.on('notes-workspace:merge-requested', callback);
      return () => ipcRenderer.removeListener('notes-workspace:merge-requested', callback);
    },
    openImage: (noteId, attachmentId) => ipcRenderer.invoke('notes-workspace:open-image', noteId, attachmentId),
    getImage: () => ipcRenderer.invoke('notes-workspace:image'),
  },
  vocabulary: {
    list: () => ipcRenderer.invoke('vocabulary:list'),
    generate: (input) => ipcRenderer.invoke('vocabulary:generate', input),
    review: (id, remembered) => ipcRenderer.invoke('vocabulary:review', id, remembered),
    remove: async (id) => { await ipcRenderer.invoke('vocabulary:delete', id); },
  },
  metrics: {
    start: () => ipcRenderer.invoke('metrics:start'),
    latest: () => ipcRenderer.invoke('metrics:latest'),
    stop: async () => { await ipcRenderer.invoke('metrics:stop'); },
    onUpdate: (listener) => {
      const callback = (_event: Electron.IpcRendererEvent, sample: SystemMetricsSample) => listener(sample);
      ipcRenderer.on('metrics:update', callback);
      return () => ipcRenderer.removeListener('metrics:update', callback);
    },
  },
  weather: {
    get: () => ipcRenderer.invoke('weather:get'),
    refresh: () => ipcRenderer.invoke('weather:refresh'),
    search: (query) => ipcRenderer.invoke('weather:search', query),
    setLocation: (location) => ipcRenderer.invoke('weather:set-location', location),
  },
  usage: {
    get: () => ipcRenderer.invoke('usage:get'),
    refresh: () => ipcRenderer.invoke('usage:refresh'),
    useReset: (creditId) => ipcRenderer.invoke('usage:use-reset', creditId),
  },
  translation: {
    translate: (text, sourceLanguage) => ipcRenderer.invoke('translation:translate', text, sourceLanguage),
    openGoogle: async (text, sourceLanguage) => { await ipcRenderer.invoke('translation:open-google', text, sourceLanguage); },
  },
};

contextBridge.exposeInMainWorld('dashboard', desktopApi);
