const fs = require('node:fs');
const { randomBytes } = require('node:crypto');

const resultPath = process.env.PTY_SMOKE_RESULT;
if (!resultPath) throw new Error('PTY_SMOKE_RESULT is required');

function finish(result) {
  fs.writeFileSync(resultPath, JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

try {
  const pty = require(process.env.PTY_MODULE_PATH || 'node-pty');
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const args = process.platform === 'win32' ? ['-NoProfile', '-NoLogo'] : [];
  const child = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  const marker = `PTY_${randomBytes(8).toString('hex')}`;
  let output = '';
  const timeout = setTimeout(() => {
    finish({ ok: false, error: 'Timed out waiting for the shell command', output });
  }, 8000);
  child.onData((data) => {
    output += data;
    if (!output.includes(marker)) return;
    clearTimeout(timeout);
    finish({ ok: true, marker, output: output.slice(-500) });
  });
  child.onExit(({ exitCode }) => {
    clearTimeout(timeout);
    finish({ ok: false, error: `Shell exited early: ${exitCode}`, output });
  });
  const command = process.platform === 'win32'
    ? `Write-Output ([Text.Encoding]::UTF8.GetString([byte[]](${[...marker].map((letter) => letter.charCodeAt(0)).join(',')})))\r`
    : `printf "${[...marker].map((letter) => `\\${letter.charCodeAt(0).toString(8).padStart(3, '0')}`).join('')}\\n"\r`;
  child.write(command);
} catch (error) {
  finish({ ok: false, error: String(error && error.stack || error) });
}
