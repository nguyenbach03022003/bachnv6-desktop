import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { AiUsageSnapshot } from './shared/ai-usage-types';
import type { CodexUsageWindow } from './shared/codex-usage-types';

// This is the subscription endpoint used by Claude Code's /usage command,
// rather than the Console API for token billing. Its schema is not a public API.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const REFRESH_MS = 5 * 60_000;
const MIN_REFRESH_MS = 60_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

interface ClaudeCredentials { accessToken: string; planType: string | null }
class ClaudeUsageError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'temporary' | 'limited' = 'temporary', readonly retryAfterMs = REFRESH_MS) {
    super(message);
  }
}

export async function readClaudeCredentials(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): Promise<ClaudeCredentials> {
  let oauth: Record<string, unknown> | null = null;
  // Only Claude OAuth credentials are sent to the fixed Anthropic endpoint.
  // Never send API keys, gateway tokens, or a renderer-supplied credential.
  if (env.CLAUDE_CODE_OAUTH_TOKEN) oauth = { accessToken: env.CLAUDE_CODE_OAUTH_TOKEN };
  else {
    const config = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude');
    let file: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      file = await fs.open(path.join(config, '.credentials.json'), 'r');
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('Invalid credential file');
      const saved = record(JSON.parse(await file.readFile('utf8')));
      oauth = record(saved?.claudeAiOauth);
    } catch {
      throw new ClaudeUsageError('Sign in to your Claude subscription with “claude auth login”, then refresh usage.', 'auth');
    } finally { await file?.close(); }
  }
  if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken || oauth.accessToken.length > 8192
    || /\s/.test(oauth.accessToken)) {
    throw new ClaudeUsageError('Claude subscription sign-in was not found. Run “claude auth login”, then refresh usage. API keys do not report subscription limits.', 'auth');
  }
  return {
    accessToken: oauth.accessToken,
    planType: typeof oauth.subscriptionType === 'string' && /^[\w -]{1,40}$/.test(oauth.subscriptionType) ? oauth.subscriptionType : null,
  };
}

export function parseClaudeUsage(value: unknown): CodexUsageWindow[] {
  const data = record(value);
  if (!data) throw new ClaudeUsageError('Claude returned an invalid usage response. Try refreshing later.');
  const windows: CodexUsageWindow[] = [];
  for (const [key, label, duration] of [
    ['five_hour', '5-hour limit', 300], ['seven_day', 'Weekly limit', 10080],
    ['seven_day_sonnet', 'Weekly · Sonnet', 10080], ['seven_day_opus', 'Weekly · Opus', 10080],
  ] as const) {
    const item = record(data[key]);
    if (!item || typeof item.utilization !== 'number' || !Number.isFinite(item.utilization)) continue;
    const reset = typeof item.resets_at === 'string' ? Date.parse(item.resets_at) : NaN;
    windows.push({ limitId: key, label, usedPercent: Math.max(0, Math.min(100, item.utilization)),
      windowDurationMins: duration, resetsAt: Number.isFinite(reset) ? reset / 1000 : null });
  }
  if (!windows.length) throw new ClaudeUsageError('Claude did not report subscription usage limits for this account. Check /usage in Claude Code.');
  return windows;
}

