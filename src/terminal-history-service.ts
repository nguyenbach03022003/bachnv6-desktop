import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { AiSessionLink, SavedTerminalSession, TerminalHistory, TerminalSessionsSnapshot } from './shared/terminal-types';

// Keep the latest output without letting a noisy shell grow the profile forever.
export const MAX_TERMINAL_OUTPUT = 512 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw);
export function terminalId(raw: unknown): string {
  if (typeof raw !== 'string' || !uuid.test(raw)) throw new Error('Invalid terminal session ID.');
  return raw;
}
export function aiSessionLink(raw: unknown): AiSessionLink | null {
  if (raw === null) return null;
  if (!record(raw) || (raw.provider !== 'codex' && raw.provider !== 'claude')) throw new Error('Choose Codex or Claude.');
  return { provider: raw.provider, sessionId: terminalId(raw.sessionId) };
}
function validateSession(raw: unknown): SavedTerminalSession {
  if (!record(raw) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 40
    || typeof raw.shell !== 'string' || raw.shell.length > 80 || typeof raw.cwd !== 'string' || !path.isAbsolute(raw.cwd)
    || raw.cwd.length > 4096 || /[\x00-\x1f]/.test(raw.cwd)
    || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))
    || typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))
    || !['running', 'closed', 'exited'].includes(raw.status as string)
    || (raw.exitCode !== null && !Number.isInteger(raw.exitCode))
    || !Number.isInteger(raw.outputChars) || (raw.outputChars as number) < 0 || (raw.outputChars as number) > MAX_TERMINAL_OUTPUT
    || typeof raw.truncated !== 'boolean') throw new Error('Invalid saved terminal session.');
  return { id: terminalId(raw.id), name: raw.name, shell: raw.shell, cwd: raw.cwd,
    createdAt: raw.createdAt, updatedAt: raw.updatedAt, status: raw.status as SavedTerminalSession['status'],
    exitCode: raw.exitCode as number | null, ai: aiSessionLink(raw.ai), outputChars: raw.outputChars as number, truncated: raw.truncated };
}

