# Windows and Linux desktop dashboard plan

## Goal

Build a desktop app for Windows and Linux inspired by the supplied screenshot: a dark, resizable dashboard with a tabbed terminal in the center, system metrics above it, weather and Google Translate on the left, and AI usage plus sticky notes on the right. The screenshot's note text is sample content, not an app command or implementation requirement.

The first release targets Windows 11 x64 plus Ubuntu/Debian and Fedora Linux x64. Test both X11 and Wayland sessions on Linux. Start with a normal desktop window; add an optional always-on-top toggle where the window system supports it. Match the visual layout at about 1280 x 720 and support display scaling on both operating systems.

## Recommended technology

| Part | Choice | Reason |
| --- | --- | --- |
| Desktop runtime | Electron | One HTML/CSS application shell for Windows and Linux, with platform-specific native integrations in the main process. |
| UI | React 19 + TypeScript | Reusable cards, terminal tabs, notes, and typed data contracts; React 19 also meets `loading-dev`'s peer requirement. |
| Build and installer | Electron Forge + Vite plugin; Squirrel.Windows, DEB, and RPM makers | Windows installer and packages for Debian/Ubuntu and Fedora. Build native modules on each target OS; prove packaging early. Forge's Vite plugin is currently marked experimental. |
| Layout and theme | CSS Grid, CSS variables, CSS Modules | Precise three-column layout, dark design tokens, scaling, and small dependency footprint. |
| Icons | `morphicons/react` + Lucide icon data from `lucide` | Consistent stroke icons, with morphing for controls whose state changes. Morphicons animates icon shapes; Lucide supplies the shapes. |
| Loading animation | `loading-dev` | Small React indicators for delayed terminal startup and external-data fetches. |
| Terminal | xterm.js in renderer + node-pty in Electron main process | Real interactive shells through Windows ConPTY or a Linux pseudoterminal, including resize and ANSI output. |
| System data | `systeminformation` | CPU, RAM, and network readings. Use a bounded in-memory history for the small charts. |
| Temperatures | Platform sensor adapters | Use optional LibreHardwareMonitor on Windows and available Linux sensors through `systeminformation`/`lm-sensors`; display "Unavailable" when a reliable reading is absent. |
| Notes | Tiptap editor + local JSON files | Rich text controls like the screenshot, note colors, and local persistence. Save attachments as separate files under Electron `userData`. |
| Desktop mascot | `page-mascot` React component | A separate corner window on Windows and Linux X11; an embedded dashboard mascot on Wayland where desktop overlay behavior is restricted. |
| Weather | Open-Meteo forecast API | Current conditions and multi-day forecast from the chosen city/coordinates. |
| Translation | Google Translate, English to Vietnamese | Translate typed text or terminal selections, with bounded requests and a website fallback. |
| AI usage | Separate adapter for each supported provider | Account usage data differs across services; show only values obtained from an authorized API or user-supplied data. |

No backend server or cloud database is needed for a single-user first release. Keep external requests in Electron's main process. The renderer accesses them through a narrow, typed preload API.

```text
React UI + xterm.js
       | typed preload API
Electron main process
  |-- platform shell sessions (node-pty)
  |-- metric sampler (systeminformation, platform sensors)
  |-- desktop mascot window and cursor position
  |-- weather / translation / usage adapters
  `-- settings, notes, and secure keys in local userData
