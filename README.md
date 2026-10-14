# Bachnv6 Desktop

A personal desktop dashboard for Windows and Linux, built with Electron, React, TypeScript, and Electron Forge. Keep shell sessions, notes, vocabulary practice, translation, weather, and system metrics in one workspace.

The application interface, messages, and documentation are in English. Translation results, vocabulary translations, user notes, and shell output retain their own languages. Dates and application-generated numbers use English formatting regardless of the operating system's display language.

## Features

- **Terminal workspace:** independent terminal tabs, tab renaming, restart, copy, paste, clear, and ANSI color support. Windows uses PowerShell 7 when available, with Windows PowerShell as a fallback. Linux uses the configured user shell.
- **Sticky notes:** rich text, headings, quotes, code blocks, dividers, lists, text formatting, note colors, and manually selected image attachments. Notes save locally and are restored after restarting the app.
- **Vocabulary practice:** AI-generated English meanings, Vietnamese translations, and example sentences; Learn and Practice modes; and saved review counts.
- **AI settings:** choose Codex CLI or Claude CLI for fox chat and flashcards, with separate executable paths and optional model overrides for each provider. Settings save locally on Windows and Linux.
- **System metrics:** live CPU, memory, and network readings. Temperature appears when the computer exposes a supported sensor. Sampling pauses while the dashboard is hidden.
- **Weather:** current conditions and a three-day forecast from Open-Meteo, with city search and local caching. The initial city is Hanoi, Vietnam.
- **AI usage:** Claude subscription 5-hour and weekly limits with reset times, or Codex usage windows, credits, and earned resets. Redeeming a Codex reset requires confirmation in the app.
- **Desk companion:** fox chat and progress reports below Weather in the left sidebar. A compact System strip for CPU, memory, and network sits above the terminal. Chat and terminal progress reports save locally and return after restarting.
- **Appearance:** saved light/dark themes, a resizable three-column layout, window controls, and a clickable fox companion.

## Supported platforms

- Windows x64, using the Squirrel.Windows installer.
- Linux x64, with an Ubuntu 24.04 LTS amd64 packaging target.
- A Linux RPM maker is configured; build and validate it on the intended distribution before distributing it.

Build installers on their target operating system so native dependencies match that platform. The repository contains source code and required assets; compiled applications and installers are excluded from Git.

## Install on Windows

Open the generated `Setup.exe` installer from a Windows build. The installer installs the app for the current user under `%LOCALAPPDATA%\Bachnv6Desktop` and creates shortcuts. The normal per-user installation does not require administrator privileges. See the [Squirrel.Windows installation process](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/install-process.md).

The packaged app includes Electron and its runtime dependencies. Node.js is needed for development, not for running the installed app. Install and sign in to Codex CLI or Claude Code separately to use fox chat, AI flashcards, and the selected provider's usage panel. npm-installed CLIs also need their own Node.js runtime.

To produce the installer from source on Windows, follow the development setup below and run:

```powershell
npm run typecheck
npm run make -- --arch=x64
```

The Windows installer is written to `out/make/squirrel.windows/x64/`.

## Install on Ubuntu

