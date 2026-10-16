/* Build first. Tests use a temporary profile and a fake CLI, never personal history. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'out', 'validation', 'companion');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bachnv6-companion-'));
  const fixture = path.join(profile, 'fake-cli.cjs');
  fs.writeFileSync(fixture, `
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', data => input += data);
    process.stdin.on('end', () => {
      if (!process.argv.includes('--json') || !process.argv.includes('read-only')) process.exit(2);
      const context = JSON.parse(input.slice(input.lastIndexOf('\\n') + 1));
      const request = context.conversation.at(-1).text;
      if (request.includes('fail-test')) { process.stderr.write('Please sign in with codex login'); process.exit(1); }
      if (request.includes('hold-test')) { setTimeout(() => process.exit(0), 30000); return; }
      if (!context.reports.some(report => report.task === 'Build dashboard' && report.status === 'completed')) process.exit(3);
      const data = Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Build dashboard is complete 🦊'}}) + '\\n');
      const split = data.indexOf(Buffer.from('🦊')) + 1;
      process.stdout.write(data.subarray(0, split));
      setTimeout(() => { process.stdout.write(data.subarray(split)); process.exit(0); }, 40);
    });
  `);
  if (process.platform === 'win32') fs.writeFileSync(path.join(profile, 'codex.cmd'), `@"${process.execPath}" "${fixture}" %*\r\n`);
  else { const file = path.join(profile, 'codex'); fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`); fs.chmodSync(file, 0o700); }
  const taskPath = process.platform === 'win32'
    ? [profile, path.dirname(process.execPath), path.join(process.env.SystemRoot, 'System32'), path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(path.delimiter)
    : [profile, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
  let passed = false;
  try {
    const stages = process.env.COMPANION_LIVE_CHAT === '1' ? ['live'] : ['create', 'restore', 'cleared'];
    for (const stage of stages) {
      const result = spawnSync(require('electron'), [...(process.env.DESKTOP_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), __filename], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 150000,
        env: { ...process.env, COMPANION_PROFILE: profile, COMPANION_STAGE: stage, ...(stage !== 'live' ? { PATH: taskPath, Path: taskPath } : {}) } });
      assert.equal(result.status, 0, `${stage}: ${result.error?.message || result.signal || result.status}`);
    }
    passed = true;
  } finally {
    assert(path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-companion-'));
    if (passed) fs.rmSync(profile, { recursive: true, force: true }); else console.error(`Debug profile: ${profile}`);
  }
} else {
  const { app, BrowserWindow } = require('electron');
  const profile = process.env.COMPANION_PROFILE;
  const stage = process.env.COMPANION_STAGE;
  assert(profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-companion-'));
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('disable-gpu');
  require(path.join(process.env.COMPANION_BUNDLE || path.join(root, '.vite', 'build'), 'main.js'));
  let window;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const run = code => window.webContents.executeJavaScript(code, true);
  const check = message => console.log(`PASS ${message}`);
  async function until(code, description, timeout = 14000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await run(code)) return; await pause(100); }
    throw new Error(`Timed out: ${description}`);
  }
  const clickText = (scope, label) => run(`[...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`);
  const input = (selector, value) => run(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  async function capture(name) { await pause(150); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG()); }
  app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 140000);
    try {
      for (let i = 0; i < 100; i++) {
        window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('main_window'));
        if (window && !window.webContents.isLoading()) break;
        await pause(100);
      }
      assert(window);
      window.webContents.on('console-message', (event) => { if (event.level === 'error') console.error(`Renderer: ${event.message}`); });
      window.webContents.setBackgroundThrottling(false);
      await until(`Boolean(window.dashboard?.companion && document.querySelector('[aria-label="Message the fox"]'))`, 'companion ready');
      if (stage === 'live') {
        await run(`window.dashboard.companion.chat('Please reply with a short greeting. Do not use tools.')`);
        const state = await run('window.dashboard.companion.get()');
        assert(state.messages.some(message => message.role === 'assistant'), JSON.stringify(state.messages));
        check('Signed-in Codex CLI returns a real fox chat reply');
      } else if (stage === 'cleared') {
        const state = await run('window.dashboard.companion.get()');
        assert.equal(state.messages.length, 0);
        assert(state.reports.some(report => report.task === 'Fix login'));
        assert.equal(await run(`document.querySelector('[aria-label="Clear chat"]').disabled`), true);
        check('Cleared chat stays empty after restart and saved reports remain');
      } else if (stage === 'restore') {
        const state = await run('window.dashboard.companion.get()');
        assert(state.messages.some(message => message.role === 'assistant' && message.text.includes('🦊')));
        assert(state.reports.some(report => report.task === 'Fix login' && report.message.includes('Tests passed')));
        assert.equal(state.busy, false);
        check('Chat, UTF-8 text, and reports restore after restart');
        await run(`document.querySelector('[aria-label="Companion view"] button:nth-child(2)').click()`);
        await clickText('[aria-label="Saved progress reports"]', 'Open terminal');
        await until(`document.querySelector('[aria-label="Desk companion"] [role="alert"]')?.textContent.includes('has closed')`, 'archived report feedback');
        check('Closed terminal reports remain readable with accurate feedback');
        await run(`document.querySelector('[aria-label="Companion view"] button:first-child').click()`);
        const beforeClear = await run('window.dashboard.companion.get()');
        const rename = fs.promises.rename;
        fs.promises.rename = async (from, to) => {
          if (to === path.join(profile, 'companion', 'history.json')) throw new Error('Simulated clear failure');
          return rename(from, to);
        };
        try {
          await clickText('[aria-label="Desk companion"]', 'Clear chat');
          await until(`document.querySelector('[aria-label="Desk companion"] [role="alert"]')?.textContent.includes('Simulated clear failure')`, 'clear error');
          assert.deepEqual((await run('window.dashboard.companion.get()')).messages, beforeClear.messages);
          assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'companion/history.json'), 'utf8')).messages, beforeClear.messages);
        } finally { fs.promises.rename = rename; }
        check('Failed chat deletion keeps the conversation on screen and disk');
        await clickText('[aria-label="Desk companion"]', 'Clear chat');
        await until(`window.dashboard.companion.get().then(state => state.messages.length === 0)`, 'chat cleared');
        assert.deepEqual((await run('window.dashboard.companion.get()')).reports, beforeClear.reports);
        await until(`document.querySelector('[aria-label="Clear chat"]').disabled && !document.querySelector('[aria-label="Fox conversation"] [data-role]')`, 'empty chat UI');
        assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'companion/history.json'), 'utf8')).messages.length, 0);
        check('Clear chat deletes saved messages without deleting reports');
      } else {
        await until(`Boolean(document.querySelector('.xterm-rows') && document.querySelector('[role="tabpanel"]:not([hidden]) button[title^="Leave a progress"]:not(:disabled)'))`, 'terminal ready');
        assert.equal(await run(`document.querySelectorAll('[aria-label="Live system metrics"] [aria-label$="metric"]').length`), 3);
        await run(`document.querySelector('[role="tabpanel"]:not([hidden]) button[title^="Leave a progress"]').click()`);
        await until(`Boolean(document.querySelector('[aria-label="Report task"]'))`, 'report draft form');
        await input('[aria-label="Report task"]', 'Fix login');
        await input('[aria-label="Progress report"]', 'Tests passed; ready to review.');
        await run(`document.querySelector('[aria-label="Report status"]').value = 'completed'; document.querySelector('[aria-label="Report status"]').dispatchEvent(new Event('change', {bubbles:true}))`);
        await clickText('[aria-label="Desk companion"]', 'Save report');
        await until(`document.querySelector('[aria-label="Saved progress reports"]')?.textContent.includes('Tests passed')`, 'report saved');
        const report = (await run('window.dashboard.companion.get()')).reports[0];
        assert.equal(report.status, 'completed');
        check('Terminal report form saves editable task, output, and status');
        await run(`document.querySelector('[aria-label="New terminal"]').click()`);
        await until(`document.querySelectorAll('.xterm').length === 2`, 'second terminal');
        await clickText('[aria-label="Saved progress reports"]', 'Open terminal');
        assert.equal(await run(`document.querySelector('[aria-label="Terminal tabs"] [role="tab"][aria-selected="true"]').textContent.trim()`), 'Terminal 1');
        check('Report opens its original terminal without restarting shells');
        await clickText('[role="tabpanel"]:not([hidden])', 'Connect reports');
        await clickText('[role="tabpanel"]:not([hidden])', 'Copy instruction');
        assert((await run('window.dashboard.readTerminalClipboard()')).includes('DESK_COMPANION_REPORT'));
        await clickText('[role="tabpanel"]:not([hidden])', 'Connect reports');
        const reportFile = path.join(profile, 'companion', 'reports', `${report.sessionId}.json`);
        fs.writeFileSync(reportFile, '\uFEFF' + JSON.stringify({ task: 'Build dashboard', message: 'Milestone one 🦊', status: 'working' }));
        await until(`window.dashboard.companion.get().then(state => state.reports.some(r => r.message === 'Milestone one 🦊'))`, 'report-file import');
        await pause(1300);
        assert.equal((await run('window.dashboard.companion.get()')).reports.length, 2);
        fs.writeFileSync(reportFile, '{');
        await pause(1200);
        assert.equal((await run('window.dashboard.companion.get()')).reports.length, 2);
        fs.writeFileSync(reportFile, JSON.stringify({ task: 'Build dashboard', message: 'Milestone two', status: 'completed' }));
        await until(`window.dashboard.companion.get().then(state => state.reports.length === 3)`, 'updated report import');
        check('Changed UTF-8 report files import once and recover from partial writes');
        const rename = fs.promises.rename;
        fs.promises.rename = async (from, to) => {
          if (to === path.join(profile, 'companion', 'history.json')) throw new Error('Simulated report save failure');
          return rename(from, to);
        };
        try {
          assert.equal(await run(`window.dashboard.companion.saveReport(${JSON.stringify({ sessionId: report.sessionId, source: report.source, task: 'Save failure test', message: 'Must remain unsaved', status: 'working' })}).then(() => false, () => true)`), true);
          assert.equal((await run('window.dashboard.companion.get()')).reports.length, 3);
        } finally { fs.promises.rename = rename; }
        check('Failed report writes leave saved history intact');
        const invalid = await run(`Promise.all([
          window.dashboard.companion.saveReport({sessionId:'../../file',source:'Terminal',task:'Task',message:'Text',status:'working'}),
          window.dashboard.companion.chat('x'.repeat(4001)),
          window.dashboard.companion.saveReport({sessionId:${JSON.stringify(report.sessionId)},source:'Terminal',task:'Task',message:'Text',status:'unknown'})
        ].map(promise => promise.then(() => false, () => true)))`);
        assert(invalid.every(Boolean));
        check('IPC rejects invalid IDs, oversized chat, and invalid statuses');
        await run(`document.querySelector('[aria-label="Companion view"] button:first-child').click()`);
        await input('[aria-label="Message the fox"]', 'How did Build dashboard go?');
        await clickText('[aria-label="Desk companion"]', 'Send');
        await until(`document.querySelector('[aria-label="Fox conversation"]').textContent.includes('Build dashboard is complete 🦊')`, 'fox reply');
        check('Chat UI sends to CLI and preserves split UTF-8 output');
        await run(`window.dashboard.companion.chat('fail-test')`);
        assert((await run('window.dashboard.companion.get()')).messages.at(-1).text.includes('codex login'));
        check('CLI authentication errors appear in the saved conversation');
        await run(`globalThis.pendingFox = window.dashboard.companion.chat('hold-test'); void 0`);
        await until(`window.dashboard.companion.get().then(state => state.busy)`, 'chat starts');
        assert.equal(await run(`document.querySelector('[aria-label="Clear chat"]').disabled`), true);
        const busyMessages = (await run('window.dashboard.companion.get()')).messages;
        assert.equal(await run(`window.dashboard.companion.clearChat().then(() => false, () => true)`), true);
        assert.deepEqual((await run('window.dashboard.companion.get()')).messages, busyMessages);
        check('Chat deletion is disabled and rejected while a reply is running');
        assert.equal(await run(`window.dashboard.companion.chat('duplicate').then(() => false, () => true)`), true);
        await run(`window.dashboard.companion.cancel();`);
        await run('globalThis.pendingFox');
        assert.equal((await run('window.dashboard.companion.get()')).messages.at(-1).text, 'Reply stopped.');
        assert.equal((await run('window.dashboard.companion.get()')).busy, false);
        check('Stop cancels the CLI process and concurrent chat is rejected');
        for (const [width, height, theme] of [[1320,800,'light'],[1024,800,'light'],[1320,800,'dark'],[980,660,'dark']]) {
          window.setSize(width, height);
          await run(`if (document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) document.querySelector('button[aria-label^="Switch to"]').click()`);
          await pause(150);
          const layout = await run(`(() => {
            const metrics = document.querySelector('[aria-label="Live system metrics"]').getBoundingClientRect();
            const fox = document.querySelector('[aria-label="Desk companion"]').getBoundingClientRect();
            const input = document.querySelector('[aria-label="Message the fox"]').getBoundingClientRect();
            const cards = [...document.querySelectorAll('[aria-label="Live system metrics"] [aria-label$="metric"]')].map(card => card.getBoundingClientRect());
            const weather = document.querySelector('[aria-label="Weather and desk companion"] > section:first-child').getBoundingClientRect();
            const terminal = document.querySelector('[aria-label="Terminal workspace"]').getBoundingClientRect();
            const clear = document.querySelector('[aria-label="Clear chat"]').getBoundingClientRect();
            const send = document.querySelector('[aria-label="Message the fox"]').closest('form').querySelector('button[type="submit"]').getBoundingClientRect();
            const inLeftColumn = innerWidth <= 980 || fox.right <= metrics.left;
            return { belowWeather: innerWidth <= 980 || fox.top >= weather.bottom, matchesWeather: Math.abs(fox.width-weather.width)<2, inLeftColumn, systemAboveTerminal: metrics.bottom <= terminal.top, horizontalMetrics: cards.every(card => Math.abs(card.top-cards[0].top)<2), inputFits: input.left >= fox.left && input.right <= fox.right && input.bottom <= fox.bottom, clearBesideSend: Math.abs(clear.top-send.top)<2 && clear.right <= send.left && send.right <= fox.right, readableInput: input.width >= 150, translationReplaced: !document.getElementById('translation-source'), noOverflow: document.documentElement.scrollWidth <= innerWidth };
          })()`);
          assert(Object.values(layout).every(Boolean), JSON.stringify(layout));
          await capture(`dashboard-${width}-${height}-${theme}.png`);
        }
        check('Desk companion replaces translation below weather, with horizontal metrics above the larger terminal');
      }
      clearTimeout(timeout);
      app.quit();
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
}