export function requestClaudeUsage(accessToken: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = https.get(USAGE_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json', 'User-Agent': 'Bachnv6Desktop' },
      signal: AbortSignal.timeout(12_000),
    }, response => {
      response.once('error', () => reject(new ClaudeUsageError('Could not read Claude usage. Check your connection and try again.')));
      // Redirects are deliberately not followed with the user's credential.
      const status = response.statusCode;
      if (status !== 200) {
        response.resume();
        if (status === 401 || status === 403) {
          reject(new ClaudeUsageError('Claude sign-in expired or cannot read subscription usage. Run “claude auth login”, then refresh usage.', 'auth'));
        } else if (status === 429) {
          const header = response.headers['retry-after'];
          const seconds = typeof header === 'string' ? Number(header) : NaN;
          const retry = Number.isFinite(seconds) ? seconds * 1000 : typeof header === 'string' ? Date.parse(header) - Date.now() : REFRESH_MS;
          const delay = Number.isFinite(retry) && retry > 0 ? Math.min(24 * 60 * 60_000, Math.max(MIN_REFRESH_MS, retry)) : REFRESH_MS;
          reject(new ClaudeUsageError('Claude usage refresh is rate limited. The app will retry after the cooldown.', 'limited', delay));
        } else reject(new ClaudeUsageError('Claude usage is temporarily unavailable. Try refreshing later.'));
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { request.destroy(); reject(new ClaudeUsageError('Claude returned an oversized usage response.')); }
        else chunks.push(chunk);
      });
      response.once('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new ClaudeUsageError('Claude returned an invalid usage response. Try refreshing later.')); }
      });
    });
    request.once('error', () => reject(new ClaudeUsageError('Could not reach Claude usage. Check your connection and try again.')));
  });
}

function empty(error: string | null = null, nextRefreshAt: number | null = null): AiUsageSnapshot {
  return { provider: 'claude', status: 'unavailable', planType: null, windows: [], creditBalance: null, resetBank: null,
    fetchedAt: null, error, nextRefreshAt };
}

export function createClaudeUsageService(dependencies: {
  credentials?: () => Promise<ClaudeCredentials>;
  request?: (token: string) => Promise<unknown>;
  now?: () => number;
} = {}) {
  const credentials = dependencies.credentials ?? readClaudeCredentials;
  const request = dependencies.request ?? requestClaudeUsage;
  const now = dependencies.now ?? Date.now;
  let cached = empty();
  let identity: string | null = null;
  let inFlight: Promise<AiUsageSnapshot> | null = null;
  let lastAttempt = -Infinity;
  let cooldown = 0;

  async function get(force = false): Promise<AiUsageSnapshot> {
    let account: ClaudeCredentials;
    try { account = await credentials(); }
    catch (error) {
      // A logout or unreadable credentials must not expose the previous account's usage.
      if (inFlight) { await inFlight; return get(force); }
      identity = null;
      cached = empty(error instanceof ClaudeUsageError ? error.message : 'Could not read Claude sign-in. Run “claude auth login” and refresh usage.', now() + MIN_REFRESH_MS);
      return structuredClone(cached);
    }
    const key = createHash('sha256').update(account.accessToken).digest('hex');
    if (inFlight) {
      if (identity === key) return structuredClone(await inFlight);
      await inFlight;
      return get(force);
    }
    if (key !== identity) { identity = key; cached = empty(); lastAttempt = -Infinity; cooldown = 0; }
    if (now() < cooldown || (force ? now() - lastAttempt < MIN_REFRESH_MS : now() < (cached.nextRefreshAt ?? 0))) {
      return structuredClone(cached);
    }
    lastAttempt = now();
    inFlight = (async () => {
      try {
        const windows = parseClaudeUsage(await request(account.accessToken));
        cached = { ...empty(), status: 'live', planType: account.planType, windows, fetchedAt: now(), nextRefreshAt: now() + REFRESH_MS };
      } catch (error) {
        const failure = error instanceof ClaudeUsageError ? error : new ClaudeUsageError('Could not read Claude usage. Try refreshing later.');
        if (failure.kind === 'limited') cooldown = now() + failure.retryAfterMs;
        const windows = failure.kind === 'auth' ? [] : cached.windows.filter(item => item.resetsAt === null || item.resetsAt * 1000 > now());
        cached = { ...cached, status: windows.length ? 'stale' : 'unavailable', windows,
          ...(failure.kind === 'auth' || !windows.length ? { fetchedAt: null, planType: null } : {}),
          error: failure.message, nextRefreshAt: Math.max(now() + REFRESH_MS, cooldown) };
      }
      return cached;
    })();
    try { return structuredClone(await inFlight); } finally { inFlight = null; }
  }
  return { get };
}

export const claudeUsage = createClaudeUsageService();
