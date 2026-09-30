import { randomUUID } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import * as pty from 'node-pty';

const MAX_SESSIONS = 8;
const MAX_WRITE_BYTES = 64 * 1024;
const MAX_OUTPUT_EVENT_CHARS = 16 * 1024;
const MIN_COLS = 2;
const MAX_COLS = 500;
const MIN_ROWS = 1;
const MAX_ROWS = 200;

interface TerminalSize {
  cols: number;
  rows: number;
}

interface TerminalSessionRequest {
  id: string;
}

interface TerminalWriteRequest extends TerminalSessionRequest {
  data: string;
}

interface TerminalResizeRequest extends TerminalSessionRequest, TerminalSize {}

interface TerminalSession {
  owner: WebContents;
  process: pty.IPty;
  dataSubscription: pty.IDisposable;
  exitSubscription: pty.IDisposable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSize(value: unknown): TerminalSize {
  if (!isRecord(value)
    || !Number.isInteger(value.cols) || (value.cols as number) < MIN_COLS || (value.cols as number) > MAX_COLS
    || !Number.isInteger(value.rows) || (value.rows as number) < MIN_ROWS || (value.rows as number) > MAX_ROWS) {
    throw new Error('Invalid terminal size');
  }
  return { cols: value.cols as number, rows: value.rows as number };
}

function validateId(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[\da-f-]{36}$/.test(value.id)) {
    throw new Error('Invalid terminal session');
  }
  return value.id;
}

function validateWrite(value: unknown): TerminalWriteRequest {
  const id = validateId(value);
  const data = (value as Record<string, unknown>).data;
  if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_WRITE_BYTES) {
    throw new Error('Invalid terminal input');
  }
  return { id, data };
}

