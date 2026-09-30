# Bachnv6 Desktop

A personal desktop dashboard for Windows and Linux, built with Electron, React, TypeScript, and Electron Forge. Keep shell sessions, notes, vocabulary practice, translation, weather, and system metrics in one workspace.

The application interface, messages, and documentation are in English. Translation results, vocabulary translations, user notes, and shell output retain their own languages. Dates and application-generated numbers use English formatting regardless of the operating system's display language.

## Features

- **Terminal workspace:** independent terminal tabs, tab renaming, restart, copy, paste, clear, and ANSI color support. Windows uses PowerShell 7 when available, with Windows PowerShell as a fallback. Linux uses the configured user shell.
- **Sticky notes:** rich text, headings, quotes, code blocks, dividers, lists, text formatting, note colors, and manually selected image attachments. Notes save locally and are restored after restarting the app.
- **Vocabulary practice:** AI-generated English meanings, Vietnamese translations, and example sentences; Learn and Practice modes; and saved review counts.
- **Google Translate:** English ↔ Vietnamese translation for typed text and terminal selections, with a language-swap button, copy action, and Google Translate website fallback.
- **System metrics:** live CPU, memory, and network readings. Temperature appears when the computer exposes a supported sensor. Sampling pauses while the dashboard is hidden.
- **Weather:** current conditions and a three-day forecast from Open-Meteo, with city search and local caching. The initial city is Hanoi, Vietnam.
- **Codex usage:** reported usage windows, credit balance, and earned rate-limit resets from the signed-in Codex CLI. Redeeming a reset requires confirmation in the app.
- **Appearance:** saved light/dark themes, a resizable three-column layout, window controls, and a clickable fox companion beside the CPU card.

## Supported platforms

- Windows x64, using the Squirrel.Windows installer.
- Linux x64, with an Ubuntu 24.04 LTS amd64 packaging target.
- A Linux RPM maker is configured; build and validate it on the intended distribution before distributing it.

Build installers on their target operating system so native dependencies match that platform. The repository contains source code and required assets; compiled applications and installers are excluded from Git.

## Install on Windows

Open the generated `Setup.exe` installer from a Windows build. The installer installs the app for the current user under `%LOCALAPPDATA%\Bachnv6Desktop` and creates shortcuts. The normal per-user installation does not require administrator privileges. See the [Squirrel.Windows installation process](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/install-process.md).

The packaged app includes Electron and its runtime dependencies. Node.js is needed for development, not for running the installed app. Codex CLI is optional and is required only for the Codex usage panel and AI flashcard generation.

To produce the installer from source on Windows, follow the development setup below and run:

```powershell
npm run typecheck
npm run make -- --arch=x64
```

The Windows installer is written to `out/make/squirrel.windows/x64/`.

## Install on Ubuntu

For version 0.4.10, install the generated DEB from the folder containing it:

```bash
sudo apt install ./bachnv6-desktop_0.4.10_amd64.deb
bachnv6-desktop
```

The package installs the app, desktop launcher, and Chromium sandbox helper, and declares the required system libraries. Close a running copy before installing an update.

To remove the app:

```bash
sudo apt remove bachnv6-desktop
```

Local notes and settings remain in the user profile after removal.

## Develop

Use Node.js 24, or another Node.js version supported by the dependencies in the lockfile, and npm. Native dependencies may also require the target platform's compiler toolchain and Python.

```bash
git clone https://github.com/nguyenbach03022003/bachnv6-desktop.git
cd bachnv6-desktop
npm ci
npm start
```

Available commands:

| Command | Purpose |
| --- | --- |
| `npm start` | Start the app in development mode. |
| `npm run typecheck` | Check TypeScript without generating output. |
| `npm run package` | Build a local application bundle. |
| `npm run make` | Build installers for the current operating system. |
| `npm run make:ubuntu` | Build only the Ubuntu amd64 DEB. |
| `npm run smoke:theme` | Check themes, terminal sessions, responsive layout, and saved theme preferences. |
| `npm run smoke:desktop` | Check desktop integrations using a temporary app profile. |

Application bundles, installers, validation results, and screenshots are written to `out/`. Vite intermediate output is written to `.vite/`. Both directories are ignored by Git.

### Build the Ubuntu DEB

Run these commands on Ubuntu amd64, including an Ubuntu distribution in WSL:

```bash
sudo apt update
sudo apt install build-essential python3 dpkg fakeroot
npm ci
npm run typecheck
npm run make:ubuntu
```

The DEB is written to `out/make/deb/x64/`. When using WSL, keep the source in the Linux filesystem and install dependencies there so the native terminal module is built for Linux.

