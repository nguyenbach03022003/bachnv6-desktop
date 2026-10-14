import path from 'node:path';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, clipboard, ipcMain, session } from 'electron';
import type { WindowState } from './shared/desktop-api';
import { registerTerminalIpc } from './terminal-service';
import { registerNotesIpc } from './notes-service';
import { registerSystemMetricsIpc } from './system-metrics-service';
import { registerWeatherIpc } from './weather-service';
import { registerCodexUsageIpc } from './codex-usage-service';
import { registerTranslationIpc } from './translation-service';
import { registerVocabularyIpc } from './vocabulary-service';
import { registerNotesWindows } from './notes-windows';
import { registerCompanionIpc } from './companion-service';
import { registerAiSettingsIpc } from './ai-settings-service';
import { registerAiCliLifecycle } from './ai-cli';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// Squirrel launches the app with one of these flags during install/update/removal.
// Keep this small handler in the main bundle so packaged startup has no external
// Node dependency to resolve before the dashboard can open.
function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;

  const event = process.argv[1];
  if (event === '--squirrel-obsolete') {
    app.quit();
    return true;
  }

  const target = path.basename(process.execPath);
  let updateArgument: string;
  if (event === '--squirrel-install' || event === '--squirrel-updated') {
    updateArgument = `--createShortcut=${target}`;
  } else if (event === '--squirrel-uninstall') {
    updateArgument = `--removeShortcut=${target}`;
  } else {
    return false;
  }

  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const child = spawn(updateExe, [updateArgument], { detached: true, stdio: 'ignore' });
  child.once('error', (error) => {
    console.error('Could not complete Squirrel startup event', error);
    app.quit();
  });
  child.once('close', () => app.quit());
  return true;
}

const handlingSquirrelEvent = handleSquirrelEvent();

let mainWindow: BrowserWindow | null = null;

function loadRenderer(window: BrowserWindow, view?: 'notes' | 'image'): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    if (view) url.hash = view;
    return window.loadURL(url.toString());
  }
  return window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    view ? { hash: view } : {});
}

function getWindowState(window: BrowserWindow): WindowState {
  return {
    maximized: window.isMaximized(),
    alwaysOnTop: window.isAlwaysOnTop(),
  };
}

function sendWindowState(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    window.webContents.send('window:state-changed', getWindowState(window));
  }
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1320,
    height: 800,
    minWidth: 980,
    minHeight: 660,
    show: true,
    frame: false,
    backgroundColor: '#0b1019',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;
  window.on('maximize', () => sendWindowState(window));
  window.on('unmaximize', () => sendWindowState(window));
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  void loadRenderer(window).catch((error: unknown) => {
    console.error('Could not load dashboard', error);
  });
}

if (!handlingSquirrelEvent) app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  registerAiSettingsIpc(() => mainWindow);
  registerAiCliLifecycle();
  const companion = registerCompanionIpc(() => mainWindow);
  registerTerminalIpc(() => mainWindow, companion.trackTerminal);
  const notes = registerNotesIpc(() => notesWindows.getEditorWindow());
  const notesWindows = registerNotesWindows(() => mainWindow, loadRenderer, notes.readImage, createMainWindow);
  registerVocabularyIpc(() => notesWindows.getEditorWindow());
  registerSystemMetricsIpc(() => mainWindow);
  registerWeatherIpc(() => mainWindow);
  registerCodexUsageIpc(() => mainWindow);
  registerTranslationIpc(() => mainWindow);

  ipcMain.handle('terminal:clipboard-read', async (event) => {
    const window = mainWindow;
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown window');
    const value = await clipboard.readText();
    if (Buffer.byteLength(value, 'utf8') > 2 * 1024 * 1024) throw new Error('Clipboard text is too large to paste');
    return value;
  });
  ipcMain.handle('terminal:clipboard-write', async (event, value: unknown) => {
    const window = mainWindow;
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown window');
    if (typeof value !== 'string' || value.length > 2 * 1024 * 1024) throw new Error('Clipboard text is too large');
    await clipboard.writeText(value);
  });

  ipcMain.handle('window:state', (event) => {
    const window = [mainWindow, ...notesWindows.getAuxiliaryWindows()].find((candidate) => candidate
      && !candidate.isDestroyed() && event.sender === candidate.webContents
      && event.senderFrame === candidate.webContents.mainFrame);
    if (!window) throw new Error('Unknown window');
    return getWindowState(window);
  });

  ipcMain.handle('window:action', (event, action: unknown) => {
    const window = [mainWindow, ...notesWindows.getAuxiliaryWindows()].find((candidate) => candidate
      && !candidate.isDestroyed() && event.sender === candidate.webContents
      && event.senderFrame === candidate.webContents.mainFrame);
    if (!window) throw new Error('Unknown window');
    switch (action) {
      case 'minimize':
        window.minimize();
        break;
      case 'toggle-maximize':
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        break;
      case 'toggle-always-on-top':
        window.setAlwaysOnTop(!window.isAlwaysOnTop());
        break;
      case 'close':
        const closingState = getWindowState(window);
        window.close();
        return closingState;
      default:
        throw new Error('Unsupported window action');
    }
    sendWindowState(window);
    return getWindowState(window);
  });

  createMainWindow();
});

app.on('window-all-closed', () => app.quit());
