/* Build first. Offline checks use fake CLIs and a disposable application profile. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'out', 'validation', 'ai-settings');

if (!process.versions.electron) {
  // Exercise discovery for both OS families without requiring a second machine.
  const Module = require('node:module');
  const ts = require('typescript');
  const filename = path.join(root, 'src', 'ai-cli.test.cjs');
  const compiled = new Module(filename);
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled.require = request => request === './ai-settings-service' ? {} : request === 'electron' ? {}
    : request === './shared/ai-settings-types' ? { AI_PROVIDER_LABELS: { codex: 'Codex CLI', claude: 'Claude CLI' } }
      : Module.prototype.require.call(compiled, request);
  compiled._compile(ts.transpileModule(fs.readFileSync(path.join(root, 'src', 'ai-cli.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  const settings = { provider: 'claude', codex: { executable: '', model: '' }, claude: { executable: '', model: '' } };
  const originals = { statSync: fs.statSync, accessSync: fs.accessSync, readdirSync: fs.readdirSync };
  try {
    let available = new Set(['/home/test/.nvm/versions/node/v24.0.0/bin/claude']);
    fs.statSync = file => { if (!available.has(file)) throw new Error('ENOENT'); return { isFile: () => true }; };
    fs.accessSync = file => { if (!available.has(file)) throw new Error('ENOENT'); };
    fs.readdirSync = () => ['v20.0.0', 'v24.0.0'].map(name => ({ name, isDirectory: () => true }));
    const unix = compiled.exports.resolveAiCli(settings, 'claude', { PATH: '/usr/bin:/bin' }, '/home/test', 'linux');
    assert.equal(unix.command, [...available][0]);
    assert(unix.env.PATH.startsWith('/home/test/.nvm/versions/node/v24.0.0/bin:'));
    available = new Set(['C:\\Users\\Tester\\.local\\bin\\claude.exe']);
    const windows = compiled.exports.resolveAiCli(settings, 'claude', { PATH: 'C:\\bad', Path: 'C:\\other' }, 'C:\\Users\\Tester', 'win32');
    assert.equal(windows.command, [...available][0]);
    assert.equal(Object.keys(windows.env).filter(key => key.toLowerCase() === 'path').length, 1);
    assert.throws(() => compiled.exports.resolveAiCli({ ...settings, claude: { executable: 'C:\\missing.exe', model: '' } }, 'claude', {}, 'C:\\Users\\Tester', 'win32'), /configured path/);
    console.log('PASS Linux NVM discovery, Windows native discovery, PATH casing, explicit-path failures');
  } finally { Object.assign(fs, originals); }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bachnv6-ai-settings-'));
  const fixtures = path.join(profile, 'cli tools & (test)');
  fs.mkdirSync(fixtures);
  const fixture = path.join(fixtures, 'fake-cli.cjs');
  fs.writeFileSync(fixture, `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    const readline = require('node:readline');
    const provider = process.argv[2];
    const args = process.argv.slice(3);
    fs.appendFileSync(process.env.AI_TEST_LOG, JSON.stringify({provider, args, pid:process.pid}) + '\\n');
    if (args.includes('--version')) { console.log(provider + ' test-version'); process.exit(0); }
    if (args.includes('app-server')) {
      readline.createInterface({input:process.stdin}).on('line', line => {
        const request = JSON.parse(line);
        if (request.id === undefined) return;
        const result = request.method === 'account/read' ? {account:{type:'chatgpt',planType:'test'}}
          : request.method === 'account/rateLimits/read' ? {rateLimits:{primary:{usedPercent:12,windowDurationMins:300,resetsAt:1800000000}}} : {};
        console.log(JSON.stringify({id:request.id,result}));
      });
      return;
    }
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', data => input += data);
    process.stdin.on('end', () => {
      if (provider === 'codex') {
        assert(args.includes('read-only') && args.includes('--ignore-user-config') && args.includes('--ephemeral'));
      } else {
        assert(args.includes('--print') && args.includes('--no-session-persistence'));
        assert.equal(args[args.indexOf('--tools') + 1], '');
        assert.equal(args[args.indexOf('--setting-sources') + 1], '');
        assert(args.includes('--strict-mcp-config'));
        assert.deepEqual(JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')), {mcpServers:{}});
        assert.equal(JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8')).disableAllHooks, true);
      }
      const request = input.includes('Words (JSON):') ? input : JSON.parse(input.slice(input.lastIndexOf('\\n') + 1)).conversation.at(-1).text;
      if (request.includes('hold-test')) {
        fs.appendFileSync(process.env.AI_TEST_LOG, JSON.stringify({provider,phase:'holding',pid:process.pid}) + '\\n');
        setTimeout(() => process.exit(0), 30000); return;
      }
      if (request.includes('auth-test')) { process.stderr.write('Please sign in'); process.exit(1); }
      if (request.includes('invalid-output-test')) { console.log('{}'); return; }
      if (input.includes('Words (JSON):')) {
        const words = JSON.parse(input.split('Words (JSON): ')[1]);
        const cards = words.map(word => ({word,meaning:provider + ' meaning',translation:'tiếng Việt',example:'Example of ' + word}));
        if (provider === 'codex') fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({cards}));
        else {
          assert.equal(JSON.parse(args[args.indexOf('--json-schema') + 1]).type, 'object');
          console.log(JSON.stringify({type:'result',is_error:false,structured_output:{cards}}));
        }
      } else {
        const answer = provider + ' fox reply 🦊';
        const event = provider === 'codex' ? {type:'item.completed',item:{type:'agent_message',text:answer}}
          : {type:'result',is_error:false,result:answer};
        const bytes = Buffer.from(JSON.stringify(event) + '\\n');
        const split = bytes.indexOf(Buffer.from('🦊')) + 1;
        process.stdout.write(bytes.subarray(0,split));
        setTimeout(() => { process.stdout.write(bytes.subarray(split)); },30);
      }
    });
  `);
  for (const provider of ['codex', 'claude']) {
    const file = path.join(fixtures, provider + (process.platform === 'win32' ? '.cmd' : ''));
    fs.writeFileSync(file, process.platform === 'win32'
      ? `@"${process.execPath}" "${fixture}" ${provider} %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${fixture}" ${provider} "$@"\n`);
    if (process.platform !== 'win32') fs.chmodSync(file, 0o700);
  }
  let passed = false;
  try {
    for (const stage of ['create', 'restore']) {
      const result = require('node:child_process').spawnSync(require('electron'), [
        ...(process.env.DESKTOP_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), __filename,
      ], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000,
        env: { ...process.env, AI_TEST_PROFILE: profile, AI_TEST_STAGE: stage, AI_TEST_LOG: path.join(profile, 'calls.jsonl'),
          PATH: [fixtures, process.env.PATH || process.env.Path || ''].join(path.delimiter), ELECTRON_RUN_AS_NODE: undefined } });
      assert.equal(result.status, 0, `${stage}: ${result.error?.message || result.signal || result.status}`);
    }
    passed = true;
  } finally {
    assert(path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-ai-settings-'));
    if (passed) fs.rmSync(profile, { recursive: true, force: true });
    else console.error(`Debug profile: ${profile}`);
  }
} else {
  const { app, BrowserWindow } = require('electron');
  const profile = process.env.AI_TEST_PROFILE;
  assert(profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-ai-settings-'));
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('disable-gpu');
  require(path.join(root, '.vite', 'build', 'main.js'));
  let window;
  const run = code => window.webContents.executeJavaScript(code, true);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(code, description) {
    const deadline = Date.now() + 14000;
    while (Date.now() < deadline) { if (await run(code)) return; await pause(80); }
    throw new Error('Timed out: ' + description);
  }
  const settings = () => run('window.dashboard.aiSettings.get()');
  const save = value => run(`window.dashboard.aiSettings.save(${JSON.stringify(value)})`);
  const chat = value => run(`window.dashboard.companion.chat(${JSON.stringify(value)})`);
  const state = () => run('window.dashboard.companion.get()');
  const calls = () => fs.existsSync(process.env.AI_TEST_LOG) ? fs.readFileSync(process.env.AI_TEST_LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const setValue = (selector, value, eventName = 'input') => run(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event(${JSON.stringify(eventName)}, {bubbles:true}));
  })()`);
  async function capture(name) {
    fs.mkdirSync(output, { recursive: true });
    await pause(100);
    fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG());
  }
  app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 110000);
    try {
      for (let i = 0; i < 100; i++) {
        window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('main_window'));
        if (window && !window.webContents.isLoading()) break;
        await pause(100);
      }
      assert(window);
      window.webContents.setBackgroundThrottling(false);
      await until(`Boolean(window.dashboard?.aiSettings && document.querySelector('[aria-label="App settings"]'))`, 'settings ready');
      if (process.env.AI_TEST_STAGE === 'restore') {
        const stored = await settings();
        assert.equal(stored.provider, 'claude');
        assert.equal(stored.claude.model, 'test-claude');
        assert(stored.codex.executable.includes('cli tools & (test)'));
        await until(`Boolean(document.querySelector('[aria-label="Claude CLI usage"]'))`, 'restored provider');
        assert(!calls().slice(-1).some(call => call.args?.includes('app-server')));
        await chat('restored chat');
        assert.equal((await state()).messages.at(-1).text, 'claude fox reply 🦊');
        console.log('PASS saved provider, separate paths/models, chat and provider UI survive restart');
      } else {
        assert.equal((await settings()).provider, 'codex');
        const initial = await settings();
        await assert.rejects(save({ ...initial, provider: 'invalid' }), /Choose/);
        await assert.rejects(save({ ...initial, codex: { executable: 'codex && echo unsafe', model: '' } }), /absolute/);
        const initialCheck = await run(`window.dashboard.aiSettings.check(${JSON.stringify(initial)})`);
        assert(initialCheck.ok, JSON.stringify(initialCheck));
        assert(initialCheck.executable.includes('cli tools & (test)'));
        const cliPath = provider => path.join(profile, 'cli tools & (test)', provider + (process.platform === 'win32' ? '.cmd' : ''));
        const configured = { provider: 'codex', codex: { executable: cliPath('codex'), model: 'test-codex' }, claude: { executable: cliPath('claude'), model: 'test-claude' } };
        for (const provider of ['codex', 'claude']) {
          configured.provider = provider;
          await save(configured);
          const detected = await run(`window.dashboard.aiSettings.check(${JSON.stringify(configured)})`);
          assert(detected.ok && detected.version.includes(provider), JSON.stringify(detected));
          await chat('quote " & | < > %PATH% $(echo unsafe) 🦊');
          assert.equal((await state()).messages.at(-1).text, provider + ' fox reply 🦊');
          const cards = await run(`window.dashboard.vocabulary.generate('${provider}-word')`);
          assert.equal(cards[0].meaning, provider + ' meaning');
          assert.equal(cards[0].translation, 'tiếng Việt');
          const aiCall = calls().filter(call => call.provider === provider && call.args?.includes('--model')).at(-1);
          assert.equal(aiCall.args[aiCall.args.indexOf('--model') + 1], 'test-' + provider);
          await chat('auth-test');
          assert((await state()).messages.at(-1).text.includes(provider === 'codex' ? 'codex login' : 'claude auth login'));
          await chat('invalid-output-test');
          assert.equal((await state()).messages.at(-1).role, 'notice');
          // The saved provider may change while the current request is running.
          const beforeHold = calls().length;
          const pending = chat('hold-test');
          await until(`window.dashboard.companion.get().then(s => s.busy)`, 'reply running');
          for (let i = 0; !calls().slice(beforeHold).some(call => call.phase === 'holding') && i < 100; i++) await pause(50);
          const holding = calls().slice(beforeHold).find(call => call.phase === 'holding');
          assert(holding && holding.provider === provider, 'Selected provider is running before switching');
          await save({ ...configured, provider: provider === 'codex' ? 'claude' : 'codex' });
          await run('window.dashboard.companion.cancel()');
          await pending;
          assert((await state()).messages.at(-1).text.includes('stopped'));
          assert.throws(() => process.kill(holding.pid, 0), /ESRCH/);
          await save(configured);
          console.log(`PASS ${provider} version, quoted paths, Unicode, stdin isolation, model, chat, schema flashcards, errors, cancellation during provider switch`);
        }
        const before = calls().length;
        const usage = await run('window.dashboard.usage.refresh()');
        assert.equal(usage.status, 'unavailable');
        assert.equal(usage.windows.length, 0);
        await assert.rejects(run('window.dashboard.usage.useReset(null)'), /only with Codex/);
        assert.equal(calls().length, before);
        const missing = await run(`window.dashboard.aiSettings.check(${JSON.stringify({ ...configured, claude: { executable: path.join(profile, 'missing' + (process.platform === 'win32' ? '.exe' : '')), model: '' } })})`);
        assert.equal(missing.ok, false);
        assert.match(missing.error, /configured path/);
        console.log('PASS Claude mode never launches Codex for usage or resets; missing CLI has an actionable error');

        const rename = fs.promises.rename;
        fs.promises.rename = async (from, to) => { if (to === path.join(profile, 'ai-settings.json')) throw new Error('Simulated save failure'); return rename(from, to); };
        try { await assert.rejects(save({ ...configured, provider: 'codex' }), /Could not save/); }
        finally { fs.promises.rename = rename; }
        assert.equal((await settings()).provider, 'claude');
        assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'ai-settings.json'), 'utf8')).provider, 'claude');
        console.log('PASS failed settings writes preserve the saved and active provider');

        await run(`document.querySelector('[aria-label="Switch to dark mode"]')?.click()`);
        await until(`document.documentElement.dataset.theme === 'dark'`, 'dark theme');
        await run(`document.querySelector('[aria-label="App settings"]').click()`);
        await until(`document.querySelector('dialog[open] #ai-provider')?.value === 'claude'`, 'settings dialog');
        await setValue('#ai-provider', 'codex', 'change');
        await run(`document.querySelector('dialog button[aria-label="Close settings"]').click()`);
        assert.equal((await settings()).provider, 'claude');
        await run(`document.querySelector('[aria-label="App settings"]').click()`);
        await until(`document.querySelector('dialog[open] #ai-model')?.value === 'test-claude'`, 'restored draft');
        await run(`[...document.querySelectorAll('dialog button')].find(b => b.textContent === 'Check CLI').click()`);
        await until(`document.querySelector('dialog [role="status"]')?.textContent.includes('detected')`, 'version UI');
        await capture('settings-dark.png');
        await run(`document.querySelector('dialog [aria-label="Close settings"]').click()`);
        await run(`document.querySelector('[aria-label="Switch to light mode"]')?.click()`);
        await run(`document.querySelector('[aria-label="App settings"]').click()`);
        await until(`document.querySelector('dialog[open] #ai-model')?.value === 'test-claude'`, 'light dialog');
        await setValue('#ai-model', 'test-claude');
        await run(`document.querySelector('dialog form').requestSubmit()`);
        await until(`!document.querySelector('dialog[open]')`, 'saved dialog');
        window.setMinimumSize(360, 500); window.setSize(430, 740);
        await run(`document.querySelector('[aria-label="App settings"]').click()`);
        await until(`document.querySelector('dialog[open] #ai-model')?.value === 'test-claude'`, 'narrow dialog');
        assert.equal(await run(`(() => { const d = document.querySelector('dialog'); return d.scrollWidth <= d.clientWidth + 1; })()`), true);
        assert.equal(await run(`document.documentElement.scrollWidth <= innerWidth + 1`), true);
        await capture('settings-light-narrow.png');
        await run(`document.querySelector('dialog [aria-label="Close settings"]').click()`);
        console.log('PASS settings cancel/save, CLI check feedback, light/dark themes and narrow layout');

        const foreign = new BrowserWindow({ show: false, webPreferences: {
          preload: path.join(root, '.vite', 'build', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
        } });
        await foreign.loadURL('about:blank');
        await assert.rejects(foreign.webContents.executeJavaScript('window.dashboard.aiSettings.get()'), /Unknown window/);
        foreign.destroy();
        console.log('PASS settings IPC rejects another window');
      }
      clearTimeout(timeout); app.quit();
    } catch (error) { clearTimeout(timeout); console.error(error); app.exit(1); }
  });
}