export function registerTerminalHistoryIpc(getWindow: () => BrowserWindow | null) {
  const folder = path.join(app.getPath('userData'), 'companion', 'sessions');
  const indexFile = path.join(folder, 'index.json');
  const sessions = new Map<string, SavedTerminalSession>();
  const output = new Map<string, string>();
  const dirty = new Set<string>();
  const revisions = new Map<string, number>();
  const detection = new Map<string, string>();
  let loading: Promise<void> | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let error: string | null = null;

  function snapshot(): TerminalSessionsSnapshot {
    return { sessions: [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), error };
  }
  function publish() {
    const window = getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('terminal-sessions:update', snapshot());
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  }
  async function atomic(file: string, data: unknown) {
    await fs.mkdir(folder, { recursive: true });
    const temporary = path.join(folder, `${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, file);
    } catch (reason) { await fs.rm(temporary, { force: true }).catch(() => undefined); throw reason; }
  }
  function load(): Promise<void> {
    loading ??= (async () => {
      let raw: unknown;
      try { raw = JSON.parse(await fs.readFile(indexFile, 'utf8')); }
      catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('Could not read saved sessions. Your saved files have been kept.'); }
      if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.sessions)) throw new Error('Invalid saved session index. Your saved files have been kept.');
      const saved = raw.sessions.map(validateSession);
      if (new Set(saved.map(session => session.id)).size !== saved.length) throw new Error('Duplicate saved session IDs.');
      for (const session of saved) sessions.set(session.id, { ...session, status: session.status === 'running' ? 'closed' : session.status });
    })();
    return loading;
  }
  function requireSession(id: string) {
    const session = sessions.get(terminalId(id));
    if (!session) throw new Error('This saved terminal session is unavailable.');
    return session;
  }
  async function readOutput(id: string): Promise<string> {
    if (output.has(id)) return output.get(id)!;
    const session = requireSession(id);
    try {
      const file = path.join(folder, `${id}.json`);
      if ((await fs.stat(file)).size > MAX_TERMINAL_OUTPUT * 8) throw new Error('Saved terminal output is too large.');
      const raw: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!record(raw) || raw.version !== 1 || typeof raw.output !== 'string' || raw.output.length > MAX_TERMINAL_OUTPUT) throw new Error('Invalid saved terminal output.');
      return raw.output;
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT' && session.outputChars === 0) return '';
      throw new Error('Could not read this terminal’s saved output. Your saved files have been kept.');
    }
  }
  async function writeIndex() { await atomic(indexFile, { version: 1, sessions: [...sessions.values()] }); }
  async function flushNow() {
    await load();
    const pending = [...dirty].map(id => ({ id, revision: revisions.get(id), output: output.get(id) }));
    if (!pending.length) return;
    try {
      for (const entry of pending) {
        if (entry.output !== undefined) await atomic(path.join(folder, `${entry.id}.json`), { version: 1, output: entry.output });
      }
      await writeIndex();
      for (const entry of pending) {
        if (revisions.get(entry.id) !== entry.revision) continue;
        dirty.delete(entry.id);
        if (sessions.get(entry.id)?.status !== 'running') { output.delete(entry.id); detection.delete(entry.id); }
      }
      error = null;
    } catch (reason) {
      error = 'Could not save terminal history. Check the app profile folder; saving will retry.';
      throw reason;
    } finally { publish(); }
  }
  function mark(id: string) { dirty.add(id); revisions.set(id, (revisions.get(id) ?? 0) + 1); }
  async function update(id: string, patch: Partial<Pick<SavedTerminalSession, 'name' | 'cwd' | 'status' | 'exitCode' | 'ai'>>) {
    return serial(async () => {
      await load();
      const previous = requireSession(id);
      const next = validateSession({ ...previous, ...patch, updatedAt: new Date().toISOString() });
      sessions.set(id, next);
      try { await writeIndex(); }
      catch (reason) { sessions.set(id, { ...requireSession(id), ...Object.fromEntries(Object.keys(patch).map(key => [key, previous[key as keyof SavedTerminalSession]])) }); throw reason; }
      publish();
    });
  }
  function assertSender(event: IpcMainInvokeEvent) {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown window');
  }
  ipcMain.handle('terminal-sessions:list', (event) => { assertSender(event); return serial(async () => { await load(); return snapshot(); }); });
  ipcMain.handle('terminal-sessions:read', (event, raw: unknown) => {
    assertSender(event);
    const id = terminalId(raw);
    return serial(async (): Promise<TerminalHistory> => {
      await load();
      return { session: requireSession(id), output: stripVTControlCharacters(await readOutput(id))
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '') };
    });
  });
  ipcMain.handle('terminal-sessions:connect', (event, rawId: unknown, rawAi: unknown) => {
    assertSender(event);
    return update(terminalId(rawId), { ai: aiSessionLink(rawAi) });
  });
  ipcMain.handle('terminal-sessions:remove', (event, raw: unknown) => {
    assertSender(event);
    const id = terminalId(raw);
    return serial(async () => {
      await load();
      const previous = requireSession(id);
      if (previous.status === 'running') throw new Error('Close this terminal before deleting its history.');
      sessions.delete(id);
      try { await writeIndex(); } catch (reason) { sessions.set(id, previous); throw reason; }
      dirty.delete(id); output.delete(id); revisions.delete(id); detection.delete(id);
      await fs.rm(path.join(folder, `${id}.json`), { force: true });
      publish();
    });
  });
  const timer = setInterval(() => { if (dirty.size) void serial(flushNow).catch(() => undefined); }, 1000);
  timer.unref();

  return {
    async prepare(id: string, shell: string, cwd: string, name: string, restoring: boolean) {
      await serial(async () => {
        await load();
        if (restoring) { requireSession(id); output.set(id, await readOutput(id)); return; }
        const now = new Date().toISOString();
        const session = validateSession({ id, shell, cwd, name, createdAt: now, updatedAt: now, status: 'closed', exitCode: null,
          ai: null, outputChars: 0, truncated: false });
        sessions.set(id, session);
        try { await writeIndex(); } catch (reason) { sessions.delete(id); throw reason; }
        output.set(id, '');
        publish();
      });
    },
    async get(id: string) { await load(); return { ...requireSession(id) }; },
    update,
    append(id: string, data: string) {
      const session = sessions.get(id);
      if (!session) return;
      const combined = (output.get(id) ?? '') + data;
      let kept = combined.slice(-MAX_TERMINAL_OUTPUT);
      if (/^[\uDC00-\uDFFF]/.test(kept)) kept = kept.slice(1);
      output.set(id, kept);
      // Detect only explicit CLI resume commands, never infer the most recent global chat.
      const previous = detection.get(id) ?? '';
      const recent = previous + data;
      detection.set(id, recent.slice(-8192));
      const plain = stripVTControlCharacters(recent);
      const previousLength = stripVTControlCharacters(previous).length;
      const matches = [...plain.matchAll(/\b(codex\s+resume|claude\s+(?:--resume|-r))\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi)]
        .filter(match => match.index! + match[0].length > previousLength);
      const match = matches.at(-1);
      const ai = match ? { provider: match[1].toLowerCase().startsWith('codex') ? 'codex' as const : 'claude' as const, sessionId: match[2] } : session.ai;
      let cwd = session.cwd;
      const location = [...recent.matchAll(/\x1b\]7;(file:\/\/[^\x07\x1b\r\n]+)(?:\x07|\x1b\\)/g)]
        .filter(match => match.index! + match[0].length > previous.length).at(-1);
      if (location) {
        try {
          const url = new URL(location[1]);
          // OSC 7 commonly uses the machine hostname. Always treat it as a local path.
          url.hostname = '';
          const directory = fileURLToPath(url);
          if (path.isAbsolute(directory) && directory.length <= 4096 && !/[\x00-\x1f]/.test(directory)) cwd = path.resolve(directory);
        } catch { /* Ignore incomplete or non-local shell integration output. */ }
      }
      sessions.set(id, { ...session, ai, cwd, outputChars: kept.length, truncated: session.truncated || combined.length > kept.length, updatedAt: new Date().toISOString() });
      mark(id);
    },
    close(id: string, exitCode: number | null = null) {
      const session = sessions.get(id);
      if (!session) return;
      sessions.set(id, { ...session, status: exitCode === null ? 'closed' : 'exited', exitCode, updatedAt: new Date().toISOString() });
      mark(id);
      publish();
    },
    flush: () => serial(flushNow),
    stop: () => clearInterval(timer),
  };
}

export type TerminalHistoryStore = ReturnType<typeof registerTerminalHistoryIpc>;