Download the Ubuntu amd64 DEB from [GitHub Releases](https://github.com/nguyenbach03022003/bachnv6-desktop/releases). For version 0.5.1, install it from the folder containing it:

```bash
sudo apt install ./bachnv6-desktop_0.5.1_amd64.deb
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
| `npm run smoke:terminal` | Check tab reordering, close confirmation, shell preservation, and input shortcuts. |
| `npm run smoke:desktop` | Check desktop integrations using a temporary app profile. |
| `npm run smoke:notes` | Check image viewing, detach/merge, save failures, and restoring notes using an offline temporary profile. |
| `npm run smoke:companion` | Check fox chat, cancellation, report imports, saved history, and responsive layouts using a temporary profile and fake CLI. |
| `npm run smoke:ai-settings` | Check provider switching, saved settings, both CLI adapters, cancellation, usage isolation, executable discovery, and settings UI using offline fake CLIs. |
| `npm run smoke:claude-usage` | Check Claude usage parsing, sign-in discovery, caching, rate-limit backoff, account isolation, and credential protection with dummy credentials and mocked HTTPS. |

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

### AI provider settings

Open **Settings** in the header and choose **Codex CLI** or **Claude CLI**. This choice controls fox chat and vocabulary generation. Codex is the initial default. Selecting Claude does not require Codex to be installed.

Leave **Executable** blank for automatic detection, or use **Browse** to select an absolute path. Windows supports native `.exe` installations and npm `.cmd`/`.bat` shims, including paths with spaces. Linux searches `PATH`, `~/.local/bin`, `~/.npm-global/bin`, and NVM installations, including when launched from a desktop shortcut. Paths are local to each machine; configure them separately on Windows and Linux.

**Check CLI** runs only `--version`; it does not test account access or send an AI request. Sign in from a terminal with `codex login` or `claude auth login`. Keep the selected CLI up to date. An optional **Model** override applies to chat and flashcards. With a blank model, chat uses the CLI default; Codex flashcards retain `gpt-6-luna` with low reasoning effort, and Claude flashcards use the CLI default.

Choose **Save settings** to apply the selection to new AI requests. Running requests retain the provider they started with. Each provider's executable and model are remembered separately in `userData/ai-settings.json` and restored after restarting. Terminal tabs continue to run normal shells; start `claude` or `codex` there as usual. The setting does not install a CLI or change its account configuration.

The usage panel follows the selected provider. Claude shows subscription 5-hour and weekly usage percentages and reset times; Codex shows its reported usage windows, credits, and earned resets. Earned resets are available only for Codex.

The integrations follow the official [Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli) and [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference).

### Terminal tabs

Create a tab to start a separate shell. Rename a tab by double-clicking its name, selecting its pencil button, or pressing F2 while the tab button has focus. Enter or clicking elsewhere saves the name; Escape cancels. Names are limited to 40 characters.

Renaming or changing the theme preserves the running shell and its output. Closing a tab stops its shell. Tabs and their names last for the current app session.

Drag a terminal tab to change its position. With a tab focused, **Alt+Left** and **Alt+Right** also move it. Reordering keeps the same running shell and output. Closing a tab asks for confirmation; **Cancel** or Escape keeps it open.

**Ctrl+Shift** switches the app's built-in input between **EN** and **VI**. The header button shows the current mode and can also switch it. **VI** uses Telex in chat, notes, text fields, and terminals: type `tieengs Vieetj` to get `tiếng Việt`. The selected mode is remembered. Ctrl+Shift+C/V keep their copy/paste behavior without switching the mode.

### Fox chat and progress reports

Send a message in **Desk Companion → Chat** to talk with the fox through the signed-in CLI selected in Settings. Enter sends; Shift+Enter adds a line. **Stop** cancels the current reply. Chat includes recent conversation and the latest saved reports for context. AI requests run in an isolated temporary directory. Codex uses its read-only sandbox; Claude disables built-in tools, additional MCP servers, user/project settings, hooks, and session persistence for these requests.

Choose **Clear chat** beside **Send** to delete the saved conversation. Reports remain saved. Stop an active reply before clearing the chat.

In a terminal, choose **Save report** to write a task update. Selecting output first copies it into the editable report. Choose Working, Waiting, Completed, or Failed, then save. Reports retain the terminal name and time. **Open terminal** returns to a still-open tab; reports remain available when the tab closes or the app restarts.

For automatic milestone reports from Claude or Codex in a workspace terminal, choose **Connect reports**, copy its instruction, and give it to that CLI session. Each shell has a unique `DESK_COMPANION_REPORT` environment variable. Ask the CLI to overwrite that UTF-8 JSON file after a milestone:

```json
{"task":"Fix login","message":"Tests passed","status":"completed"}
```

The app imports changed reports about once per second. Supported statuses are `working`, `waiting`, `completed`, and `failed`. Task text is limited to 160 characters and report messages to 8,000 characters. This connection requires the session to publish reports; ordinary interactive terminal output is not automatically interpreted as progress. Connections start with new workspace shells. Chat retains the latest 100 messages and reports retain the latest 200 updates in `userData/companion`.

### Translation shortcuts

- **Ctrl+Enter:** translate the text in the translation input.
- **Ctrl+T:** translate highlighted text from the active terminal.
- **Shift+drag, then Ctrl+T:** select and translate text in Codex or another terminal program that captures mouse events.

**Translate terminal selections** is enabled by default. Turn it off to translate only through a button or shortcut. With no highlighted terminal text, Ctrl+T keeps its normal shell or input behavior.

The language-swap button reverses the translation direction. If a result is available, it becomes the new input. The selected direction is remembered after restarting the app. All translation controls and status messages remain in English in either direction.

Requests are limited to 5,000 characters and time out after 12 seconds. The keyless Google endpoint is undocumented and may change or be throttled. **Open in Google** opens the selected text and translation direction on the Google Translate website.

### Sticky notes and vocabulary

Use **Sticky notes** for rich text and **Vocabulary** for flashcards. Notes save automatically under Electron's local `userData/notes` directory, and closing the app waits for pending writes. Note text is never executed in the terminal.

Click an attached image to open a separate, resizable image window. Use **Fit to window**, **Actual size**, or the zoom buttons to inspect it; scroll to explore a zoomed image and press Escape to close the viewer.

Choose **Detach** above the notes tabs to move the notes and vocabulary workspace into its own window, with larger text for reading notes. Pending note edits save before the move. Choose **Merge back** in either window to return it to the dashboard; closing the separate notes window also returns the panel. Your selected note, content, attachments, and learning space carry across. Detaching lasts for the current app session.

In Vocabulary, enter one to eight English words or phrases separated by commas or new lines, then select **Create with AI**. The app uses the CLI and optional model selected in Settings. Each card includes an English meaning, a Vietnamese translation, and an English example sentence. Cards and practice counts save under `userData/vocabulary`.

Flashcard generation requires the selected CLI, a completed sign-in, and internet access. The selected learning space is remembered after restarting the app.

### Codex usage

Install Codex CLI and sign in with `codex login` to enable the usage panel. On Ubuntu, the app searches common npm and NVM installation locations so a desktop-menu launch can locate the CLI.

The panel shows values reported by `codex app-server`. Missing values appear as **Not reported**. When an earned reset is available, choose a listed reset or **Next available reset**, select **Use reset**, and confirm. The app then refreshes usage and the reset bank.

### Claude usage

Choose **Claude CLI** in Settings and sign in to a Claude subscription with `claude auth login`. The usage panel shows **5-hour limit**, **Weekly limit**, and their reset times. Additional Sonnet or Opus weekly limits appear when reported. Missing windows show **Not reported**, rather than an invented zero.

The app reads Claude's saved OAuth sign-in from `~/.claude/.credentials.json` on Linux or `%USERPROFILE%\.claude\.credentials.json` on Windows, honoring `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_OAUTH_TOKEN` when set. Credentials stay in the main process; they are never sent to the renderer, copied into app settings, or included in diagnostics. Claude sign-in storage is described in the official [authentication documentation](https://code.claude.com/docs/en/authentication).

Usage requests go only to Anthropic's subscription usage endpoint. This endpoint is undocumented and can change. Subscription limits differ from API token billing; API-key-only accounts may not report these windows. The app does not generate a model reply to check usage. Responses cache for five minutes, manual refreshes are limited to once per minute, and HTTP 429 cooldowns are respected. Temporary failures keep clearly marked cached values; sign-out, account changes, and authentication errors clear previous account values. Run `claude auth login` if the panel requests a new sign-in.

## Local data and external requests

| Feature | Local storage | External service |
| --- | --- | --- |
| Notes and attachments | Electron `userData/notes` | None |
| Fox chat and progress reports | Electron `userData/companion` | The selected CLI receives submitted chat, recent conversation, and latest reports when you send a message. |
| Vocabulary and review counts | Electron `userData/vocabulary` | The selected CLI sends entered words for AI generation. |
| AI provider settings | Electron `userData/ai-settings.json` | None; Check CLI reads the locally installed version. |
| Weather | Electron `userData/weather` | Open-Meteo receives city searches and selected coordinates. |
| Translation | In-memory text/cache; preferences stored locally | Google receives submitted or selected text. |
| Codex usage | CLI-managed account state; usage held in memory | The signed-in Codex CLI obtains account usage. |
| Claude usage | CLI-managed OAuth sign-in read in the main process; usage held in memory | Anthropic receives an authenticated subscription usage request. |
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
