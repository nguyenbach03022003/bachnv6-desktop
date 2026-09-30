/* Run after npm run package. Uses a temporary profile and real shell sessions. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'out', 'validation');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bachnv6-theme-'));
  try {
    const result = spawnSync(require('electron'), [
      ...(process.env.DESKTOP_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), __filename,
    ], { cwd: root, stdio: 'inherit', timeout: 90_000, env: { ...process.env, THEME_SMOKE_PROFILE: profile } });
    assert.equal(result.status, 0, result.error?.message || result.signal || 'Theme smoke failed');
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = require('electron');
  const profile = process.env.THEME_SMOKE_PROFILE;
  assert(profile && path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('bachnv6-theme-'));
  app.setPath('userData', profile);
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('disable-gpu');
  require(path.join(root, '.vite', 'build', 'main.js'));
  let window;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code) => window.webContents.executeJavaScript(code, true);
  async function until(code, description) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await run(code)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${description}`);
  }
  async function command(text, marker) {
    await until(`!document.querySelector('[role="tabpanel"]:not([hidden]) [role="status"]')`, 'ready shell');
    await run(`document.querySelector('[role="tabpanel"]:not([hidden]) .xterm-helper-textarea').focus()`);
    for (const letter of text) {
      for (const type of ['keyDown', 'char', 'keyUp']) window.webContents.sendInputEvent({ type, keyCode: letter });
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await until(`[...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .xterm-rows > div')].some(n => n.textContent.trim().startsWith(${JSON.stringify(marker)}) && !n.textContent.includes('printf'))`, marker);
    return run(`[...document.querySelectorAll('[role="tabpanel"]:not([hidden]) .xterm-rows > div')].find(n => n.textContent.trim().startsWith(${JSON.stringify(marker)})).textContent.trim()`);
  }
  async function screenshot(name) {
    await pause(180);
    fs.writeFileSync(path.join(output, name), (await window.webContents.capturePage()).toPNG());
  }
  app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 80_000);
    try {
      fs.mkdirSync(output, { recursive: true });
      for (let i = 0; i < 100; i++) {
        window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes('main_window'));
        if (window && !window.webContents.isLoading()) break;
        await pause(100);
      }
      assert(window);
      window.webContents.setBackgroundThrottling(false);
      window.webContents.debugger.attach('1.3');
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
      window.focus();
      await until(`Boolean(document.querySelector('.xterm-rows') && document.querySelector('[aria-label="Switch to dark mode"]'))`, 'light mode and terminal');
      assert.equal(await run(`document.documentElement.dataset.theme`), 'light');
      assert.equal(await run(`getComputedStyle(document.documentElement).colorScheme`), 'light');
      const firstPid = await command(`printf 'first_pid_%s\\n' "$$"`, 'first_pid_');
      await command(`printf '\\033[31mred \\033[32mgreen \\033[33myellow \\033[34mblue \\033[35mpurple \\033[36mcyan\\033[0m\\n'`, 'red ');
      await run(`globalThis.themeFirstTerminal = document.querySelector('.xterm'); document.querySelector('[aria-label="New terminal"]').click()`);
      await until(`document.querySelectorAll('.xterm').length === 2`, 'second terminal');
      const secondPid = await command(`printf 'second_pid_%s\\n' "$$"`, 'second_pid_');
      await run(`document.querySelector('[aria-label="Switch to dark mode"]').click()`);
      await until(`document.documentElement.dataset.theme === 'dark'`, 'dark mode');
      assert.equal(await run(`globalThis.themeFirstTerminal === document.querySelector('.xterm')`), true);
      assert.equal(await command(`printf 'after_pid_%s\\n' "$$"`, 'after_pid_'), secondPid.replace('second_', 'after_'));
      assert.equal(await run(`localStorage.getItem('desktop-theme')`), 'dark');
      await screenshot('theme-dark.png');
      await run(`document.querySelector('[aria-label="Switch to light mode"]').click(); document.querySelector('[role="tab"]').click()`);
      await until(`document.documentElement.dataset.theme === 'light'`, 'return to light mode');
      assert.equal(await command(`printf 'return_pid_%s\\n' "$$"`, 'return_pid_'), firstPid.replace('first_', 'return_'));
      assert.equal(await run(`getComputedStyle(document.querySelector('[role="tabpanel"]').parentElement).backgroundColor`), 'rgb(255, 240, 223)');
      assert.equal(await run(`getComputedStyle(document.querySelector('.xterm-rows')).color`), 'rgb(66, 44, 33)');
      const colors = await run(`(() => {
        const row = [...document.querySelectorAll('.xterm-rows > div')].find(n => n.textContent.trim().startsWith('red '));
        return [...row.querySelectorAll('span')].map(n => ({ text: n.textContent, color: getComputedStyle(n).color }));
      })()`);
      assert(colors.length >= 6, JSON.stringify(colors));
      assert(colors.every(item => item.color !== 'rgb(255, 255, 255)'), JSON.stringify(colors));
      const luminance = (rgb) => rgb.map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
      const background = luminance([255, 240, 223]);
      for (const item of colors) {
        const foreground = luminance(item.color.match(/\d+/g).slice(0, 3).map(Number));
        assert((background + .05) / (foreground + .05) >= 4.5, `Low contrast: ${JSON.stringify(item)}`);
      }
      await run(`document.querySelector('[aria-label="Create note"]').click()`);
      await until(`Boolean(document.querySelector('[contenteditable="true"]'))`, 'note editor');
      await run(`document.querySelector('[contenteditable="true"]').focus()`);
      await window.webContents.insertText('Fox palette: orange, cream, and brown.');
      await screenshot('theme-light.png');
      window.setSize(1024, 800);
      await screenshot('theme-light-compact.png');
      window.setMinimumSize(320, 660);
      window.setSize(480, 800);
      await pause(200);
      assert.equal(await run(`(() => { const button = document.querySelector('[aria-label="Switch to dark mode"]'); const box = button.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth; })()`), true);
      await screenshot('theme-light-mobile.png');
      window.setSize(1320, 800);
      await run(`document.querySelector('[aria-label="Switch to dark mode"]').click()`);
      window.webContents.reload();
      await until(`Boolean(document.querySelector('[aria-label="Switch to light mode"]'))`, 'saved dark mode after reload');
      assert.equal(await run(`document.documentElement.dataset.theme`), 'dark');
      await run(`document.querySelector('[aria-label="Switch to light mode"]').click()`);
      window.webContents.reload();
      await until(`Boolean(document.querySelector('[aria-label="Switch to dark mode"]'))`, 'saved light mode after reload');
      console.log('PASS light/dark appearance, two preserved shell PIDs and output, ANSI colors, narrow layout, and saved preferences');
      console.log(`Screenshots: ${output}/theme-*.png`);
      clearTimeout(timeout);
      window.close();
      setTimeout(() => app.exit(0), 300);
    } catch (error) {
      console.error(error);
      if (window) {
        console.error(await run(`[...document.querySelectorAll('.xterm-rows > div')].slice(0,8).map(n => n.textContent)`));
        await screenshot('theme-error.png');
      }
      clearTimeout(timeout); app.exit(1);
    }
  });
}
