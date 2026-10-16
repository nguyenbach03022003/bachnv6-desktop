/* Build first. Real PTYs, fake AI CLIs, and a temporary profile; no personal history or account access. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bachnv6-sessions-'));
  const fixture = path.join(profile, 'fake-cli.cjs');
  const work = path.join(profile, 'work folder Việt');
  fs.mkdirSync(work);
  fs.writeFileSync(fixture, `
    const fs = require('node:fs');
    if (!process.argv.includes('resume') && !process.argv.includes('--resume')) process.exit(0);
    fs.appendFileSync(${JSON.stringify(path.join(profile, 'invocations.jsonl'))}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}) + '\\n');
    console.log('RESTORED_AI_CONVERSATION');
  `);
  const cli = process.platform === 'win32' ? path.join(profile, 'fake ai.cmd') : path.join(profile, 'fake ai');
  fs.writeFileSync(cli, process.platform === 'win32' ? `@"${process.execPath}" "${fixture}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
  if (process.platform !== 'win32') fs.chmodSync(cli, 0o700);
  fs.writeFileSync(path.join(profile, 'ai-settings.json'), JSON.stringify({ provider: 'codex', codex: { executable: cli, model: '' }, claude: { executable: cli, model: '' } }));
  let passed = false;
  try {
    for (const stage of ['create', 'restore', 'verify-delete']) {
      if (stage === 'restore') {
        // Simulate a stale running flag left by an interrupted app, without leaking a live PTY.
        const file = path.join(profile, 'companion', 'sessions', 'index.json');
        const index = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const session of index.sessions) session.status = 'running';
        fs.writeFileSync(file, JSON.stringify(index));
      }
      const result = spawnSync(require('electron'), [...(process.env.DESKTOP_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), __filename], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000,
        env: { ...process.env, SESSIONS_PROFILE: profile, SESSIONS_STAGE: stage } });
      assert.equal(result.status, 0, `${stage}: ${result.error?.message || result.signal || result.status}`);
    }
    passed = true;
  } finally {
    assert(path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-sessions-'));
    if (passed) fs.rmSync(profile, { recursive: true, force: true }); else console.error(`Debug profile: ${profile}`);
  }
} else {
  const { app, BrowserWindow } = require('electron');
  process.on('uncaughtException', reason => { console.error(reason); app.exit(1); });
  const profile = process.env.SESSIONS_PROFILE;
  const stage = process.env.SESSIONS_STAGE;
  assert(profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-sessions-'));
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('disable-gpu');
  require(path.join(root, '.vite', 'build', 'main.js'));
  let win;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const run = code => win.webContents.executeJavaScript(code, true);
  const check = text => console.log(`PASS ${text}`);
  const list = () => run('window.dashboard.sessions.list()');
  const read = id => run(`window.dashboard.sessions.read(${JSON.stringify(id)})`);
  const write = (id, command) => run(`window.dashboard.writeTerminal(${JSON.stringify(id)}, ${JSON.stringify(command + '\r')})`);
  const clicks = (selector, text) => run(`[...document.querySelectorAll(${JSON.stringify(selector)} + ' button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const input = (selector, value) => run(`(() => {const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  async function until(code, description, timeout = 18000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await run(code)) return; await pause(100); }
    throw new Error(`Timed out: ${description}`);
  }
  const invocations = () => fs.existsSync(path.join(profile, 'invocations.jsonl')) ? fs.readFileSync(path.join(profile, 'invocations.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  async function untilInvocations(count) {
    for (let i = 0; i < 180; i++) { if (invocations().length >= count) return; await pause(100); }
    throw new Error(`Expected ${count} native CLI invocations`);
  }
  async function closeTab(name) {
    await run(`document.querySelector(${JSON.stringify(`[aria-label="Close ${name}"]`)}).click()`);
    await clicks('dialog[open]', 'Close terminal');
  }
  async function openSessions() {
    await clicks('[aria-label="Companion view"]', 'Sessions');
    await until(`Boolean(document.querySelector('[aria-label="Saved terminal sessions"] [data-session-id]'))`, 'session list rendered');
  }
  async function screenshot(name) {
    const folder = path.join(root, 'out', 'validation', 'sessions');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, name), (await win.webContents.capturePage()).toPNG());
  }
  app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 110000);
    try {
      for (let i = 0; i < 100; i++) {
        win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('main_window'));
        if (win && !win.webContents.isLoading()) break;
        await pause(100);
      }
      assert(win);
      win.webContents.on('console-message', event => { if (event.level === 'error') console.error(`Renderer: ${event.message}`); });
      win.webContents.setBackgroundThrottling(false);
      await until(`Boolean(window.dashboard?.sessions && document.querySelector('[aria-label="New terminal"]'))`, 'session API');
      await until(`window.dashboard.sessions.list().then(state => state.sessions.some(s => s.status === 'running' && s.name === 'Terminal 1'))`, 'initial terminal');
      if (stage === 'create') {
        const session = (await list()).sessions.find(s => s.status === 'running');
        const work = path.join(profile, 'work folder Việt');
        await until(`window.dashboard.sessions.read(${JSON.stringify(session.id)}).then(h => h.output.includes('>') || h.output.includes('$') || h.output.includes('#'))`, 'shell prompt');
        const marker = 'Saved conversation tiếng Việt 🦊';
        const command = process.platform === 'win32'
          ? `Set-Location -LiteralPath '${work.replace(/'/g, "''")}'; [Console]::WriteLine('${marker}'); [Console]::WriteLine([char]27 + ']7;' + ([System.Uri]::new((Get-Location).Path + '\\')).AbsoluteUri + [char]7)`
          : `cd '${work.replace(/'/g, "'\\''")}'; printf '${marker}\\n\\033]7;file://%s\\007' "$PWD"`;
        await write(session.id, command);
        await until(`window.dashboard.sessions.read(${JSON.stringify(session.id)}).then(h => h.output.includes(${JSON.stringify(marker)}) && h.session.cwd === ${JSON.stringify(work)})`, 'saved output and cwd');
        await run(`window.dashboard.companion.labelTerminal(${JSON.stringify(session.id)}, 'Saved work')`);
        await closeTab('Terminal 1');
        await until(`window.dashboard.sessions.list().then(state => state.sessions.find(s => s.id === ${JSON.stringify(session.id)}).status === 'closed')`, 'closed archive');
        assert((await read(session.id)).output.includes(marker));
        check('Closing a terminal saves Unicode output, name, and working directory');
        await openSessions();
        await until(`document.querySelector('[aria-label="Saved terminal sessions"]').textContent.includes('Saved work')`, 'session card');
        await clicks(`[data-session-id="${session.id}"]`, 'History & connection');
        await until(`Boolean(document.querySelector('[aria-label="Session history"][open]'))`, 'history dialog');
        assert((await run(`document.querySelector('[aria-label="Saved terminal output"]').textContent`)).includes(marker));
        const nativeId = randomUUID();
        await input('[aria-label="AI session ID"]', nativeId);
        await clicks('[aria-label="Session history"]', 'Save connection');
        await until(`window.dashboard.sessions.list().then(s => s.sessions.find(s => s.id === ${JSON.stringify(session.id)}).ai?.sessionId === ${JSON.stringify(nativeId)})`, 'connection saved');
        await until(`!document.querySelector('[aria-label="Close session history"]').disabled`, 'connection form settled');
        await screenshot('history-light.png');
        await run(`document.querySelector('[aria-label="Close session history"]').click()`);
        await clicks(`[data-session-id="${session.id}"]`, 'Resume Codex');
        await untilInvocations(1);
        assert.deepEqual(invocations()[0], { args: ['resume', nativeId], cwd: work });
        await until(`document.querySelector('.xterm-rows')?.textContent.includes('RESTORED_AI_CONVERSATION')`, 'resumed CLI');
        const before = invocations().length;
        await clicks(`[data-session-id="${session.id}"]`, 'Open terminal');
        await pause(300);
        assert.equal(invocations().length, before);
        assert.equal(await run(`document.querySelectorAll('.xterm').length`), 1);
        check('Resume runs the exact Codex session in its saved folder; opening a live session reuses its tab');
        await write(session.id, 'exit');
        await until(`window.dashboard.sessions.list().then(s => s.sessions.find(s => s.id === ${JSON.stringify(session.id)}).status === 'exited')`, 'shell exit');
        await clicks(`[data-session-id="${session.id}"]`, 'Resume Codex');
        await untilInvocations(2);
        assert.equal(await run(`document.querySelectorAll('.xterm').length`), 1);
        check('An exited shell can resume in its existing tab');
        await closeTab('Saved work');
        await until(`document.querySelectorAll('.xterm').length === 0`, 'closed resumed tab');
        await run(`window.dashboard.closeTerminal(${JSON.stringify(session.id)})`);
        const rename = fs.promises.rename;
        fs.promises.rename = async (from, to) => { if (to === path.join(profile, 'companion', 'sessions', 'index.json')) throw new Error('Simulated session save failure'); return rename(from, to); };
        try {
          assert.equal(await run(`window.dashboard.sessions.connect(${JSON.stringify(session.id)}, {provider:'claude',sessionId:${JSON.stringify(randomUUID())}}).then(() => false, () => true)`), true);
          assert.equal((await read(session.id)).session.ai.sessionId, nativeId);
        } finally { fs.promises.rename = rename; }
        check('A failed connection save preserves the previous session link');
        const second = await run(`window.dashboard.createTerminal(80, 24, {name:'Claude work'})`);
        await until(`window.dashboard.sessions.read(${JSON.stringify(second.id)}).then(h => h.output.includes('>') || h.output.includes('$') || h.output.includes('#'))`, 'second shell prompt');
        const printedId = randomUUID();
        await write(second.id, process.platform === 'win32' ? `[Console]::WriteLine('codex resume ${printedId}')` : `printf 'codex resume ${printedId}\\n'`);
        await until(`window.dashboard.sessions.list().then(s => s.sessions.find(s => s.id === ${JSON.stringify(second.id)}).ai?.sessionId === ${JSON.stringify(printedId)})`, 'automatic resume detection');
        await pause(200);
        await run(`window.dashboard.sessions.connect(${JSON.stringify(second.id)}, null)`);
        await write(second.id, process.platform === 'win32' ? `[Console]::WriteLine('AFTER_DISCONNECT')` : `printf 'AFTER_DISCONNECT\\n'`);
        await until(`window.dashboard.sessions.read(${JSON.stringify(second.id)}).then(h => h.output.includes('AFTER_DISCONNECT'))`, 'post-disconnect output');
        await pause(200);
        assert.equal((await read(second.id)).session.ai, null);
        check('Explicit resume output connects a session; disconnect is preserved across later output');
        const beforeOutput = (await read(second.id)).output;
        const outputRename = fs.promises.rename;
        fs.promises.rename = async (from, to) => { if (to === path.join(profile, 'companion', 'sessions', `${second.id}.json`)) throw new Error('Simulated output failure'); return outputRename(from, to); };
        try {
          await write(second.id, process.platform === 'win32' ? `[Console]::WriteLine('RETRY_OUTPUT')` : `printf 'RETRY_OUTPUT\\n'`);
          await until(`window.dashboard.sessions.list().then(s => !!s.error)`, 'output save error');
          assert((await read(second.id)).output.includes('RETRY_OUTPUT'));
          assert((await read(second.id)).output.includes(beforeOutput.slice(-50)));
        } finally { fs.promises.rename = outputRename; }
        await until(`window.dashboard.sessions.list().then(s => !s.error)`, 'output save retry');
        check('Failed output saves retain the in-memory history and retry successfully');
        await write(second.id, process.platform === 'win32' ? `[Console]::Write('x' * 540000); [Console]::WriteLine('OUTPUT_END_🦊')` : `head -c 540000 /dev/zero | tr '\\000' x; printf 'OUTPUT_END_🦊\\n'`);
        await until(`window.dashboard.sessions.read(${JSON.stringify(second.id)}).then(h => h.session.truncated && h.output.includes('OUTPUT_END_🦊'))`, 'bounded output', 30000);
        assert((await read(second.id)).session.outputChars <= 512 * 1024);
        assert(!/^[\uDC00-\uDFFF]/.test((await read(second.id)).output));
        check('Noisy terminal output is bounded and retains complete Unicode characters');
        const claudeId = randomUUID();
        fs.writeFileSync(second.reportFile, JSON.stringify({ task: 'Save session connection', message: 'Ready to continue', status: 'waiting', cwd: work,
          ai: { provider: 'claude', sessionId: claudeId } }));
        await until(`window.dashboard.sessions.list().then(s => s.sessions.find(s => s.id === ${JSON.stringify(second.id)}).ai?.sessionId === ${JSON.stringify(claudeId)})`, 'report session connection');
        assert.equal((await read(second.id)).session.cwd, work);
        check('Automatic progress reports save the exact AI session ID and working folder');
        const invalid = await run(`Promise.all([
          window.dashboard.sessions.read('../secret'),
          window.dashboard.sessions.connect(${JSON.stringify(session.id)}, {provider:'codex',sessionId:'${nativeId};echo unsafe'}),
          window.dashboard.sessions.remove(${JSON.stringify(second.id)}),
          window.dashboard.createTerminal(80,24,{sessionId:${JSON.stringify(second.id)}})
        ].map(p => p.then(() => false, () => true)))`);
        assert(invalid.every(Boolean));
        check('IPC rejects invalid IDs, command injection, live deletion, and duplicate PTYs');
        fs.writeFileSync(path.join(profile, 'expected.json'), JSON.stringify({ id: session.id, nativeId, secondId: second.id, claudeId, marker, work }));
        await screenshot('sessions-light.png');
      } else {
        const expected = JSON.parse(fs.readFileSync(path.join(profile, 'expected.json'), 'utf8'));
        if (stage === 'verify-delete') {
          assert(!(await list()).sessions.some(s => s.id === expected.id));
          assert((await list()).sessions.some(s => s.id === expected.secondId));
          check('Deleted session stays deleted; other sessions remain after restart');
        } else {
          const state = await list();
          assert.equal(state.sessions.find(s => s.id === expected.id).status, 'closed');
          assert.equal(state.sessions.find(s => s.id === expected.secondId).status, 'closed');
          assert((await read(expected.id)).output.includes(expected.marker));
          check('Restart restores archived sessions and marks old PTYs as closed');
          await openSessions();
          const before = invocations().length;
          await clicks(`[data-session-id="${expected.secondId}"]`, 'Resume Claude');
          await untilInvocations(before + 1);
          assert.deepEqual(invocations().at(-1).args, ['--resume', expected.claudeId]);
          check('Claude resumes its own session even with Codex selected in Settings');
          await clicks(`[data-session-id="${expected.id}"]`, 'History & connection');
          await until(`Boolean(document.querySelector('[aria-label="Session history"][open]'))`, 'restored dialog');
          await clicks('[aria-label="Session history"]', 'Delete saved session');
          await clicks('[aria-label="Session history"]', 'Cancel');
          assert((await list()).sessions.some(s => s.id === expected.id));
          await clicks('[aria-label="Session history"]', 'Delete saved session');
          await clicks('[aria-label="Session history"]', 'Delete history');
          await until(`window.dashboard.sessions.list().then(s => !s.sessions.some(s => s.id === ${JSON.stringify(expected.id)}))`, 'session deletion');
          check('History deletion requires an explicit confirmation');
          win.setSize(1024, 800);
          await run(`document.querySelector('[aria-label="Switch to dark mode"]').click()`);
          await screenshot('sessions-dark.png');
          assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true);
        }
      }
      clearTimeout(timeout);
      app.quit();
    } catch (reason) { console.error(reason); clearTimeout(timeout); app.exit(1); }
  });
}
