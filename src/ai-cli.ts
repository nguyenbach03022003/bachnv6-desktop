import { accessSync, constants, readdirSync, statSync, promises as fs } from 'node:fs';
import { spawn as nativeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
import { app } from 'electron';
import { getAiSettings } from './ai-settings-service';
import { AI_PROVIDER_LABELS, type AiCliCheck, type AiProvider, type AiSettings } from './shared/ai-settings-types';

interface CliCommand { command: string; env: NodeJS.ProcessEnv }
const activeChildren = new Set<ChildProcessWithoutNullStreams>();

function parseCliJson(value: string, label: string): Record<string, unknown> {
  try {
    const result: unknown = JSON.parse(value);
    if (result && typeof result === 'object' && !Array.isArray(result)) return result as Record<string, unknown>;
  } catch { /* Surface an actionable message instead of a JSON parser error. */ }
  throw new Error(`${label} returned an invalid response. Update the CLI and check the selected model in Settings.`);
}

export function resolveAiCli(settings: AiSettings, provider: AiProvider = settings.provider,
  env: NodeJS.ProcessEnv = process.env, home = os.homedir(), platform = process.platform): CliCommand {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const delimiter = windows ? ';' : ':';
  const pathKey = Object.keys(env).find(key => windows ? key.toLowerCase() === 'path' : key === 'PATH') ?? 'PATH';
  const folders = (env[pathKey] || (windows ? '' : '/usr/local/bin:/usr/bin:/bin')).split(delimiter);
  folders.push(paths.join(home, '.local', 'bin'), paths.join(home, '.npm-global', 'bin'));
  if (windows) {
    if (env.APPDATA) folders.push(paths.join(env.APPDATA, 'npm'));
    if (env.NVM_HOME) folders.push(env.NVM_HOME);
    if (env.NVM_SYMLINK) folders.push(env.NVM_SYMLINK);
    if (env.LOCALAPPDATA) folders.push(paths.join(env.LOCALAPPDATA, 'Programs', 'nodejs'));
    if (env.ProgramFiles) folders.push(paths.join(env.ProgramFiles, 'nodejs'));
  } else {
    folders.push('/opt/homebrew/bin');
    if (env.NVM_BIN) folders.push(env.NVM_BIN);
    try {
      const versions = readdirSync(paths.join(env.NVM_DIR || paths.join(home, '.nvm'), 'versions', 'node'), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^v\d+\.\d+\.\d+$/.test(entry.name))
        .map(entry => entry.name).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      for (const version of versions) folders.push(paths.join(env.NVM_DIR || paths.join(home, '.nvm'), 'versions', 'node', version, 'bin'));
    } catch { /* NVM is optional. */ }
  }
  const searchFolders = [...new Set(folders.map(folder => folder.trim().replace(/^"(.*)"$/, '$1')))]
    .filter(folder => paths.isAbsolute(folder));
  const configured = settings[provider].executable;
  const names = windows ? [`${provider}.exe`, `${provider}.cmd`, `${provider}.bat`] : [provider];
  const candidates = configured ? [configured] : searchFolders.flatMap(folder => names.map(name => paths.join(folder, name)));
  for (const command of candidates) {
    try {
      if (!statSync(command).isFile()) continue;
      accessSync(command, windows ? constants.F_OK : constants.X_OK);
      const resultEnv = { ...env };
      // Keep only one PATH key on Windows; Node sorts environment keys before spawning.
      if (windows) for (const key of Object.keys(resultEnv)) if (key.toLowerCase() === 'path') delete resultEnv[key];
      resultEnv[windows ? 'Path' : 'PATH'] = [...new Set([paths.dirname(command), ...searchFolders])].join(delimiter);
      return { command, env: resultEnv };
    } catch { /* Continue searching. */ }
  }
  throw new Error(configured
    ? `${AI_PROVIDER_LABELS[provider]} was not found at the configured path. Check Settings.`
    : `${AI_PROVIDER_LABELS[provider]} was not found. Install it or choose its executable in Settings.`);
}

function startCli(cli: CliCommand, args: string[], cwd?: string): ChildProcessWithoutNullStreams {
  // cross-spawn handles native executables and npm .cmd shims, including spaces,
  // empty arguments, JSON schemas, and shell metacharacters on Windows.
  const child = spawn(cli.command, args, {
    cwd, env: cli.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  activeChildren.add(child);
  child.once('close', () => activeChildren.delete(child));
  return child;
}

function stopCli(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = nativeSpawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', () => { child.kill(); });
    killer.unref();
  } else child.kill();
}

export function registerAiCliLifecycle(): void {
  app.once('before-quit', () => { for (const child of activeChildren) stopCli(child); });
}

export async function checkAiCli(settings: AiSettings): Promise<AiCliCheck> {
  let executable: string | null = null;
  try {
    const cli = resolveAiCli(settings);
    executable = cli.command;
    const version = await new Promise<string>((resolve, reject) => {
      const child = startCli(cli, ['--version'], os.tmpdir());
      let output = '';
      const timer = setTimeout(() => { stopCli(child); reject(new Error('CLI version check timed out.')); }, 10_000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { output = (output + chunk).slice(0, 4000); });
      child.stderr.on('data', (chunk: string) => { output = (output + chunk).slice(0, 4000); });
      child.stdin.on('error', () => undefined);
      child.once('error', () => { clearTimeout(timer); reject(new Error('CLI could not start. Check the executable path.')); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0 && output.trim()) resolve(output.trim().slice(0, 300));
        else reject(new Error('CLI version check failed. Run the selected CLI in a terminal.'));
      });
      child.stdin.end();
    });
    return { ok: true, executable, version, error: null };
  } catch (error) {
    return { ok: false, executable, version: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runAiPrompt(prompt: string, options: { schema?: object; vocabulary?: boolean; signal?: AbortSignal } = {}): Promise<string> {
  const settings = await getAiSettings();
  const provider = settings.provider;
  const label = AI_PROVIDER_LABELS[provider];
  const login = provider === 'codex' ? 'codex login' : 'claude auth login';
  const cli = resolveAiCli(settings);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bachnv6-ai-'));
  const outputPath = path.join(directory, 'answer.json');
  try {
    let args: string[];
    const model = settings[provider].model;
    if (provider === 'codex') {
      args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only'];
      if (model) args.push('--model', model);
      else if (options.vocabulary) args.push('--model', 'gpt-6-luna', '--config', 'model_reasoning_effort=low');
      if (options.schema) {
        const schemaPath = path.join(directory, 'schema.json');
        await fs.writeFile(schemaPath, JSON.stringify(options.schema), { mode: 0o600 });
        args.push('--output-schema', schemaPath, '--output-last-message', outputPath);
      } else args.push('--json');
      args.push('-');
    } else {
      const settingsPath = path.join(directory, 'settings.json');
      const mcpPath = path.join(directory, 'mcp.json');
      await fs.writeFile(settingsPath, JSON.stringify({ disableAllHooks: true }), { mode: 0o600 });
      await fs.writeFile(mcpPath, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
      args = ['--print', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', mcpPath,
        '--setting-sources', '', '--settings', settingsPath, '--no-session-persistence'];
      if (model) args.push('--model', model);
      if (options.schema) args.push('--json-schema', JSON.stringify(options.schema));
    }
    if (options.signal?.aborted) throw new Error('Reply stopped.');
    const output = await new Promise<string>((resolve, reject) => {
      const child = startCli(cli, args, directory);
      let stdout = '', stderr = '', failure: Error | undefined;
      const abort = () => { failure = new Error('Reply stopped.'); stopCli(child); };
      options.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => { failure = new Error('The AI request timed out. Please try again.'); stopCli(child); }, 120_000);
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (failure) return;
        stdout += chunk;
        if (stdout.length > 1_000_000) { failure = new Error(`${label} returned too much output.`); stopCli(child); }
      });
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2500); });
      child.stdin.on('error', () => undefined);
      child.once('error', () => { cleanup(); reject(new Error(`${label} could not start. Check Settings and run “${login}”.`)); });
      child.once('close', code => {
        cleanup();
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(/login|sign in|auth/i.test(stderr + stdout)
          ? `Sign in with “${login}” to use ${label}.`
          : `${label} could not complete the request. Run it in a terminal to check sign-in, model access, and CLI updates.`));
        else resolve(stdout);
      });
      child.stdin.end(prompt);
    });
    if (provider === 'claude') {
      const result = parseCliJson(output, label);
      if (result.is_error) throw new Error(`Claude CLI could not reply. Run “${login}” and check your model access in a terminal.`);
      if (options.schema && result.structured_output) return JSON.stringify(result.structured_output);
      if (!options.schema && typeof result.result === 'string' && result.result.trim()) return result.result.slice(0, 16000);
    } else if (options.schema) {
      const stat = await fs.stat(outputPath);
      if (stat.size > 1_000_000) throw new Error('The AI returned too much output.');
      return await fs.readFile(outputPath, 'utf8');
    } else {
      let answer = '';
      let failed = false;
      for (const line of output.split(/\r?\n/).filter(line => line.trim())) {
        const event = parseCliJson(line, label);
        const item = event.item as Record<string, unknown> | undefined;
        if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') answer = item.text;
        if (event.type === 'turn.failed' || event.type === 'error') failed = true;
      }
      if (!failed && answer.trim()) return answer.slice(0, 16000);
    }
    throw new Error(`${label} did not return a valid answer. Check the selected model and update the CLI, then try again.`);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Usage is a Codex-specific protocol, but shares discovery and path settings. */
export async function startCodexAppServer(): Promise<ChildProcessWithoutNullStreams> {
  const settings = await getAiSettings();
  if (settings.provider !== 'codex') throw new Error('Usage reporting is available only with Codex CLI.');
  return startCli(resolveAiCli(settings, 'codex'), ['app-server']);
}
