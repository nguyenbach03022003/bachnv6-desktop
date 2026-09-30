import { accessSync, constants, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Desktop launchers don't inherit the interactive shell's NVM PATH. */
export function findUnixCodexCommand(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): {
  command: string;
  env: NodeJS.ProcessEnv;
} {
  const folders = (env.PATH || '/usr/local/bin:/usr/bin:/bin').split(path.delimiter);
  folders.push(path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), '/opt/homebrew/bin');
  if (env.NVM_BIN) folders.push(env.NVM_BIN);
  const versionsPath = path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions', 'node');
  try {
    const versions = readdirSync(versionsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v\d+\.\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    for (const version of versions) folders.push(path.join(versionsPath, version, 'bin'));
  } catch { /* NVM is optional. */ }
  const searchFolders = [...new Set(folders.map((folder) => folder.replace(/^"|"$/g, '').trim()))]
    .filter((folder) => path.isAbsolute(folder));
  for (const folder of searchFolders) {
    const command = path.join(folder, 'codex');
    try { accessSync(command, constants.X_OK); }
    catch { continue; }
    // npm's Codex launcher uses /usr/bin/env node. Include its Node installation
    // even when Ubuntu starts the app with only the system PATH.
    return { command, env: { ...env, PATH: [...new Set([folder, ...searchFolders])].join(path.delimiter) } };
  }
  throw new Error('Codex CLI was not found. Install it, run “codex login”, then refresh AI usage.');
}
