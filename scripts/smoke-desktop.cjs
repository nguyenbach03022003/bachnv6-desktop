/* Run after make:ubuntu/package. Uses a temporary profile, never personal notes. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'out', 'validation');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bachnv6-desktop-smoke-'));
  fs.mkdirSync(output, { recursive: true });
  let passed = false;
  try {
    for (const stage of ['create', 'restore']) {
      const result = spawnSync(require('electron'), [
        ...(process.env.DESKTOP_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), __filename,
      ], { cwd: root, stdio: 'inherit', timeout: 240_000,
        env: { ...process.env, DESKTOP_SMOKE_PROFILE: profile, DESKTOP_SMOKE_STAGE: stage } });
      assert.equal(result.status, 0, `${stage} failed: ${result.error?.message || result.signal || result.status}`);
    }
    passed = true;
    console.log(`Desktop smoke checks passed. Screenshot: ${path.join(output, 'dashboard.png')}`);
  } finally {
    if (passed) fs.rmSync(profile, { recursive: true, force: true });
    else console.error(`Debug profile retained at ${profile}`);
  }
} else {
  const { app, BrowserWindow } = require('electron');
  const profile = process.env.DESKTOP_SMOKE_PROFILE;
  assert(profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-desktop-smoke-'));
  app.setPath('userData', profile);
  // Reproduce Ubuntu desktop launchers without an interactive shell's NVM PATH.
  process.env.PATH = '/usr/local/bin:/usr/bin:/bin';
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('disable-gpu');
  require(path.join(root, '.vite', 'build', 'main.js'));

  const checks = [];
  let window;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code) => window.webContents.executeJavaScript(code, true);
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause(80);
  };
  async function until(code, description, timeout = 12_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await run(code)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${description}`);
  }
  function check(description) { checks.push(description); console.log(`PASS ${description}`); }

  async function printTerminal(text, controlPrefix = '') {
    await run(`document.querySelector('.xterm-helper-textarea').focus()`);
    const octal = [...(controlPrefix + text)].map((letter) => `\\${letter.charCodeAt(0).toString(8).padStart(3, '0')}`).join('');
    // xterm consumes keyboard events rather than Chromium's insertText command.
    for (const letter of `printf '${octal}\\n'`) {
      for (const type of ['keyDown', 'char', 'keyUp']) window.webContents.sendInputEvent({ type, keyCode: letter });
    }
    await key('Return');
    await until(`[...document.querySelectorAll('.xterm-rows > div')].some(n => n.textContent.trim() === ${JSON.stringify(text)})`, `terminal output ${text}`);
  }

  async function selectTerminal(text, modifiers = []) {
    const bounds = await run(`(() => {
      const row = [...document.querySelectorAll('.xterm-rows > div')].find(n => n.textContent.trim() === ${JSON.stringify(text)});
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const first = walker.nextNode();
      const range = document.createRange();
      range.setStart(first, 0);
      let remaining = ${text.length}, node = first;
      while (remaining > node.textContent.length) { remaining -= node.textContent.length; node = walker.nextNode(); }
      range.setEnd(node, remaining);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y + box.height / 2, end: box.right };
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(bounds.x + 1), y: Math.round(bounds.y), button: 'left', clickCount: 1, modifiers });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(bounds.end + 2), y: Math.round(bounds.y), button: 'left', modifiers });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(bounds.end + 2), y: Math.round(bounds.y), button: 'left', clickCount: 1, modifiers });
    await pause(100);
  }

  async function manualTranslation(text) {
    await run(`document.getElementById('translation-source').focus(); document.getElementById('translation-source').select()`);
    await window.webContents.insertText(text);
    await key('Return', ['control']);
    await until(`document.querySelector('[lang="vi"]').getAttribute('aria-busy') === 'false' && !document.querySelector('[lang="vi"]').textContent.includes('Translation will appear here.')`, 'manual translation');
  }

  app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Desktop smoke test timed out'); app.exit(1); }, 220_000);
    try {
      for (let i = 0; i < 100; i++) {
        window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('main_window'));
        if (window && !window.webContents.isLoading()) break;
        await pause(100);
      }
      assert(window);
      // Ubuntu may deny OS focus to an automated window. Keep DOM focus and
      // rendering active so real blur events and editor keyboard input work.
      window.webContents.setBackgroundThrottling(false);
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
      window.focus();
      await until(`Boolean(window.dashboard?.translation && document.querySelector('.xterm-rows'))`, 'dashboard and terminal');
      await until(`Boolean(document.querySelector('[aria-label="Desk companion"] button[aria-label="Boop the fox"]'))`, 'companion tile');
      const companion = await run(`(() => {
        const tile = document.querySelector('[aria-label="Desk companion"]');
        const cpu = [...document.querySelectorAll('article')].find(item => item.textContent.includes('CPU'));
        const tileBox = tile.getBoundingClientRect();
        const cpuBox = cpu.getBoundingClientRect();
        return { square: Math.abs(tileBox.width - tileBox.height) < 2, leftOfCpu: tileBox.right < cpuBox.left };
      })()`);
      assert(companion.square && companion.leftOfCpu);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      if (process.env.DESKTOP_SMOKE_STAGE === 'create') {
        window.setSize(1024, 800);
        await pause(180);
        const compact = await run(`(() => {
          const cards = [...document.querySelectorAll('[aria-label="Live system metrics and desk companion"] > article')].map(item => item.getBoundingClientRect());
          return { square: Math.abs(cards[0].width - cards[0].height) < 2,
            cpuBeside: cards[1].left > cards[0].right && Math.abs(cards[1].top - cards[0].top) < 2,
            memoryBelow: cards[2].top >= cards[0].bottom && cards[2].width > cards[0].width,
            networkBesideMemory: cards[3].left > cards[2].right && Math.abs(cards[3].top - cards[2].top) < 2 };
        })()`);
        assert(Object.values(compact).every(Boolean), JSON.stringify(compact));
        fs.writeFileSync(path.join(output, 'dashboard-compact.png'), (await window.webContents.capturePage()).toPNG());
        window.setSize(1320, 800);
        await pause(180);
      }
      await run(`document.querySelector('[aria-label="Desk companion"]').click()`);
      await until(`document.querySelector('button[aria-label="Boop the fox"] > span > span:last-child')?.style.opacity === '1'`, 'companion click reaction');
      check('Square desk companion beside CPU reacts to clicks');
      assert.equal(await run(`'gold' in window.dashboard`), false);
      check('Gold feature removed from preload');
      const usage = await run(`window.dashboard.usage.get()`);
      assert.equal(usage.status, 'live', usage.error || 'usage unavailable');
      assert(usage.windows.length > 0);
      assert(Object.hasOwn(usage, 'creditBalance') && Object.hasOwn(usage, 'resetBank'));
      if (usage.creditBalance) {
        assert.equal(typeof usage.creditBalance.hasCredits, 'boolean');
        assert.equal(typeof usage.creditBalance.unlimited, 'boolean');
        assert(usage.creditBalance.balance === null || typeof usage.creditBalance.balance === 'string');
      }
      if (usage.resetBank) assert(Number.isSafeInteger(usage.resetBank.availableCount));
      assert.equal(await run(`typeof window.dashboard.usage.useReset`), 'function');
      await until(`document.querySelector('[aria-label="Codex credits and reset bank"]')?.textContent.includes('Credits remaining') && document.querySelector('[aria-label="Codex credits and reset bank"]')?.textContent.includes('Reset bank')`, 'credit summary UI');
      if (usage.resetBank?.availableCount > 0) {
        assert.equal(await run(`Boolean(document.getElementById('codex-reset-choice') && [...document.querySelectorAll('button')].some(button => button.textContent === 'Use reset'))`), true);
        await run(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Use reset').click()`);
        await until(`[...document.querySelectorAll('button')].some(button => button.textContent === 'Confirm')`, 'reset confirmation');
        await run(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click()`);
        await until(`![...document.querySelectorAll('button')].some(button => button.textContent === 'Confirm')`, 'reset cancellation');
      }
      check('Live Codex usage with minimal Ubuntu PATH');
      check('Codex credit balance and reset bank display');

      if (process.env.DESKTOP_SMOKE_STAGE === 'create') {
        const result = await run(`window.dashboard.translation.translate('Hello world')`);
        assert.equal(result.sourceText, 'Hello world');
        assert.equal(result.sourceLanguage, 'en');
        assert.equal(result.targetLanguage, 'vi');
        assert(result.translatedText.trim());
        assert.notEqual(result.translatedText, result.sourceText);
        const cached = await run(`window.dashboard.translation.translate('  Hello world  ')`);
        assert.equal(cached.translatedAt, result.translatedAt);
        assert.equal(await run(`window.dashboard.translation.translate('x'.repeat(5001)).then(() => false, () => true)`), true);
        assert.equal(await run(`window.dashboard.translation.translate(' ').then(() => false, () => true)`), true);
        check('Google translation, in-memory cache, and input limits');

        await printTerminal('Hello world');
        await selectTerminal('Hello world');
        await until(`document.getElementById('translation-source').value.trim() === 'Hello world' && document.querySelector('[lang="vi"]').textContent === ${JSON.stringify(result.translatedText)}`, 'automatic selection translation');
        check('Highlighted terminal text translates automatically');

        await run(`document.querySelector('input[type="checkbox"]').click()`);
        await printTerminal('Good morning');
        await selectTerminal('Good morning');
        await pause(900);
        assert.equal(await run(`document.getElementById('translation-source').value.trim()`), 'Hello world');
        const clipboardBefore = await run(`window.dashboard.readTerminalClipboard()`);
        await key('T', ['control']);
        await until(`document.getElementById('translation-source').value.trim() === 'Good morning' && document.querySelector('[lang="vi"]').getAttribute('aria-busy') === 'false'`, 'selection shortcut');
        assert.equal(await run(`window.dashboard.readTerminalClipboard()`), clipboardBefore);
        check('Ctrl+T transfers and translates terminal text without copying');

        await printTerminal('Good evening');
        await selectTerminal('Good evening');
        await run(`document.getElementById('translation-source').focus()`);
        await key('T', ['control']);
        await until(`document.getElementById('translation-source').value.trim() === 'Good evening' && document.querySelector('[lang="vi"]').getAttribute('aria-busy') === 'false'`, 'shortcut with translation input focused');
        assert.equal(await run(`window.dashboard.readTerminalClipboard()`), clipboardBefore);
        check('Shortcut works after focus moves from the terminal to another app input');

        await printTerminal('Unselected text');
        for (const letter of 'ab') {
          for (const type of ['keyDown', 'char', 'keyUp']) window.webContents.sendInputEvent({ type, keyCode: letter });
        }
        await key('T', ['control']);
        await until(`[...document.querySelectorAll('.xterm-rows > div')].some(n => n.textContent.trim().endsWith('ba'))`, 'normal shell Ctrl+T transposes typed characters');
        assert.equal(await run(`document.getElementById('translation-source').value.trim()`), 'Good evening');
        await key('C', ['control']);
        check('Ctrl+T retains normal shell editing when no terminal text is highlighted');

        await printTerminal('Thank you');
        await selectTerminal('Thank you');
        await run(`document.querySelector('button[title^="Translate selected"]').click()`);
        await until(`document.getElementById('translation-source').value.trim() === 'Thank you' && document.querySelector('[lang="vi"]').getAttribute('aria-busy') === 'false'`, 'terminal translate button');
        check('Terminal Translate button');

        // Reproduce Codex/tmux mouse reporting without making a model request.
        await printTerminal('Mouse selection test', '\x1b[?1000h\x1b[?1006h');
        await until(`Boolean(document.querySelector('[id$="-selection-hint"]'))`, 'mouse reporting selection hint');
        await selectTerminal('Mouse selection test');
        assert.equal(await run(`document.querySelector('button[title^="Translate selected"]').disabled`), true);
        await key('T', ['control']);
        assert.equal(await run(`document.getElementById('translation-source').value.trim()`), 'Thank you');
        await key('C', ['control']);
        await selectTerminal('Mouse selection test', ['shift']);
        assert.equal(await run(`document.querySelector('button[title^="Translate selected"]').disabled`), false);
        await key('T', ['control']);
        await until(`document.getElementById('translation-source').value.trim() === 'Mouse selection test' && document.querySelector('[lang="vi"]').getAttribute('aria-busy') === 'false'`, 'mouse reporting shortcut');
        assert.equal(await run(`window.dashboard.readTerminalClipboard()`), clipboardBefore);
        await key('C', ['control']);
        await printTerminal('Mouse mode off', '\x1b[?1000l\x1b[?1006l');
        await until(`!document.querySelector('[id$="-selection-hint"]')`, 'mouse reporting hint clears');
        check('Codex-style mouse reporting: Shift+drag selects, Ctrl+T translates, and the hint follows mouse mode');

        await manualTranslation('Welcome to the workspace');
        assert.match(await run(`document.querySelector('[lang="vi"]').textContent`), /[\u00c0-\u024f\u1e00-\u1eff]/i);
        check('Typed text translates with Ctrl+Enter');

        await run(`document.querySelector('button[aria-label="Create note"]').click()`);
        await until(`Boolean(document.querySelector('[contenteditable="true"]'))`, 'new note editor');
        await run(`document.querySelector('[contenteditable="true"]').focus()`);
        await run(`(() => { const style = document.querySelector('select[aria-label="Text style"]'); style.value = 'heading1'; style.dispatchEvent(new Event('change', {bubbles:true})); })()`);
        await window.webContents.insertText('Translation guide');
        await key('Return');
        await run(`(() => { const style = document.querySelector('select[aria-label="Text style"]'); style.value = 'paragraph'; style.dispatchEvent(new Event('change', {bubbles:true})); })()`);
        await window.webContents.insertText('Select English text in the terminal.');
        await until(`window.dashboard.notes.list().then(notes => notes[0]?.content.content.some(n => n.type === 'heading' && n.content?.[0]?.text === 'Translation guide') && notes[0]?.content.content.some(n => n.type === 'paragraph' && n.content?.[0]?.text === 'Select English text in the terminal.'))`, 'UI note autosave');
        check('Heading and paragraph toolbar saves real editor input');
        const richContent = {
          type: 'doc', content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Translation guide' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Select English text in the terminal.' }] },
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Useful phrases' }] },
            { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world → Welcome to the workspace' }] }] },
            { type: 'horizontalRule' },
            { type: 'codeBlock', content: [{ type: 'text', text: 'Ctrl+T: Translate selection' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Saved locally', marks: [{ type: 'underline' }, { type: 'strike' }] }] },
          ],
        };
        await run(`window.dashboard.notes.list().then(notes => window.dashboard.notes.update(notes[0].id, {content:${JSON.stringify(richContent)}}))`);
        fs.writeFileSync(path.join(profile, 'expected-note.json'), JSON.stringify(richContent));
        check('Rich blocks and marks persist through notes IPC');
        await run(`document.querySelector('[aria-label="Choose learning space"] button:nth-child(2)').click()`);
        await until(`Boolean(document.getElementById('vocabulary-input'))`, 'vocabulary space');
        await run(`document.getElementById('vocabulary-input').focus()`);
        await window.webContents.insertText('resilient');
        await until(`!document.getElementById('vocabulary-input').form.querySelector('button[type="submit"]').disabled`, 'vocabulary submit enabled');
        await run(`document.getElementById('vocabulary-input').form.querySelector('button[type="submit"]').click()`);
        await until(`window.dashboard.vocabulary.list().then(cards => cards.length === 1 && cards[0].word === 'resilient')`, 'AI flashcard generation', 130_000);
        const generated = await run(`window.dashboard.vocabulary.list()`);
        assert(generated[0].meaning && generated[0].translation && generated[0].example);
        await until(`document.querySelector('[aria-label="Flashcard mode"]')?.textContent.includes('Practice')`, 'flashcard UI');
        await run(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Reveal meaning & example').click()`);
        await until(`document.querySelector('[aria-label="Notes and vocabulary"]')?.textContent.includes(${JSON.stringify(generated[0].example)})`, 'flashcard example visible');
        await pause(150);
        fs.writeFileSync(path.join(output, 'vocabulary.png'), (await window.webContents.capturePage()).toPNG());
        await run(`document.querySelector('[aria-label="Flashcard mode"] button:nth-child(2)').click()`);
        await run(`document.querySelector('input[placeholder="Type your answer, then reveal"]').focus()`);
        await window.webContents.insertText('able to recover');
        await run(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Check answer').click()`);
        await until(`Boolean([...document.querySelectorAll('button')].find(button => button.textContent.includes('Remembered')))`, 'practice reveal');
        await run(`[...document.querySelectorAll('button')].find(button => button.textContent.includes('Remembered')).click()`);
        await until(`window.dashboard.vocabulary.list().then(cards => cards[0].reviewCount === 1 && cards[0].rememberedCount === 1)`, 'practice result save');
        check('AI flashcard generation, example, and practice result persist');
      } else {
        const content = JSON.parse(fs.readFileSync(path.join(profile, 'expected-note.json'), 'utf8'));
        const notes = await run(`window.dashboard.notes.list()`);
        assert.deepEqual(notes[0].content, content);
        assert.equal(await run(`Boolean(document.querySelector('[aria-label="Notes and vocabulary"]')?.textContent.includes('resilient'))`), true);
        const cards = await run(`window.dashboard.vocabulary.list()`);
        assert.equal(cards.length, 1);
        assert.equal(cards[0].word, 'resilient');
        assert.equal(cards[0].rememberedCount, 1);
        await run(`document.querySelector('[aria-label="Choose learning space"] button:first-child').click()`);
        await until(`Boolean(document.querySelector('[contenteditable="true"] h1') && document.querySelector('[contenteditable="true"] blockquote') && document.querySelector('[contenteditable="true"] pre') && document.querySelector('[contenteditable="true"] hr'))`, 'restored structured note');
        const sizes = await run(`(() => { const e = document.querySelector('[contenteditable="true"]'); return ['h1','h2','p'].map(s => parseFloat(getComputedStyle(e.querySelector(s)).fontSize)); })()`);
        assert(sizes[0] > sizes[1] && sizes[1] > sizes[2]);
        assert.equal(await run(`document.querySelector('input[type="checkbox"]').checked`), false);
        check('Full restart preserves structured notes and selection preference');
        check('Vocabulary mode and flashcards survive restart');
        check('Distinct heading and paragraph typography');
        await manualTranslation('Hello world');
        await until(`document.querySelector('[aria-label="Codex CLI usage"]').textContent.includes('% used')`, 'live usage UI', 22_000);
        await pause(200);
        fs.writeFileSync(path.join(output, 'dashboard.png'), (await window.webContents.capturePage()).toPNG());
        window.setSize(1024, 660);
        await pause(200);
        fs.writeFileSync(path.join(output, 'dashboard-small.png'), (await window.webContents.capturePage()).toPNG());
      }
      fs.writeFileSync(path.join(output, `${process.env.DESKTOP_SMOKE_STAGE}.json`), JSON.stringify({ ok: true, checks }, null, 2));
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      console.error(error.stack);
      if (window && !window.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(output, `${process.env.DESKTOP_SMOKE_STAGE}.json`), JSON.stringify({ ok: false, checks, error: String(error) }, null, 2));
      clearTimeout(timeout);
      app.exit(1);
    }
  });
}
