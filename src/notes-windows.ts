import path from 'node:path';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { NotesContext, NotesWorkspaceState } from './shared/notes-workspace-types';

export function registerNotesWindows(
  getDashboard: () => BrowserWindow | null,
  loadRenderer: (window: BrowserWindow, view: 'notes' | 'image') => Promise<void>,
  readImage: (noteId: unknown, attachmentId: unknown) => Promise<{ name: string; source: string }>,
  createDashboard: () => void,
) {
  let notesWindow: BrowserWindow | null = null;
  let context: NotesContext = { selectedId: null, space: 'notes' };
  const images = new Map<BrowserWindow, { key: string; name: string; source: string }>();

  const getEditorWindow = () => notesWindow ?? getDashboard();
  const getAuxiliaryWindows = () => [...(notesWindow ? [notesWindow] : []), ...images.keys()];
  const state = (): NotesWorkspaceState => ({ ...context, detached: notesWindow !== null });

  function assertSender(event: IpcMainInvokeEvent, windows: Array<BrowserWindow | null>): BrowserWindow {
    const window = windows.find((candidate) => candidate && !candidate.isDestroyed()
      && event.sender === candidate.webContents && event.senderFrame === candidate.webContents.mainFrame);
    if (!window) throw new Error('Unknown window');
    return window;
  }

  function parseContext(raw: unknown): NotesContext {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid notes context');
    const value = raw as Record<string, unknown>;
    if ((value.selectedId !== null && (typeof value.selectedId !== 'string' || !/^[\da-f-]{36}$/.test(value.selectedId)))
      || (value.space !== 'notes' && value.space !== 'vocabulary')) throw new Error('Invalid notes context');
    return { selectedId: value.selectedId as string | null, space: value.space };
  }

  function notify() {
    for (const window of [getDashboard(), notesWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send('notes-workspace:changed', state());
    }
  }

  function createWindow(title: string, width: number, height: number) {
    const window = new BrowserWindow({
      title, width, height, minWidth: 420, minHeight: 360, show: false,
      backgroundColor: '#0b1019', autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.once('ready-to-show', () => window.show());
    return window;
  }

  ipcMain.handle('notes-workspace:state', (event) => {
    assertSender(event, [getDashboard(), notesWindow]);
    return state();
  });
  ipcMain.handle('notes-workspace:context', (event, raw: unknown) => {
    assertSender(event, [getEditorWindow()]);
    context = parseContext(raw);
  });
  ipcMain.handle('notes-workspace:detach', async (event, raw: unknown) => {
    assertSender(event, [getDashboard()]);
    if (notesWindow) { notesWindow.focus(); return; }
    context = parseContext(raw);
    const window = createWindow('Notes — Bachnv6 Desktop', 760, 820);
    notesWindow = window;
    window.once('closed', () => {
      if (notesWindow === window) {
        notesWindow = null;
        notify();
      }
    });
    notify();
    try {
      await loadRenderer(window, 'notes');
    } catch (error) {
      window.destroy();
      throw error;
    }
  });
  ipcMain.handle('notes-workspace:merge', (event) => {
    assertSender(event, [getDashboard(), notesWindow]);
    if (!getDashboard()) createDashboard();
    // The editor handles this request so unsaved text is flushed before closing.
    if (notesWindow?.isMinimized()) notesWindow.restore();
    notesWindow?.focus();
    notesWindow?.webContents.send('notes-workspace:merge-requested');
  });
  ipcMain.handle('notes-workspace:focus', (event) => {
    assertSender(event, [getDashboard(), notesWindow]);
    if (notesWindow?.isMinimized()) notesWindow.restore();
    notesWindow?.focus();
  });
  ipcMain.handle('notes-workspace:open-image', async (event, noteId: unknown, attachmentId: unknown) => {
    assertSender(event, [getEditorWindow()]);
    const key = `${noteId}:${attachmentId}`;
    const existing = [...images].find(([, image]) => image.key === key)?.[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return;
    }
    const image = await readImage(noteId, attachmentId);
    assertSender(event, [getEditorWindow()]);
    const opened = [...images].find(([, value]) => value.key === key)?.[0];
    if (opened) { opened.focus(); return; }
    if (images.size >= 8) throw new Error('Close an image window before opening another.');
    const window = createWindow(image.name, 1000, 760);
    images.set(window, { key, ...image });
    window.once('closed', () => images.delete(window));
    try { await loadRenderer(window, 'image'); }
    catch (error) { window.destroy(); throw error; }
  });
  ipcMain.handle('notes-workspace:image', (event) => {
    const window = assertSender(event, [...images.keys()]);
    const image = images.get(window)!;
    return { name: image.name, source: image.source };
  });

  return { getEditorWindow, getAuxiliaryWindows };
}
