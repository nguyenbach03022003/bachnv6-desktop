/* Build first with npm run package. Uses only a temporary profile and local fixtures. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'out', 'validation', 'notes');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bachnv6-notes-smoke-'));
  let passed = false;
  try {
    for (const stage of ['edit', 'restore']) {
      const result = spawnSync(require('electron'), [__filename], {
        cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120_000,
        env: { ...process.env, NOTES_SMOKE_PROFILE: profile, NOTES_SMOKE_STAGE: stage },
      });
      assert.equal(result.status, 0, `${stage}: ${result.error?.message || result.signal || result.status}`);
    }
    passed = true;
    console.log(`Notes smoke checks passed. Screenshots: ${output}`);
  } finally {
    assert(path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-notes-smoke-'));
    if (passed) fs.rmSync(profile, { recursive: true, force: true });
    else console.error(`Debug profile retained at ${profile}`);
  }
} else {
  const { app, BrowserWindow, dialog, ipcMain } = require('electron');
  const profile = process.env.NOTES_SMOKE_PROFILE;
  const stage = process.env.NOTES_SMOKE_STAGE;
  assert(profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-notes-smoke-'));
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  fs.mkdirSync(output, { recursive: true });
  const notesFile = path.join(profile, 'notes', 'notes.json');
  const cardFile = path.join(profile, 'vocabulary', 'cards.json');
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (window, code) => window.webContents.executeJavaScript(code, true);
  const click = (window, selector) => run(window, `document.querySelector(${JSON.stringify(selector)}).click()`);
  const notesWindow = () => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('#notes'));
  const imageWindow = () => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('#image'));
  const dashboardWindow = () => BrowserWindow.getAllWindows().find((window) => !/#(notes|image)$/.test(window.webContents.getURL()));
  const noteText = (note) => JSON.stringify(note.content);
  const readNotes = () => JSON.parse(fs.readFileSync(notesFile, 'utf8')).notes;
  const readCards = () => JSON.parse(fs.readFileSync(cardFile, 'utf8')).cards;
  const check = (description) => console.log(`PASS ${description}`);
  async function until(predicate, description, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await pause(60);
    }
    throw new Error(`Timed out: ${description}`);
  }
  const visible = (window, selector) => run(window, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  async function append(window, text) {
    await run(window, `(() => {
      const editor = document.querySelector('[aria-label="Note content"]');
      editor.focus();
      const selection = getSelection(); const range = document.createRange();
      range.selectNodeContents(editor); range.collapse(false);
      selection.removeAllRanges(); selection.addRange(range);
    })()`);
    await window.webContents.insertText(text);
    await until(() => run(window, `document.querySelector('[aria-label="Note content"]').textContent.includes(${JSON.stringify(text)})`), 'editor input');
  }
  async function screenshot(window, name) {
    window.show();
    window.focus();
    await run(window, `document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
    // A newly recreated window may not have a capture surface on its first frame.
    for (let attempt = 0; attempt < 3; attempt++) {
      await pause(200);
      try {
        fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }

  if (stage === 'edit') {
    fs.mkdirSync(path.dirname(notesFile), { recursive: true });
    fs.mkdirSync(path.dirname(cardFile), { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(notesFile, JSON.stringify({ version: 1, notes: [
      { id: randomUUID(), color: 'amber', attachments: [], createdAt: now, updatedAt: now,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First note' }] }] } },
      { id: randomUUID(), color: 'mint', attachments: [], createdAt: now, updatedAt: now,
        content: { type: 'doc', content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A clearer reading space' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Open an attached image to inspect it. Detach this workspace to read and edit with more room.' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Your notes move with you' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'The selected note, its colors, and its attachments return to the dashboard when you merge back.' }] },
        ] } },
    ] }));
    fs.writeFileSync(cardFile, JSON.stringify({ version: 1, cards: [{
      id: randomUUID(), word: 'clear', meaning: 'Easy to understand', translation: 'rõ ràng',
      example: 'The image is clear.', createdAt: now, reviewCount: 3, rememberedCount: 2,
    }] }));
  }

  // This notes-only check needs neither a live shell nor a signed-in Codex account.
  require('node-pty').spawn = () => ({
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
    write() {}, resize() {}, kill() {},
  });
  require(path.join(root, '.vite', 'build', 'main.js'));
  let failNotesWrites = false;
  const rename = fs.promises.rename;
  fs.promises.rename = async (source, destination) => {
    if (failNotesWrites && destination === notesFile) throw new Error('Simulated note write failure');
    return rename(source, destination);
  };

  app.whenReady().then(async () => {
    for (const channel of ['usage:get', 'usage:refresh', 'weather:get', 'weather:refresh']) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        if (channel.startsWith('usage')) return {
          status: 'unavailable', planType: null, windows: [], creditBalance: null, resetBank: null,
          fetchedAt: null, error: 'Offline smoke check', nextRefreshAt: null,
        };
        return { status: 'unavailable', location: { name: 'Hanoi', country: 'Vietnam', countryCode: 'VN',
          latitude: 21.0285, longitude: 105.8542, timezone: 'Asia/Ho_Chi_Minh' }, current: null,
        forecast: [], fetchedAt: null, nextRefreshAt: null, error: 'Offline smoke check', source: 'Open-Meteo' };
      });
    }
    const timeout = setTimeout(() => { console.error('Notes smoke check timed out'); app.exit(1); }, 100_000);
    try {
      await until(() => Boolean(dashboardWindow()), 'dashboard window');
      let dashboard = dashboardWindow();
      await until(() => visible(dashboard, '[aria-label="Choose note"]'), 'notes loaded');
      const secondId = readNotes()[1].id;
      await run(dashboard, `(() => { const picker = document.querySelector('[aria-label="Choose note"]');
        picker.value = ${JSON.stringify(secondId)}; picker.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => run(dashboard, `document.querySelector('[aria-label="Note content"]')?.textContent.includes('A clearer reading space')`), 'selected note');

      if (stage === 'restore') {
        assert(noteText(readNotes()[1]).includes('merge retry saved'));
        assert.equal(readNotes()[1].attachments.length, 1);
        assert.equal(readCards()[0].rememberedCount, 2);
        await until(() => visible(dashboard, '[aria-label="View reading-guide.png"]'), 'restored attachment');
        await click(dashboard, '[aria-label="View reading-guide.png"]');
        await until(() => Boolean(imageWindow()), 'restored image window');
        await until(() => run(imageWindow(), `document.querySelector('img')?.naturalWidth === 1800`), 'restored image bytes');
        check('Notes, attachment, and vocabulary survive a full app restart');
      } else {
        const png = await run(dashboard, `(() => {
          const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1100;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff4df'; ctx.fillRect(0, 0, 1800, 1100);
          ctx.fillStyle = '#402c21'; ctx.font = 'bold 72px Segoe UI'; ctx.fillText('Read with more room', 100, 160);
          ctx.font = '36px Segoe UI'; ctx.fillText('A local attachment for testing clear image viewing.', 100, 245);
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = ['#f3c784', '#c2e5d3', '#d5c2ed'][i]; ctx.fillRect(100 + i * 550, 350, 500, 560);
            ctx.fillStyle = '#402c21'; ctx.font = 'bold 44px Segoe UI';
            ctx.fillText(['Fit to window', 'Actual size', 'Zoom and scroll'][i], 125 + i * 550, 440);
            ctx.font = '32px Segoe UI'; ctx.fillText('Inspect every detail', 125 + i * 550, 520);
          }
          return canvas.toDataURL('image/png').split(',')[1];
        })()`);
        const fixture = path.join(profile, 'reading-guide.png');
        fs.writeFileSync(fixture, Buffer.from(png, 'base64'));
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
        await click(dashboard, '[aria-label="Attach screenshot"]');
        await until(() => visible(dashboard, '[aria-label="View reading-guide.png"]'), 'attachment preview');
        await append(dashboard, ' detach saved');
        await click(dashboard, '[aria-label="Detach notes window"]');
        await until(() => Boolean(notesWindow()), 'detach');
        let detached = notesWindow();
        await until(() => visible(detached, '[aria-label="Note content"]'), 'detached editor');
        assert(noteText(readNotes()[1]).includes('detach saved'));
        assert.equal(await run(detached, `document.querySelector('[aria-label="Choose note"]').value`), secondId);
        assert.equal(await run(detached, `getComputedStyle(document.querySelector('[aria-label="Note content"]')).fontSize`), '16px');
        assert.equal(await visible(dashboard, '[aria-label="Note content"]'), false);
        assert.equal(await run(dashboard, `window.dashboard.notes.create().then(() => false, () => true)`), true);
        assert.equal(await run(detached, `window.dashboard.createTerminal(80, 24).then(() => false, () => true)`), true);
        check('Detach flushes edits, preserves selection, and allows only one notes editor');
        await until(() => visible(detached, '[aria-label="View reading-guide.png"]'), 'detached thumbnail');
        await screenshot(detached, 'detached-notes');

        await click(detached, '[aria-label="View reading-guide.png"]');
        await until(() => Boolean(imageWindow()), 'image viewer');
        const viewer = imageWindow();
        await until(() => run(viewer, `document.querySelector('img')?.naturalWidth === 1800`), 'image decoded');
        assert.equal(await run(viewer, `window.dashboard.notes.create().then(() => false, () => true)`), true);
        assert.equal(await run(viewer, `window.dashboard.notesWorkspace.detach({selectedId:null,space:'notes'}).then(() => false, () => true)`), true);
        await run(detached, `Promise.all([window.dashboard.notesWorkspace.openImage(${JSON.stringify(secondId)}, ${JSON.stringify(readNotes()[1].attachments[0].id)}), window.dashboard.notesWorkspace.openImage(${JSON.stringify(secondId)}, ${JSON.stringify(readNotes()[1].attachments[0].id)})])`);
        assert.equal(BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().endsWith('#image')).length, 1);
        await screenshot(viewer, 'image-fit');
        await click(dashboard, '[aria-label="Switch to dark mode"]');
        await until(() => run(detached, `document.documentElement.dataset.theme === 'dark'`), 'detached theme sync');
        await until(() => run(viewer, `document.documentElement.dataset.theme === 'dark'`), 'viewer theme sync');
        await screenshot(detached, 'detached-notes-dark');
        await screenshot(viewer, 'image-fit-dark');
        await click(dashboard, '[aria-label="Switch to light mode"]');
        await run(viewer, `[...document.querySelectorAll('button')].find(button => button.textContent === 'Actual size').click()`);
        await until(() => run(viewer, `document.querySelector('img').getBoundingClientRect().width === 1800`), 'actual size');
        await click(viewer, '[aria-label="Zoom in"]');
        await until(() => run(viewer, `document.querySelector('img').getBoundingClientRect().width === 2250`), '125 percent zoom');
        await run(viewer, `[...document.querySelectorAll('button')].find(button => button.textContent === 'Fit to window').click()`);
        viewer.setSize(520, 480);
        await pause(180);
        const fit = await run(viewer, `(() => { const stage = document.querySelector('img').parentElement.parentElement;
          return { width: stage.clientWidth, scrollWidth: stage.scrollWidth, height: stage.clientHeight, scrollHeight: stage.scrollHeight }; })()`);
        assert(fit.scrollWidth <= fit.width + 1 && fit.scrollHeight <= fit.height + 1, JSON.stringify(fit));
        assert.equal(await run(detached, `window.dashboard.notesWorkspace.openImage('../invalid', 'bad').then(() => false, () => true)`), true);
        viewer.close();
        check('Image viewer supports fit, actual size, zoom, resizing, duplicate focus, theme sync, and restricted access');

        await append(detached, ' merge saved');
        await click(dashboard, '[aria-label="Merge notes into dashboard"]');
        await until(() => !notesWindow(), 'merge requested from dashboard');
        await until(() => visible(dashboard, '[aria-label="Note content"]'), 'merged editor');
        assert(noteText(readNotes()[1]).includes('merge saved'));
        assert.equal(await run(dashboard, `document.querySelector('[aria-label="Choose note"]').value`), secondId);
        assert.equal(await visible(dashboard, '[aria-label="View reading-guide.png"]'), true);
        check('Merge from dashboard saves fresh edits and restores the selected note and attachment');

        failNotesWrites = true;
        await append(dashboard, ' detach retry saved');
        await click(dashboard, '[aria-label="Detach notes window"]');
        await until(() => run(dashboard, `Boolean([...document.querySelectorAll('[role="alert"]')].find(node => node.textContent.includes('before detaching')))`), 'detach save error');
        assert(!notesWindow());
        failNotesWrites = false;
        await click(dashboard, '[aria-label="Detach notes window"]');
        await until(() => Boolean(notesWindow()), 'detach retry');
        detached = notesWindow();
        await until(() => visible(detached, '[aria-label="Note content"]'), 'retry editor');
        failNotesWrites = true;
        await append(detached, ' merge retry saved');
        await click(detached, '[aria-label="Merge notes into dashboard"]');
        await until(() => run(detached, `Boolean([...document.querySelectorAll('[role="alert"]')].find(node => node.textContent.includes('stayed open')))`), 'merge save error');
        assert(notesWindow());
        failNotesWrites = false;
        await click(detached, '[aria-label="Merge notes into dashboard"]');
        await until(() => !notesWindow(), 'merge retry');
        await until(() => visible(dashboard, '[aria-label="Note content"]'), 'editor after retry');
        assert(noteText(readNotes()[1]).includes('merge retry saved'));
        check('Failed saves keep the editor open during detach and merge, and retries preserve drafts');

        await click(dashboard, '[aria-label="Detach notes window"]');
        await until(() => Boolean(notesWindow()), 'native close test detach');
        detached = notesWindow();
        await until(() => visible(detached, '[aria-label="Note content"]'), 'native close editor');
        detached.close();
        await until(() => !notesWindow(), 'native window close');
        await until(() => visible(dashboard, '[aria-label="Choose note"]'), 'native close restores panel');
        await run(dashboard, `[...document.querySelectorAll('[aria-label="Choose learning space"] button')].find(button => button.textContent === 'Vocabulary').click()`);
        await until(() => run(dashboard, `document.querySelector('[aria-label="Notes and vocabulary"]').textContent.includes('Easy to understand') || document.querySelector('[aria-label="Flashcard mode"]') !== null`), 'vocabulary loaded');
        await click(dashboard, '[aria-label="Detach notes window"]');
        await until(() => Boolean(notesWindow()), 'vocabulary detach');
        detached = notesWindow();
        await until(() => visible(detached, '[aria-label="Flashcard mode"]'), 'detached vocabulary');
        await click(detached, '[aria-label="Merge notes into dashboard"]');
        await until(() => !notesWindow(), 'vocabulary merge');
        await until(() => visible(dashboard, '[aria-label="Flashcard mode"]'), 'merged vocabulary');
        assert.equal(readCards()[0].rememberedCount, 2);
        check('Native close reattaches notes; vocabulary selection and counts carry across');

        await run(dashboard, `[...document.querySelectorAll('[aria-label="Choose learning space"] button')].find(button => button.textContent === 'Sticky notes').click()`);
        await until(() => visible(dashboard, '[aria-label="Note content"]'), 'notes space');
        await click(dashboard, '[aria-label="Detach notes window"]');
        await until(() => Boolean(notesWindow()), 'final detach');
        detached = notesWindow();
        await until(() => visible(detached, '[aria-label="Note content"]'), 'final editor');
        dashboard.close();
        await until(() => !dashboardWindow(), 'dashboard close');
        await click(detached, '[aria-label="Merge notes into dashboard"]');
        await until(() => !notesWindow() && Boolean(dashboardWindow()), 'recreated dashboard');
        dashboard = dashboardWindow();
        await until(() => visible(dashboard, '[aria-label="Note content"]'), 'notes in recreated dashboard');
        await screenshot(dashboard, 'merged-dashboard');
        check('Merge reopens the dashboard when its original window was closed');
      }
      clearTimeout(timeout);
      fs.promises.rename = rename;
      for (const window of BrowserWindow.getAllWindows()) window.close();
      setTimeout(() => app.exit(0), 500);
    } catch (error) {
      console.error(error);
      for (const [index, window] of BrowserWindow.getAllWindows().entries()) {
        await screenshot(window, `failure-${index}`).catch(() => undefined);
      }
      clearTimeout(timeout);
      app.exit(1);
    }
  });
}