```

## Desktop corner mascot

Use the [`page-mascot` package](https://github.com/nilbuild/page-mascot) for its React character animation. Bundle its two 3 x 3 sprite sheets locally. It is a visual mascot component, not an AI chatbot; chat or voice behavior would be a separate feature. Preserve the repository's MIT license notice when distributing it.

On Windows and Linux X11, render it in a small, frameless, transparent, always-on-top Electron window anchored to the work area of the chosen display. Keep the window close to the visible character's size so it covers little of other apps. Provide drag-to-move, corner snap, show/hide, and a tray menu. Keep the mascot running in the tray when the dashboard is minimized, and stop it when the user chooses Quit.

The package currently listens for `pointermove` in its own web page. On Windows and X11, make the character watch the cursor across the desktop by adapting or wrapping the component to accept coordinates from Electron's `screen.getCursorScreenPoint()` through a typed preload bridge. Convert screen coordinates to mascot-window coordinates and throttle updates. Handle display scaling and monitor changes.

Electron does not support `screen.getCursorScreenPoint()` or always-on-top windows on Linux Wayland. On Wayland, keep the mascot interactive inside the dashboard window, where local pointer tracking works. Do not promise a floating pet or desktop-wide cursor following there. Verify transparent-window hit behavior on Windows and X11 separately.

## Icons and loading motion

Use [Morphicons](https://www.morphicons.com/) with [Lucide](https://lucide.dev/) data icons for the toolbar, metric cards, note actions, and window controls. Use `MorphIcon` for meaningful state transitions such as menu/open, pin/unpin, or play/pause; render stable controls as static icons. The React integration consumes icons from `lucide` as data, not components from `lucide-react`. Set `reducedMotion="user"` on animated icons so the user's Windows reduced-motion preference is honored. Bundle the icon packages locally rather than loading remote assets at runtime.

Use [`loading-dev`](https://github.com/jakubkrehel/loading) for brief loading states: shell session creation, first weather/translation/AI fetch, and explicit refresh. Keep sizes and colors aligned with the dark theme. Reserve space for each indicator so content does not jump, stop it when data arrives or fails, and show clear stale/error text when a request cannot complete. The library supports reduced motion by default. Keep both projects' MIT notices in the distributed app; the Lucide icons have their own license.

## Delivery phases

1. **App shell and design.** Scaffold Electron, React 19, TypeScript, and both OS packaging targets. Build the title bar, three columns, top metric cards, terminal tabs, side panels, and footer with clearly labeled sample data. Establish colors, spacing, typography, and window minimum size. Add Lucide icons with Morphicons transitions, then prototype the mascot window or Wayland fallback with packaged sprite assets.
2. **Working terminal.** Add independent shell tabs, input/output, resize, copy/paste, scrollback, close/restart, and process cleanup. On Windows prefer PowerShell 7 when installed and fall back to Windows PowerShell. On Linux use the user's configured shell (`$SHELL`, with a safe `/bin/sh` fallback); offer `pwsh` only if installed. Verify `node-pty` in packaged builds on both systems before adding many widgets.
3. **Live system monitor.** Sample CPU, RAM, and network about once per second and render the recent trend. Add optional platform temperature readings. Pause or reduce sampling when the window is hidden.
4. **Sticky notes.** Create, edit, delete, recolor, and persist notes. Add paragraphs, headings, quotes, code blocks, dividers, inline formatting, and screenshot attachment. Restore notes after relaunch. A screenshot is attached only when the user selects one; note text never runs in the terminal.
5. **External data.** Add city selection and weather, then English-to-Vietnamese translation for typed text and highlighted terminal selections. Add AI usage adapters only for providers with supported access. Show last-updated time, loading indicators from `loading-dev`, stale, and unavailable states; cache responses and respect rate limits.
6. **Release.** Add settings, keyboard/accessibility checks, startup and memory profiling, offline behavior, a Windows installer, Linux DEB/RPM packages, and OS-specific validation. Build and smoke-test native dependencies on Windows and Linux in CI. Add code signing where appropriate for public distribution.

## First-release acceptance checks

- The dashboard remains usable at 1280 x 720 and common Windows/Linux display scales; resizing does not hide the terminal input.
- Two terminal tabs run separate interactive PowerShell sessions on Windows or the configured user shell on Linux and resize with the window.
- CPU, RAM, and network values update with visible history; missing temperature sensors are labeled accurately.
- Notes, colors, and attachments survive a restart.
- On Windows and Linux X11, the mascot can stay in a screen corner when the dashboard is minimized, react to a click, and follow the desktop cursor without blocking a large area of other apps. On Linux Wayland, the mascot works inside the dashboard.
- Icons remain legible at Windows display scales, animate only for state changes, and respect reduced-motion settings. Loading indicators end in data or a clear error state.
- Weather and AI panels distinguish live, cached, and unavailable data. Translation shows pending requests, results, errors, and a Google website fallback.
- A Windows installer and Linux DEB/RPM packages launch the app with a working terminal and locally bundled mascot/icon assets.

## Integration decisions

- The default weather city is Hanoi, Vietnam. Users can search for and save another city; the app does not request device location.
- Google Translate replaces the gold service. Translation sends only highlighted or submitted snippets to Google, keeps its cache in memory, and offers the website as a fallback because the keyless endpoint is undocumented.
- AI usage discovers local npm/NVM installations on Ubuntu and reads the signed-in Codex CLI through its app-server protocol. The app displays only rate-limit windows the CLI reports; it does not infer missing quota percentages.

## Remaining release decisions

- Decide whether the main app should be always-on-top by default on supported window systems. Click-through mode would prevent normal terminal interaction and is outside the first release.
- Choose the mascot character and default corner; users can change its position later.
- Confirm the first Linux distributions to test beyond Ubuntu/Debian and Fedora, plus any ARM64 requirement.

## References

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Microsoft node-pty](https://github.com/microsoft/node-pty) and its [Electron + xterm.js example](https://github.com/microsoft/node-pty/tree/main/examples/electron)
- [Electron Forge Vite plugin](https://www.electronforge.io/config/plugins/vite) and [Squirrel.Windows maker](https://www.electronforge.io/config/makers/squirrel.windows)
- [Electron Forge DEB maker](https://www.electronforge.io/config/makers/deb) and [RPM maker](https://www.electronforge.io/config/makers/rpm)
- [systeminformation](https://github.com/sebhildebrandt/systeminformation) and [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
- [Open-Meteo API](https://open-meteo.com/en/docs)
- [page-mascot](https://github.com/nilbuild/page-mascot), [Electron transparent windows](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles), and [Electron cursor position](https://www.electronjs.org/docs/latest/api/screen)
- [Morphicons](https://github.com/guillermolg00/morphicons), [Lucide](https://lucide.dev/), and [loading-dev](https://github.com/jakubkrehel/loading)

- Version 0.4.1 uses Ctrl+Alt+Shift+T for terminal selection translation. The app captures it before terminal/input handlers, translates the active terminal selection without using the clipboard, and shows feedback when no terminal text is selected.

- Version 0.4.2 shortens terminal selection translation to Ctrl+T. It is active only while the active terminal has highlighted text; with no highlight it preserves normal shell/input handling.

- Version 0.4.3 adds a visible Shift-drag instruction while terminal mouse reporting is enabled. Reproduced ordinary drag being consumed by Codex 0.157.1 on both X11 and Wayland, and verified Shift-drag followed by Ctrl+T transfers the selection. A smoke check covers mouse mode, selection, translation, and hint cleanup. Ubuntu's bubblewrap/AppArmor namespace warning is documented separately.

- Version 0.4.4 adds inline terminal tab renaming via double-click, a pencil icon, or F2 while a tab has focus. Enter/blur save, Escape cancels, and an empty name retains the previous label. Names are bounded to 40 characters; tab IDs and shell generations stay stable when renaming.
