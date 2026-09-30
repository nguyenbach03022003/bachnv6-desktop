import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { CodexCreditBalance, CodexResetBank, CodexResetOutcome, CodexResetResult, CodexUsageSnapshot, CodexUsageWindow } from './shared/codex-usage-types';
import { findUnixCodexCommand } from './codex-cli';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
let cached: CodexUsageSnapshot = {
  status: 'unavailable', planType: null, windows: [], fetchedAt: null,
  creditBalance: null, resetBank: null, error: null, nextRefreshAt: null,
};
let inFlight: Promise<CodexUsageSnapshot> | null = null;
let redemptionInFlight: Promise<CodexResetResult> | null = null;
const activeChildren = new Map<ChildProcessWithoutNullStreams, boolean>();

function findWindowsCodexExe(): string | null {
  const pathValue = process.env.PATH || process.env.Path || '';
  for (const entry of pathValue.split(path.delimiter)) {
    const folder = entry.replace(/^"|"$/g, '').trim();
    if (!folder) continue;
    const candidate = path.join(folder, 'codex.exe');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function terminateChild(child: ChildProcessWithoutNullStreams, wrapper: boolean): void {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32' && wrapper && child.pid) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore',
    });
    killer.on('error', () => child.kill());
    killer.unref();
  } else {
    child.kill();
  }
}

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function parseWindow(limitId: string, value: unknown, labelPrefix: string): CodexUsageWindow | null {
  const data = record(value);
  if (!data || typeof data.usedPercent !== 'number' || !Number.isFinite(data.usedPercent)) return null;
  const duration = typeof data.windowDurationMins === 'number' && Number.isFinite(data.windowDurationMins)
    ? data.windowDurationMins : null;
  const reset = typeof data.resetsAt === 'number' && Number.isFinite(data.resetsAt)
    ? data.resetsAt : null;
  let durationLabel = 'Usage window';
  if (duration !== null && duration >= 1440 && duration % 1440 === 0) durationLabel = `${duration / 1440}d window`;
  else if (duration !== null && duration >= 60 && duration % 60 === 0) durationLabel = `${duration / 60}h window`;
  else if (duration !== null) durationLabel = `${duration}m window`;
  return {
    limitId,
    label: labelPrefix ? `${labelPrefix} · ${durationLabel}` : durationLabel,
    usedPercent: Math.max(0, Math.min(100, data.usedPercent)),
    windowDurationMins: duration,
    resetsAt: reset,
  };
}

function parseLimits(result: unknown): CodexUsageWindow[] {
  const response = record(result);
  if (!response) return [];
  const byId = record(response.rateLimitsByLimitId);
  const entries: [string, unknown][] = byId && Object.keys(byId).length
    ? Object.entries(byId) : [['codex', response.rateLimits]];
  const windows: CodexUsageWindow[] = [];
  for (const [key, raw] of entries) {
    const limit = record(raw);
    if (!limit) continue;
    const name = typeof limit.limitName === 'string' && limit.limitName.trim()
      ? limit.limitName.trim() : key === 'codex' ? '' : key;
    for (const field of ['primary', 'secondary'] as const) {
      const window = parseWindow(key, limit[field], name);
      if (window) windows.push(window);
    }
  }
  return windows;
}

function parseCreditBalance(result: unknown): CodexCreditBalance | null {
  const response = record(result);
  if (!response) return null;
  const byId = record(response.rateLimitsByLimitId);
  const candidates = [record(byId?.codex)?.credits, record(response.rateLimits)?.credits,
    ...Object.values(byId ?? {}).map((value) => record(value)?.credits)];
  for (const candidate of candidates) {
    const credit = record(candidate);
    if (!credit || typeof credit.hasCredits !== 'boolean' || typeof credit.unlimited !== 'boolean') continue;
    const balance = typeof credit.balance === 'string' && credit.balance.length <= 64
      ? credit.balance.trim() || null : null;
    return { hasCredits: credit.hasCredits, unlimited: credit.unlimited, balance };
  }
  return null;
}

