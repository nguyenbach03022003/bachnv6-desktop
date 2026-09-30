# Bachnv6 Desktop

A Windows and Linux desktop dashboard built with Electron, React 19, TypeScript, and Electron Forge. The implementation follows [PLAN.md](PLAN.md).

## Current state

The app opens in a fox-inspired light theme with cream panels, orange accents, and brown text. Use **Light / Dark** in the title bar to switch themes; the choice is saved locally. Light mode includes a pale orange terminal and readable dark ANSI colors. Switching themes updates every open terminal without restarting its shell or clearing its output.

The dashboard has working terminal tabs and editable sticky notes. Each terminal tab starts its own PowerShell 7 session on Windows when available, falls back to Windows PowerShell, or uses the configured shell on Linux. Click the terminal surface to type commands. Double-click a tab name or click its pencil icon to rename it; F2 also works when the tab button has focus. Enter saves, Escape cancels, and clicking elsewhere saves. Empty names keep the previous name; names can contain up to 40 characters. Renaming preserves the running shell and its output, and the name stays when restarting that shell. Tabs and their names last for the current app session. Closing a tab stops its shell; the toolbar provides restart, copy, paste, and clear controls.

Notes support a text-style menu for paragraphs, six heading levels, quotes, and code blocks; a divider button separates sections. Bold, italic, underline, strikethrough, and lists are available in the toolbar. Paragraphs and headings have distinct spacing and sizes. Notes also support paper colors, multiple notes, and manually selected PNG/JPEG/WebP attachments. Edits save automatically under Electron's local `userData/notes` directory. Closing the app waits for pending note writes. Notes never execute text in the terminal.

The right panel can switch between **Sticky notes** and **Vocabulary**. Enter up to eight English words or phrases, separated by commas or new lines, and select **Create with AI**. The signed-in Codex CLI uses **GPT-6 Luna at Low reasoning (Light)** to create a flashcard for each word with an English meaning, Vietnamese translation, and example sentence. **Learn** reveals each card; **Practice** lets you type a meaning, check the answer, and mark it **Again** or **Remembered**. Cards and practice counts save locally under `userData/vocabulary`. The selected space is remembered after restart. Generation requires Codex CLI, `codex login`, and internet access; the entered words are sent to the model.

The resizable three-column dashboard also includes window controls and a bundled fox desk companion. The companion sits in a square tile immediately left of the CPU card on every platform. Click the tile or the fox to make it react; it also follows the pointer.

CPU, memory, and network readings come from the local computer. Temperature is shown only when the system exposes a reliable sensor. Sampling pauses while the dashboard is hidden.

Weather uses Open-Meteo, starts with Ha Noi, Viet Nam, and lets you choose another city. Forecasts and the chosen city are cached locally, with stale or unavailable states when the service cannot be reached.

The Google Translate panel translates **English ↔ Vietnamese** without a key. Click the arrow button between the language labels to swap direction; when a translation is available, its result becomes the new source text. The selected direction is saved locally. Type text and click **Translate**, or highlight text inside an app terminal: **Translate terminal selections** is enabled by default and translates after the selection settles using the selected direction. Disable that checkbox to translate only with the terminal's **Translate** button or **Ctrl+T**. In the source field, **Ctrl+Enter** also translates. Results appear in the left panel and can be copied without pasting into the shell. **Open in Google** follows the selected direction.

Inside Codex or another terminal program that captures the mouse, hold **Shift while dragging** to select text, release Shift, then press **Ctrl+T**. Ordinary dragging is sent to the terminal program and does not create a selection for translation. The app displays this instruction while mouse reporting is enabled. The terminal's **Translate** button becomes available when text is selected.

Selected text is sent to Google over HTTPS. Only selected or manually submitted snippets are sent; translation text and a small request cache stay in memory. The checkbox preference is stored locally. Requests are limited to 5,000 characters and time out after 12 seconds. The keyless Google endpoint is undocumented and may change or be throttled; **Open in Google** opens the same text in the Google Translate website as a fallback. Internet access is required for new translations. The former gold feature and its API-key controls have been removed; old gold files are left untouched in the user profile.

The AI panel reads the signed-in Codex CLI's reported usage windows through `codex app-server` ([official protocol documentation](https://learn.chatgpt.com/docs/app-server)). It also shows the reported ChatGPT credit balance with at least two decimal places and available earned rate-limit resets in the reset bank. When resets are available, choose a specific listed reset or **Next available reset**, then select **Use reset** and **Confirm** to redeem one. The app refreshes usage and the bank afterward. Missing credit values appear as **Not reported**; they are never estimated. On Ubuntu, the app searches common local npm and NVM installations and includes the matching Node runtime in the subprocess PATH, so a desktop-menu launch works without an interactive shell. Install the Codex CLI and sign in with `codex login` to show them. This panel does not read OpenAI API billing, and it does not invent a percentage for a usage window the CLI does not report.

## Install on Ubuntu

The Ubuntu build targets **Ubuntu 24.04 LTS, amd64 (x86-64)**. Copy `out/make/deb/x64/bachnv6-desktop_0.4.10_amd64.deb` to your Ubuntu computer, then run from the folder containing it:

```bash
sudo apt install ./bachnv6-desktop_0.4.10_amd64.deb
bachnv6-desktop
```

