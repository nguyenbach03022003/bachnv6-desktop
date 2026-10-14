import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { DEFAULT_AI_SETTINGS, type AiSettings } from './shared/ai-settings-types';
import { checkAiCli } from './ai-cli';

let cached: AiSettings | null = null;
let tail: Promise<unknown> = Promise.resolve();
const settingsFile = () => path.join(app.getPath('userData'), 'ai-settings.json');

export function validateAiSettings(raw: unknown): AiSettings {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid AI settings.');
  const value = raw as Record<string, unknown>;
  if (value.provider !== 'codex' && value.provider !== 'claude') throw new Error('Choose Codex CLI or Claude CLI.');
  function options(provider: string) {
    const entry = value[provider] as Record<string, unknown> | undefined;
    if (!entry || typeof entry.executable !== 'string' || typeof entry.model !== 'string') throw new Error('Invalid CLI settings.');
    const executable = entry.executable.trim();
    const model = entry.model.trim();
    if (executable.length > 4096 || /[\x00-\x1f"\r\n]/.test(executable)
      || (executable && !path.isAbsolute(executable))) throw new Error('Use an absolute CLI file path, or leave it blank for automatic detection.');
    if (process.platform === 'win32' && executable && !/\.(exe|cmd|bat)$/i.test(executable)) {
      throw new Error('Choose a Windows .exe, .cmd, or .bat CLI file.');
    }
    if (model.length > 160 || (model && !/^[\w./:@-]+$/.test(model))) throw new Error('Invalid model name.');
    return { executable, model };
  }
  return { provider: value.provider, codex: options('codex'), claude: options('claude') };
}

export async function getAiSettings(): Promise<AiSettings> {
  await tail;
  if (cached) return structuredClone(cached);
  try {
    const stored = validateAiSettings(JSON.parse(await fs.readFile(settingsFile(), 'utf8')));
    cached ??= stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not read AI settings. Open Settings to save a new configuration.');
    cached ??= structuredClone(DEFAULT_AI_SETTINGS);
  }
  return structuredClone(cached);
}

export function registerAiSettingsIpc(getWindow: () => BrowserWindow | null): void {
  function assertSender(event: IpcMainInvokeEvent): BrowserWindow {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown window');
    return window;
  }
  ipcMain.handle('ai-settings:get', (event) => { assertSender(event); return getAiSettings(); });
  ipcMain.handle('ai-settings:save', (event, raw: unknown) => {
    assertSender(event);
    const next = validateAiSettings(raw);
    const result = tail.then(async () => {
      const temporary = `${settingsFile()}.${randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, settingsFile());
      } catch {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw new Error('Could not save AI settings. Check the app profile folder and try again.');
      }
      cached = next;
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send('ai-settings:changed', next);
      }
      return structuredClone(next);
    });
    tail = result.catch(() => undefined);
    return result;
  });
  ipcMain.handle('ai-settings:check', (event, raw: unknown) => {
    assertSender(event);
    return checkAiCli(validateAiSettings(raw));
  });
  ipcMain.handle('ai-settings:pick', async (event) => {
    const window = assertSender(event);
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose CLI executable', properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'CLI executable', extensions: ['exe', 'cmd', 'bat'] }] } : {}),
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}