function parseResetBank(result: unknown): CodexResetBank | null {
  const response = record(result);
  const bank = record(response?.rateLimitResetCredits);
  const count = bank?.availableCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
  const credits = Array.isArray(bank?.credits) ? bank.credits.flatMap((value) => {
    const detail = record(value);
    if (!detail || detail.status !== 'available' || typeof detail.id !== 'string' || !detail.id || detail.id.length > 256) return [];
    return [{
      id: detail.id,
      title: typeof detail.title === 'string' ? detail.title.slice(0, 120) : null,
      description: typeof detail.description === 'string' ? detail.description.slice(0, 240) : null,
      expiresAt: typeof detail.expiresAt === 'number' && Number.isFinite(detail.expiresAt) ? detail.expiresAt : null,
    }];
  }) : [];
  return { availableCount: count, credits };
}

function readCodexCli(consumeCreditId?: string | null): Promise<{
  planType: string | null;
  windows: CodexUsageWindow[];
  creditBalance: CodexCreditBalance | null;
  resetBank: CodexResetBank | null;
  outcome: CodexResetOutcome | null;
}> {
  return new Promise((resolve, reject) => {
    // Arguments are fixed; no renderer text is ever passed to a shell.
    const directExe = process.platform === 'win32' ? findWindowsCodexExe() : null;
    const wrapper = process.platform === 'win32' && directExe === null;
    const unixCommand = process.platform === 'win32' ? null : findUnixCodexCommand();
    const child = process.platform === 'win32'
      ? spawn(directExe || process.env.ComSpec || 'cmd.exe', directExe
        ? ['app-server'] : ['/d', '/s', '/c', 'codex app-server'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      : spawn(unixCommand!.command, ['app-server'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: unixCommand!.env,
    });
    activeChildren.set(child, wrapper);
    const lines = createInterface({ input: child.stdout });
    const pending = new Map<number, (response: JsonRecord) => void>();
    let sequence = 0;
    let settled = false;
    let errorText = '';
    const timeout = setTimeout(() => fail(new Error('Codex CLI did not respond in time.')), REQUEST_TIMEOUT_MS);

    function finish(planType: string | null, windows: CodexUsageWindow[],
      creditBalance: CodexCreditBalance | null, resetBank: CodexResetBank | null,
      outcome: CodexResetOutcome | null = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      child.stdin.end();
      setTimeout(() => terminateChild(child, wrapper), 2_000).unref();
      resolve({ planType, windows, creditBalance, resetBank, outcome });
    }
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      child.stdin.end();
      setTimeout(() => terminateChild(child, wrapper), 2_000).unref();
      reject(error);
    }
    function request(method: string, params: JsonRecord | undefined, onResponse: (result: unknown) => void) {
      const id = ++sequence;
      pending.set(id, (response) => {
        if (response.error) {
          const detail = record(response.error);
          const message = typeof detail?.message === 'string' ? ` ${detail.message.slice(0, 240)}` : '';
          fail(new Error(`Codex CLI could not complete ${method}.${message}`));
          return;
        }
        onResponse(response.result);
      });
      child.stdin.write(`${JSON.stringify({ id, method, ...(params ? { params } : {}) })}\n`);
    }

    lines.on('line', (line) => {
      if (line.length > 1024 * 1024) return;
      let response: JsonRecord | null;
      try { response = record(JSON.parse(line)); } catch { return; }
      if (!response || typeof response.id !== 'number') return;
      const callback = pending.get(response.id);
      if (callback) {
        pending.delete(response.id);
        callback(response);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errorText = (errorText + chunk.toString('utf8')).slice(-1000);
    });
    child.stdin.on('error', () => fail(new Error('Codex CLI connection closed.')));
    child.on('error', () => fail(new Error('Codex CLI is not installed or is not on PATH.')));
    child.on('close', (code) => {
      activeChildren.delete(child);
      if (!settled) fail(new Error(code === 0 ? 'Codex CLI closed before replying.' :
        errorText.includes('not recognized') || errorText.includes('node: No such file')
          ? 'Codex CLI or its Node runtime was not found. Install Codex and refresh AI usage.'
          : 'Codex CLI could not start. Check that “codex app-server” works in your terminal.'));
    });

    request('initialize', {
      clientInfo: { name: 'bachnv6_desktop', title: 'Bachnv6 Desktop', version: app.getVersion() },
      capabilities: {},
    }, () => {
      child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
      request('account/read', { refreshToken: false }, (accountResult) => {
        const account = record(accountResult);
        const accountInfo = record(account?.account);
        if (!accountInfo) {
          fail(new Error('Sign in with “codex login” to show Codex usage.'));
          return;
        }
        if (accountInfo.type !== 'chatgpt') {
          fail(new Error('Codex CLI usage limits require a ChatGPT sign-in.'));
          return;
        }
        const planType = typeof accountInfo.planType === 'string' ? accountInfo.planType : null;
        function finishFromLimits(rateResult: unknown, outcome: CodexResetOutcome | null = null) {
          const windows = parseLimits(rateResult);
          const creditBalance = parseCreditBalance(rateResult);
          const resetBank = parseResetBank(rateResult);
          if (!windows.length && !creditBalance && !resetBank) {
            fail(new Error('Codex CLI did not provide usage or credit details for this account.'));
            return;
          }
          finish(planType, windows, creditBalance, resetBank, outcome);
        }
        request('account/rateLimits/read', undefined, (rateResult) => {
          if (consumeCreditId === undefined) { finishFromLimits(rateResult); return; }
          const bank = parseResetBank(rateResult);
          if (!bank?.availableCount) { fail(new Error('No earned resets are available. Refresh AI usage.')); return; }
          if (consumeCreditId !== null && !bank.credits.some((credit) => credit.id === consumeCreditId)) {
            fail(new Error('The selected reset is no longer available. Refresh AI usage.'));
            return;
          }
          request('account/rateLimitResetCredit/consume', {
            idempotencyKey: randomUUID(),
            ...(consumeCreditId === null ? {} : { creditId: consumeCreditId }),
          }, (consumeResult) => {
            const outcome = record(consumeResult)?.outcome;
            if (outcome !== 'reset' && outcome !== 'alreadyRedeemed' && outcome !== 'nothingToReset' && outcome !== 'noCredit') {
              fail(new Error('Codex CLI returned an unknown reset result. Refresh AI usage.'));
              return;
            }
            request('account/rateLimits/read', undefined, (updated) => finishFromLimits(updated, outcome));
          });
        });
      });
    });
  });
}

async function getSnapshot(force: boolean): Promise<CodexUsageSnapshot> {
  if (redemptionInFlight) return (await redemptionInFlight).snapshot;
  if (inFlight) return inFlight;
  if (!force && cached.nextRefreshAt && Date.now() < cached.nextRefreshAt) return cached;
  inFlight = (async () => {
    try {
      const { planType, windows, creditBalance, resetBank } = await readCodexCli();
      const now = Date.now();
      cached = { status: 'live', planType, windows, creditBalance, resetBank,
        fetchedAt: now, error: null, nextRefreshAt: now + REFRESH_INTERVAL_MS };
    } catch (error) {
      const now = Date.now();
      const message = error instanceof Error ? error.message : 'Codex CLI usage is unavailable.';
      // A failed read cannot prove this is still the same signed-in account.
      cached = { status: 'unavailable', planType: null, windows: [], creditBalance: null, resetBank: null, fetchedAt: null,
        error: message, nextRefreshAt: now + REFRESH_INTERVAL_MS };
    }
    return cached;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

async function useReset(creditId: string | null): Promise<CodexResetResult> {
  if (creditId !== null && (typeof creditId !== 'string' || !creditId || creditId.length > 256)) {
    throw new Error('Invalid reset selection.');
  }
  if (redemptionInFlight) return redemptionInFlight;
  redemptionInFlight = (async () => {
    if (inFlight) await inFlight;
    const { planType, windows, creditBalance, resetBank, outcome } = await readCodexCli(creditId);
    if (!outcome) throw new Error('Codex CLI did not report a reset result.');
    const now = Date.now();
    cached = { status: 'live', planType, windows, creditBalance, resetBank,
      fetchedAt: now, error: null, nextRefreshAt: now + REFRESH_INTERVAL_MS };
    return { snapshot: cached, outcome };
  })();
  try { return await redemptionInFlight; } finally { redemptionInFlight = null; }
}

export function registerCodexUsageIpc(getWindow: () => BrowserWindow | null): void {
  app.once('before-quit', () => {
    for (const [child, wrapper] of activeChildren) {
      child.stdin.end();
      terminateChild(child, wrapper);
    }
  });
  for (const [channel, force] of [['usage:get', false], ['usage:refresh', true]] as const) {
    ipcMain.handle(channel, (event) => {
      const window = getWindow();
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Unknown window');
      }
      return getSnapshot(force);
    });
  }
  ipcMain.handle('usage:use-reset', (event, creditId: unknown) => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unknown window');
    }
    if (creditId !== null && typeof creditId !== 'string') throw new Error('Invalid reset selection.');
    return useReset(creditId);
  });
}
