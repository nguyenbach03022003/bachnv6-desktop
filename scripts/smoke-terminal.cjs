/* Build first. Real PTYs, a temporary profile, and browser input events. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bachnv6-terminal-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [...(process.env.DESKTOP_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), __filename], {
      cwd: root, stdio: 'inherit', windowsHide: true, timeout: 90000,
      env: { ...process.env, TERMINAL_SMOKE_PROFILE: profile },
    });
    assert.equal(result.status, 0, result.error?.message || result.signal || 'Terminal smoke failed');
  } finally {
    assert(path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-terminal-'));
    fs.rmSync(profile, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow } = require('electron');
  process.on('uncaughtException', reason => { console.error(reason); app.exit(1); });
  const profile = process.env.TERMINAL_SMOKE_PROFILE;
  assert(profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-terminal-'));
  app.setPath('userData', profile);
  app.disableHardwareAcceleration();
  require(path.join(root, '.vite/build/main.js'));
  let win;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const run = code => win.webContents.executeJavaScript(code, true);
  const check = text => console.log(`PASS ${text}`);
  async function until(code, description) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (await run(code)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${description}`);
  }
  const order = () => run(`[...document.querySelectorAll('[aria-label="Terminal tabs"] [role="tab"]')].map(tab => tab.getAttribute('aria-label'))`);
  const select = name => run(`document.querySelector('[role="tab"][aria-label=${JSON.stringify(name)}]').click()`);
  async function typeText(text) {
    for (const key of text) {
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyDown', key, text:key, unmodifiedText:key, windowsVirtualKeyCode:/^[a-z]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : 0});
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyUp', key, windowsVirtualKeyCode:/^[a-z]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : 0});
    }
  }
  async function toggleTyping(extraKey) {
    await run(`(() => {
      const target = document.activeElement;
      target.dispatchEvent(new KeyboardEvent('keydown',{key:'Control',ctrlKey:true,bubbles:true,cancelable:true}));
      target.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));
      ${extraKey ? `target.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(extraKey)},ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));` : ''}
      target.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',ctrlKey:true,bubbles:true,cancelable:true}));
      target.dispatchEvent(new KeyboardEvent('keyup',{key:'Control',bubbles:true,cancelable:true}));
    })()`);
    await pause(100);
  }
  async function command(marker, typedMarker = marker) {
    marker = marker.toLowerCase();
    await until(`!document.querySelector('[role="tabpanel"]:not([hidden]) [role="status"]')`, 'ready terminal');
    await run(`document.querySelector('[role="tabpanel"]:not([hidden]) .xterm-helper-textarea').focus()`);
    const text = process.platform === 'win32' ? `Write-Output ('${typedMarker.toLowerCase()}' + $PID)` : `printf '${typedMarker.toLowerCase()}%s\\n' "$$"`;
    await typeText(text);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await until(`[...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .xterm-rows > div')].some(row => row.textContent.trim().startsWith(${JSON.stringify(marker)}))`, marker);
    return run(`[...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .xterm-rows > div')].find(row => row.textContent.trim().startsWith(${JSON.stringify(marker)})).textContent.trim().slice(${marker.length})`);
  }
  async function drag(source, target, side) {
    const boxes = await run(`(() => {
      const source = document.querySelector('[role="tab"][aria-label=${JSON.stringify(source)}]').getBoundingClientRect();
      const target = document.querySelector('[role="tab"][aria-label=${JSON.stringify(target)}]').parentElement.getBoundingClientRect();
      return { x: source.left + source.width/2, y: source.top + source.height/2, tx: ${side === 'before' ? 'target.left+3' : 'target.right-3'}, ty: target.top + target.height/2 };
    })()`);
    let intercepted;
    const listener = (_event, method, params) => { if (method === 'Input.dragIntercepted') intercepted = params.data; };
    win.webContents.debugger.on('message', listener);
    try {
      await win.webContents.debugger.sendCommand('Input.setInterceptDrags', { enabled: true });
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved', x:boxes.x, y:boxes.y});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mousePressed', x:boxes.x, y:boxes.y, button:'left', buttons:1, clickCount:1});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved', x:boxes.x+12, y:boxes.y, button:'left', buttons:1});
      const deadline = Date.now() + 3000;
      while (!intercepted && Date.now() < deadline) await pause(50);
      assert(intercepted, 'Native browser drag did not start');
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await win.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type, x:boxes.tx, y:boxes.ty, data:intercepted });
      }
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseReleased', x:boxes.tx, y:boxes.ty, button:'left', buttons:0, clickCount:1});
    } finally {
      win.webContents.debugger.off('message', listener);
      await win.webContents.debugger.sendCommand('Input.setInterceptDrags', {enabled:false});
    }
    await pause(150);
  }
  app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 80000);
    try {
      for (let i = 0; i < 100; i++) {
        win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('main_window'));
        if (win && !win.webContents.isLoading()) break;
        await pause(100);
      }
      assert(win);
      win.webContents.setBackgroundThrottling(false);
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:true});
      win.focus();
      const firstPid = await command('FIRST_PID:');
      assert(/^\d+$/.test(firstPid), firstPid);
      await run(`document.querySelector('[aria-label="New terminal"]').click()`);
      const secondPid = await command('SECOND_PID:');
      assert.notEqual(firstPid, secondPid);
      await run(`globalThis.originalPanes = [...document.querySelectorAll('[role="tabpanel"]')].map(pane => ({id:pane.id, element:pane, terminal:pane.querySelector('.xterm')}));`);
      await drag('Terminal 1', 'Terminal 2', 'after');
      assert.deepEqual(await order(), ['Terminal 2', 'Terminal 1']);
      assert.equal(await run(`document.querySelector('[role="tab"][aria-selected="true"]').getAttribute('aria-label')`), 'Terminal 2');
      assert.equal(await run(`originalPanes.every(p => document.getElementById(p.id) === p.element && p.element.querySelector('.xterm') === p.terminal)`), true);
      await select('Terminal 1');
      assert.equal(await command('REORDERED_FIRST_PID:'), firstPid);
      await drag('Terminal 1', 'Terminal 2', 'before');
      assert.deepEqual(await order(), ['Terminal 1', 'Terminal 2']);
      await select('Terminal 2');
      assert.equal(await command('REORDERED_SECOND_PID:'), secondPid);
      check('Real drag/drop moves tabs in both directions and preserves shell PIDs, output, and pane instances');
      await run(`const tab = document.querySelector('[role="tab"][aria-label="Terminal 2"]'); tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft',altKey:true,bubbles:true,cancelable:true}));`);
      await pause(100);
      assert.deepEqual(await order(), ['Terminal 2', 'Terminal 1']);
      assert.equal(await run(`document.activeElement.getAttribute('aria-label')`), 'Terminal 2');
      await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',altKey:true,bubbles:true,cancelable:true}));`);
      await pause(100);
      assert.deepEqual(await order(), ['Terminal 1', 'Terminal 2']);
      check('Alt+Arrow reorders tabs and retains keyboard focus');
      await select('Terminal 2');
      await run(`document.querySelector('[aria-label="Close Terminal 2"]').click()`);
      await until(`Boolean(document.querySelector('dialog[open]'))`, 'close dialog');
      assert.equal(await run('document.activeElement.textContent'), 'Cancel');
      assert.equal(await run(`document.querySelectorAll('.xterm').length`), 2);
      const output = path.join(root, 'out/validation');
      fs.mkdirSync(output, {recursive:true});
      await pause(200);
      fs.writeFileSync(path.join(output, 'terminal-close-confirmation.png'), (await win.webContents.capturePage()).toPNG());
      await run(`[...document.querySelector('dialog[open]').querySelectorAll('button')].find(b => b.textContent === 'Cancel').click()`);
      await until(`!document.querySelector('dialog[open]')`, 'cancel closes dialog');
      await until(`document.activeElement.getAttribute('aria-label') === 'Close Terminal 2'`, 'cancel restores tab focus');
      assert.equal(await command('CANCELLED_PID:'), secondPid);
      await run(`document.querySelector('[aria-label="Close Terminal 2"]').click()`);
      await until(`Boolean(document.querySelector('dialog[open]'))`, 'second close dialog');
      win.webContents.sendInputEvent({type:'keyDown', keyCode:'Escape'});
      win.webContents.sendInputEvent({type:'keyUp', keyCode:'Escape'});
      await until(`!document.querySelector('dialog[open]')`, 'Escape cancels');
      await until(`document.activeElement.getAttribute('aria-label') === 'Close Terminal 2'`, 'Escape restores tab focus');
      assert.equal(await command('ESCAPE_PID:'), secondPid);
      check('Close defaults to Cancel; Cancel and Escape keep the same running shell');
      await until(`Boolean(document.querySelector('button[aria-label^="Switch typing"]:not(:disabled)'))`, 'typing ready');
      await toggleTyping('c');
      assert.equal(await run('document.documentElement.dataset.inputLanguage'), 'en');
      await toggleTyping();
      assert.equal(await run('document.documentElement.dataset.inputLanguage'), 'vi');
      assert.equal(await command('tiếng việt pid:', 'tieengs vieetj pid:'), secondPid);
      check('Built-in Ctrl+Shift enables Telex; raw ASCII keystrokes produce Vietnamese in the same shell');
      await run(`document.querySelector('[aria-label="Message the fox"]').focus()`);
      await typeText('tieengs vieetj');
      assert.equal(await run(`document.querySelector('[aria-label="Message the fox"]').value`), 'tiếng việt');
      assert.equal(await run(`document.querySelector('[aria-label="Message the fox"]').closest('form').querySelector('button[type="submit"]').disabled`), false);
      await run(`document.querySelector('[aria-label="Message the fox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))`);
      assert.equal((await run('window.dashboard.companion.get()')).messages.length, 0);
      check('Telex updates the controlled chat field and composing Enter does not send');
      await run(`document.querySelector('[aria-label="Create note"]').click()`);
      await until(`Boolean(document.querySelector('[aria-label="Note content"][contenteditable="true"]'))`, 'notes editor');
      await run(`document.querySelector('[aria-label="Note content"]').focus()`);
      await typeText('tieengs vieetj ');
      assert.equal(await run(`document.querySelector('[aria-label="Note content"]').textContent.trim()`), 'tiếng việt');
      await until(`window.dashboard.notes.list().then(notes => JSON.stringify(notes).includes('tiếng việt'))`, 'Telex note saved');
      check('Telex works in the rich text editor and saves Vietnamese note content');
      await toggleTyping();
      assert.equal(await run('document.documentElement.dataset.inputLanguage'), 'en');
      await toggleTyping('v');
      assert.equal(await run('document.documentElement.dataset.inputLanguage'), 'en');
      check('Ctrl+Shift toggles once on release; Ctrl+Shift+C/V do not toggle');
      await run(`document.querySelector('[aria-label="Close Terminal 2"]').click()`);
      await until(`Boolean(document.querySelector('dialog[open]'))`, 'confirm dialog');
      await run(`[...document.querySelector('dialog[open]').querySelectorAll('button')].find(b => b.textContent === 'Close terminal').click()`);
      await until(`document.querySelectorAll('.xterm').length === 1 && !document.querySelector('dialog[open]')`, 'confirmed removal');
      assert.deepEqual(await order(), ['Terminal 1']);
      assert.equal(await command('SURVIVING_PID:'), firstPid);
      await run(`document.querySelector('[aria-label="Close Terminal 1"]').click()`);
      await until(`Boolean(document.querySelector('dialog[open]'))`, 'last terminal confirmation');
      await run(`[...document.querySelector('dialog[open]').querySelectorAll('button')].find(b => b.textContent === 'Close terminal').click()`);
      await until(`document.querySelectorAll('.xterm').length === 0`, 'last terminal closed');
      await run(`document.querySelector('[aria-label="New terminal"]').click()`);
      assert(/^\d+$/.test(await command('NEW_PID:')));
      check('Confirm closes only the requested tab; the last tab can be closed and a new shell opened');
      await run(`document.querySelector('button[aria-label^="Switch typing"]').click()`);
      await until(`document.documentElement.dataset.inputLanguage === 'vi'`, 'saved VI mode');
      win.webContents.reload();
      await until(`Boolean(document.querySelector('button[aria-label^="Switch typing"]:not(:disabled)'))`, 'typing restored');
      assert.equal(await run('document.documentElement.dataset.inputLanguage'), 'vi');
      check('Input language survives reload');
      clearTimeout(timeout);
      win.close();
      setTimeout(() => app.exit(0), 350);
    } catch (error) {
      console.error(error);
      if (win && !win.isDestroyed()) console.error(await run(`[...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .xterm-rows > div')].slice(0,16).map(row => row.textContent)`));
      clearTimeout(timeout);
      app.exit(1);
    }
  });
}