The DEB installs the app, desktop launcher, and Chromium sandbox helper, and declares its required system libraries. The terminal uses your Linux shell. To enable the AI usage panel, install the Codex CLI on that Ubuntu computer and run `codex login`. Google Translate does not require a key. Close the running app before installing an update, then reopen it from the desktop menu.

Remove the app with `sudo apt remove bachnv6-desktop`. Your notes and settings stay in your user profile.

Version 0.4.0 added Google Translate and terminal selection translation, structured notes, and Ubuntu Codex CLI discovery. Version 0.4.2 uses the shorter app shortcut **Ctrl+T**: highlight text in the active terminal, then press the shortcut to send it directly to the English field and translate into Vietnamese. It works with automatic selection translation switched off and while another app input has focus. It leaves the clipboard untouched. With no highlighted terminal text, Ctrl+T retains its normal shell or input behavior. The combination was checked against this Ubuntu desktop's configured shortcuts. Existing notes keep the same JSON format and load without a migration.

Version 0.4.3 explains Shift-drag selection in Codex and other programs that enable terminal mouse reporting. This workflow also works in version 0.4.2; the update adds the visible instruction.

Version 0.4.4 adds terminal tab renaming with an inline editor, a pencil button, double-click, and F2 on a focused tab. Renaming does not restart the terminal.

Version 0.4.5 adds the vocabulary space, AI flashcard creation, and saved practice results.

Version 0.4.6 pins flashcard generation to GPT-6 Luna at Low reasoning (Light).

Version 0.4.7 adds the reported credit balance and available reset-bank count to AI usage.

Version 0.4.8 shows fractional credit balances and lets you select and redeem an earned reset from AI usage.

Version 0.4.9 places the clickable desk companion in a square tile beside CPU and adapts the metric cards to narrower windows.

Version 0.4.10 adds a fox-inspired light mode with cream panels, orange accents, a pale orange terminal with dark text, and a saved light/dark switch. Theme switching preserves running terminal sessions and their output.

### Codex namespace warning on Ubuntu 24.04

The warning about bubblewrap and user namespaces concerns Codex's command sandbox. It does not prevent terminal text translation. When Ubuntu's AppArmor restriction blocks `/usr/bin/bwrap`, [official OpenAI documentation](https://learn.chatgpt.com/docs/sandboxing) recommends loading the distribution's scoped bubblewrap profile:

```bash
sudo apt update
sudo apt install apparmor-profiles apparmor-utils
sudo install -m 0644 /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/bwrap-userns-restrict
sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
bwrap --unshare-user --ro-bind / / -- /bin/true
```

Restart the Codex CLI after the check succeeds. These commands require administrator access; the dashboard does not change AppArmor or disable Codex's sandbox.

## Develop

Use Node.js 24 or another version supported by the installed Vite and Forge dependencies.

```powershell
npm ci
npm start
```

Check types and build a local app bundle:

```powershell
npm run typecheck
npm run package
```

Build an installer on the target operating system:

```powershell
npm run make
```

Forge is configured for a Windows Squirrel installer and Linux DEB/RPM packages. The Linux makers require the corresponding Linux packaging tools; native builds should be run on their target OS. Output is written to `out/`.

### Build the Ubuntu DEB

Use Ubuntu amd64 with Node.js 24, including an Ubuntu distribution in WSL. Compile `node-pty` in Linux using a Linux installation of Node and a fresh `npm ci`:

```bash
sudo apt update
sudo apt install build-essential python3 dpkg fakeroot
npm ci
npm run typecheck
npm run make:ubuntu
```

`make:ubuntu` builds only the DEB target, so RPM packaging tools are not needed. The DEB is written to `out/make/deb/x64/`. When using WSL, build from a source copy in the Linux filesystem; install dependencies there so the terminal native module is compiled for Linux.

The renderer runs with Node integration disabled and context isolation enabled. A typed preload bridge exposes window controls, local note and vocabulary operations, terminal sessions, metrics, weather, translation, and Codex usage. Shell processes, files, secrets, and external requests are owned by the Electron main process.

Third-party license texts are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and copied into packaged resources.

### Check the desktop features

After building, `npm run smoke:theme` checks light/dark switching with two real shell sessions, terminal colors, compact layouts, and saved theme preferences using a temporary profile. Theme screenshots are written to `out/validation/theme-*.png`. Like the desktop smoke check, it supports `DESKTOP_SMOKE_NO_SANDBOX=1` for a development Electron binary without a configured sandbox helper.

After building, run `npm run smoke:desktop` on a signed-in Ubuntu desktop with Codex installed and logged in. The checks use a temporary app profile and leave your personal notes and vocabulary untouched. They verify live Codex usage with a minimal PATH, Google translation and input limits, terminal highlighting and shortcuts (including Shift-drag while mouse reporting is active), note formatting and saving, AI flashcard generation and practice, and restoring notes and cards in a second app run. Results and screenshots are written to `out/validation/`. Internet access is required.

If the development Electron binary lacks a configured sandbox helper, `DESKTOP_SMOKE_NO_SANDBOX=1 npm run smoke:desktop` allows the temporary test process to run. This flag does not change the application or DEB sandbox configuration.