function validateResize(value: unknown): TerminalResizeRequest {
  return { id: validateId(value), ...validateSize(value) };
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function findOnPath(executable: string): string | null {
  // Windows environment keys are case insensitive but process.env preserves the
  // original spelling inherited from the launcher.
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path');
  const pathValue = pathKey ? process.env[pathKey] : undefined;
  for (const entry of (pathValue ?? '').split(path.delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!directory) continue;
    const candidate = path.join(directory, executable);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function selectShell(): { executable: string; label: string } {
  if (process.platform === 'win32') {
    const programFiles = [process.env.ProgramFiles, process.env.ProgramW6432];
    const pwsh = findOnPath('pwsh.exe')
      ?? programFiles
        .filter((directory): directory is string => Boolean(directory))
        .map((directory) => path.join(directory, 'PowerShell', '7', 'pwsh.exe'))
        .find(isFile);
    if (pwsh) return { executable: pwsh, label: 'PowerShell 7' };

    const windowsPowerShell = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
    );
    return {
      executable: isFile(windowsPowerShell) ? windowsPowerShell : (findOnPath('powershell.exe') ?? 'powershell.exe'),
      label: 'Windows PowerShell',
    };
  }

  const configured = process.env.SHELL;
  if (configured && path.isAbsolute(configured) && isFile(configured)) {
    try {
      accessSync(configured, constants.X_OK);
      return { executable: configured, label: path.basename(configured) };
    } catch {
      // A configured shell can be stale or inaccessible; use the system fallback.
    }
  }
  return { executable: '/bin/sh', label: 'sh' };
}

function homeDirectory(): string {
  const home = os.homedir();
  try {
    if (statSync(home).isDirectory()) return home;
  } catch {
    // Fall through to Electron's known application data location.
  }
  return app.getPath('home');
}

/**
 * Register the dashboard's PTY IPC endpoints. Call once when Electron is ready.
 * The returned function can be used during main-process teardown.
 */
export function registerTerminalIpc(getDashboardWindow: () => BrowserWindow | null): () => void {
  const sessions = new Map<string, TerminalSession>();
  const trackedWindows = new WeakSet<BrowserWindow>();
  let disposed = false;

  function assertDashboardSender(event: IpcMainInvokeEvent): BrowserWindow {
    const window = getDashboardWindow();
    if (disposed || !window || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unknown window');
    }
    return window;
  }

  function getSession(owner: WebContents, id: string): TerminalSession {
    const session = sessions.get(id);
    if (!session || session.owner !== owner) throw new Error('Unknown terminal session');
    return session;
  }

  function closeSession(id: string): void {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    session.dataSubscription.dispose();
    session.exitSubscription.dispose();
    try {
      session.process.kill();
    } catch (error) {
      // The shell may exit between closing a tab and sending the kill signal.
      console.warn('Could not stop terminal session', error);
    }
  }

  function closeSessionsForOwner(owner: WebContents): void {
    for (const [id, session] of sessions) {
      if (session.owner === owner) closeSession(id);
    }
  }

  function trackWindow(window: BrowserWindow): void {
    if (trackedWindows.has(window)) return;
    trackedWindows.add(window);
    const owner = window.webContents;
    window.once('closed', () => closeSessionsForOwner(owner));
    owner.once('destroyed', () => closeSessionsForOwner(owner));
    owner.on('render-process-gone', () => closeSessionsForOwner(owner));
    owner.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument) closeSessionsForOwner(owner);
    });
  }

  ipcMain.handle('terminal:create', (event, request: unknown) => {
    const window = assertDashboardSender(event);
    const { cols, rows } = validateSize(request);
    if (sessions.size >= MAX_SESSIONS) throw new Error('Terminal session limit reached');

    trackWindow(window);
    const owner = window.webContents;
    const shell = selectShell();
    const cwd = homeDirectory();
    const ptyProcess = pty.spawn(shell.executable, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    const id = randomUUID();

    const sendData = (data: string) => {
      if (owner.isDestroyed() || sessions.get(id)?.owner !== owner) return;
      for (let offset = 0; offset < data.length;) {
        let end = Math.min(offset + MAX_OUTPUT_EVENT_CHARS, data.length);
        // Preserve a UTF-16 surrogate pair across IPC messages.
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]) && /[\uDC00-\uDFFF]/.test(data[end])) end--;
        owner.send('terminal:data', { id, data: data.slice(offset, end) });
        offset = end;
      }
    };
    const dataSubscription = ptyProcess.onData(sendData);
    const exitSubscription = ptyProcess.onExit(({ exitCode, signal }) => {
      const session = sessions.get(id);
      if (!session || session.owner !== owner) return;
      sessions.delete(id);
      session.dataSubscription.dispose();
      session.exitSubscription.dispose();
      if (!owner.isDestroyed()) owner.send('terminal:exit', { id, exitCode, signal: signal ?? null });
    });
    sessions.set(id, { owner, process: ptyProcess, dataSubscription, exitSubscription });
    return { id, shell: shell.label, cwd };
  });

  ipcMain.handle('terminal:write', (event, request: unknown) => {
    const owner = assertDashboardSender(event).webContents;
    const { id, data } = validateWrite(request);
    if (data) getSession(owner, id).process.write(data);
  });

  ipcMain.handle('terminal:resize', (event, request: unknown) => {
    const owner = assertDashboardSender(event).webContents;
    const { id, cols, rows } = validateResize(request);
    getSession(owner, id).process.resize(cols, rows);
  });

  ipcMain.handle('terminal:close', (event, request: unknown) => {
    const owner = assertDashboardSender(event).webContents;
    const id = validateId(request);
    const session = sessions.get(id);
    if (session && session.owner !== owner) throw new Error('Unknown terminal session');
    // A shell can exit before the renderer removes its tab. Closing it remains safe.
    if (session) closeSession(id);
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const id of sessions.keys()) closeSession(id);
    ipcMain.removeHandler('terminal:create');
    ipcMain.removeHandler('terminal:write');
    ipcMain.removeHandler('terminal:resize');
    ipcMain.removeHandler('terminal:close');
    app.removeListener('before-quit', dispose);
  };
  app.on('before-quit', dispose);
  return dispose;
}