## Use the workspace

### Terminal tabs

Create a tab to start a separate shell. Rename a tab by double-clicking its name, selecting its pencil button, or pressing F2 while the tab button has focus. Enter or clicking elsewhere saves the name; Escape cancels. Names are limited to 40 characters.

Renaming or changing the theme preserves the running shell and its output. Closing a tab stops its shell. Tabs and their names last for the current app session.

### Translation shortcuts

- **Ctrl+Enter:** translate the text in the translation input.
- **Ctrl+T:** translate highlighted text from the active terminal.
- **Shift+drag, then Ctrl+T:** select and translate text in Codex or another terminal program that captures mouse events.

**Translate terminal selections** is enabled by default. Turn it off to translate only through a button or shortcut. With no highlighted terminal text, Ctrl+T keeps its normal shell or input behavior.

The language-swap button reverses the translation direction. If a result is available, it becomes the new input. The selected direction is remembered after restarting the app. All translation controls and status messages remain in English in either direction.

Requests are limited to 5,000 characters and time out after 12 seconds. The keyless Google endpoint is undocumented and may change or be throttled. **Open in Google** opens the selected text and translation direction on the Google Translate website.

### Sticky notes and vocabulary

Use **Sticky notes** for rich text and **Vocabulary** for flashcards. Notes save automatically under Electron's local `userData/notes` directory, and closing the app waits for pending writes. Note text is never executed in the terminal.

In Vocabulary, enter one to eight English words or phrases separated by commas or new lines, then select **Create with AI**. The app uses the signed-in Codex CLI with `gpt-6-luna` and low reasoning effort. Each card includes an English meaning, a Vietnamese translation, and an English example sentence. Cards and practice counts save under `userData/vocabulary`.

Flashcard generation requires Codex CLI, a completed `codex login`, and internet access. The selected learning space is remembered after restarting the app.

### Codex usage

Install Codex CLI and sign in with `codex login` to enable the usage panel. On Ubuntu, the app searches common npm and NVM installation locations so a desktop-menu launch can locate the CLI.

The panel shows values reported by `codex app-server`. Missing values appear as **Not reported**. When an earned reset is available, choose a listed reset or **Next available reset**, select **Use reset**, and confirm. The app then refreshes usage and the reset bank.

## Local data and external requests

| Feature | Local storage | External service |
| --- | --- | --- |
| Notes and attachments | Electron `userData/notes` | None |
| Vocabulary and review counts | Electron `userData/vocabulary` | Codex CLI sends entered words for AI generation. |
| Weather | Electron `userData/weather` | Open-Meteo receives city searches and selected coordinates. |
| Translation | In-memory text/cache; preferences stored locally | Google receives submitted or selected text. |
| Codex usage | CLI-managed account state; usage held in memory | The signed-in Codex CLI obtains account usage. |
| Theme and UI preferences | Local browser storage in the app profile | None |
| System metrics | In-memory samples | None |

The renderer uses context isolation with Node integration disabled. Typed preload APIs connect the interface to operations in the Electron main process.

Local account files, notes, shell history, and machine-specific application profiles are not part of the source repository. The `.gitignore` excludes dependency folders, build output, installers, logs, environment files, local credential files, signing keys, editor settings, and common profile directories. Review staged files before each public push; ignore rules do not remove files already present in Git history.

## Validation

After building the app:

```bash
npm run typecheck
npm run smoke:theme
npm run smoke:desktop
```

The smoke checks use temporary profiles and leave personal notes and vocabulary untouched. Results and screenshots are written to the ignored `out/validation/` directory.

The desktop smoke check requires a signed-in Ubuntu desktop, a signed-in Codex CLI, and internet access. It exercises live usage, translation, terminal selection shortcuts, notes, flashcard generation, and restoring saved content. AI flashcard generation uses the signed-in account.

If a development Electron binary has no configured sandbox helper, the scripts support `DESKTOP_SMOKE_NO_SANDBOX=1` for the temporary test process. This setting does not change the installed application's sandbox configuration.

## Project structure

```text
assets/                 Bundled license texts and tray assets
scripts/                Build helpers and desktop smoke checks
src/renderer/           React dashboard and styles
src/shared/             Typed preload contracts and data models
src/                    Electron main process, preload, and services
forge.config.cjs        Packaging configuration for Windows and Linux
PLAN.md                 Original implementation plan and design notes
THIRD_PARTY_NOTICES.md   Third-party licenses and attribution
```

## License and attribution

The project is currently marked `UNLICENSED` in `package.json`. Bundled third-party packages and mascot assets have their own license terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the license texts in `assets/licenses/`, which are included in packaged applications.
