import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Arc } from 'loading-dev';
import { Pencil, Plus, RotateCcw, Terminal as TerminalIcon, X } from 'lucide';
import { MorphIcon } from 'morphicons/react';
import '@xterm/xterm/css/xterm.css';
import styles from './TerminalWorkspace.module.css';
import { terminalThemes, type AppTheme } from './theme';
import { isTranslateSelectionShortcut, TRANSLATE_SELECTION_ARIA_SHORTCUT, TRANSLATE_SELECTION_SHORTCUT } from './translation-shortcut';

interface TerminalSession {
  id: string;
  shell: string;
  cwd: string;
}

interface TerminalBridge {
  createTerminal(cols: number, rows: number): Promise<TerminalSession>;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  closeTerminal(id: string): Promise<void>;
  onTerminalData(listener: (event: { id: string; data: string }) => void): () => void;
  onTerminalExit(listener: (event: { id: string; exitCode: number }) => void): () => void;
  readTerminalClipboard(): Promise<string>;
  writeTerminalClipboard(text: string): Promise<void>;
}

type Tab = { id: number; generation: number; name: string };
const MAX_TAB_NAME_LENGTH = 40;
type SessionState =
  | { kind: 'connecting' }
  | { kind: 'ready'; shell: string; cwd: string }
  | { kind: 'exited'; exitCode: number }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable' };

function getBridge(): TerminalBridge | null {
  const dashboard = window.dashboard as (Window['dashboard'] & Partial<TerminalBridge>) | undefined;
  if (
    !dashboard ||
    typeof dashboard.createTerminal !== 'function' ||
    typeof dashboard.writeTerminal !== 'function' ||
    typeof dashboard.resizeTerminal !== 'function' ||
    typeof dashboard.closeTerminal !== 'function' ||
    typeof dashboard.onTerminalData !== 'function' ||
    typeof dashboard.onTerminalExit !== 'function' ||
    typeof dashboard.readTerminalClipboard !== 'function' ||
    typeof dashboard.writeTerminalClipboard !== 'function'
  ) return null;
  return dashboard as TerminalBridge;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function TerminalPane({
  theme,
  active,
  shouldFocus,
  bridge,
  panelId,
  tab,
  tabId,
  onRestart,
  autoTranslate,
  onTranslateSelection,
}: {
  theme: AppTheme;
  active: boolean;
  shouldFocus: boolean;
  bridge: TerminalBridge | null;
  panelId: string;
  tab: Tab;
  tabId: string;
  onRestart: () => void;
  autoTranslate: boolean;
  onTranslateSelection: (text: string) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Xterm | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [state, setState] = useState<SessionState>(bridge ? { kind: 'connecting' } : { kind: 'unavailable' });
  const [hasSelection, setHasSelection] = useState(false);
  const [mouseReporting, setMouseReporting] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const translationRef = useRef({ active, autoTranslate, onTranslateSelection });
  translationRef.current = { active, autoTranslate, onTranslateSelection };

  useEffect(() => {
    const host = hostRef.current;
    if (!bridge || !host) return;

    let disposed = false;
    let sessionId: string | null = null;
    let creating = true;
    let exited = false;
    let lastSize = '';
    let writeQueue: Promise<void> = Promise.resolve();
    let selectionTimer: number | undefined;
    const earlyData = new Map<string, string>();
    const earlyExits = new Map<string, number>();
    const terminal = new Xterm({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 1.3,
      scrollback: 5000,
      screenReaderMode: true,
      disableStdin: true,
      theme: terminalThemes[themeRef.current],
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    const modeSubscription = terminal.onWriteParsed(() => {
      if (!disposed) setMouseReporting(terminal.modes.mouseTrackingMode !== 'none');
    });

    function fitTerminal() {
      if (disposed || !host || host.clientWidth < 25 || host.clientHeight < 25) return;
      try {
        fit.fit();
        const size = `${terminal.cols}:${terminal.rows}`;
        if (sessionId && size !== lastSize) {
          void bridge!.resizeTerminal(sessionId, terminal.cols, terminal.rows).catch((error: unknown) => {
            if (!disposed && !exited) setState({ kind: 'error', message: `Terminal resize failed: ${errorMessage(error)}` });
          });
          lastSize = size;
        }
      } catch (error) {
        if (!disposed) setState({ kind: 'error', message: `Terminal resize failed: ${errorMessage(error)}` });
      }
    }

    const resizeObserver = new ResizeObserver(fitTerminal);
    resizeObserver.observe(host);
    fitTerminal();

    const unsubscribeData = bridge.onTerminalData(({ id, data }) => {
      if (disposed) return;
      if (id === sessionId) {
        terminal.write(data);
      } else if (creating) {
        // A shell can print its first prompt before createTerminal's promise resolves.
        const previous = earlyData.get(id) ?? '';
        earlyData.set(id, (previous + data).slice(-65536));
      }
    });
    const unsubscribeExit = bridge.onTerminalExit(({ id, exitCode }) => {
      if (disposed) return;
      if (id === sessionId) {
        exited = true;
        terminal.options.disableStdin = true;
        setState({ kind: 'exited', exitCode });
      } else if (creating) {
        earlyExits.set(id, exitCode);
      }
    });
    const inputSubscription = terminal.onData((data: string) => {
      if (!disposed && sessionId) {
        const id = sessionId;
        // IPC bounds each write to 64 KiB. Serialize smaller chunks so a large
        // paste remains in order and does not vanish without feedback.
        writeQueue = writeQueue.then(async () => {
          for (let offset = 0; offset < data.length;) {
            let end = Math.min(offset + 16384, data.length);
            if (end < data.length && data.charCodeAt(end - 1) >= 0xd800 && data.charCodeAt(end - 1) <= 0xdbff
              && data.charCodeAt(end) >= 0xdc00 && data.charCodeAt(end) <= 0xdfff) end--;
            await bridge.writeTerminal(id, data.slice(offset, end));
            offset = end;
          }
        }).catch((error: unknown) => {
          if (disposed || exited) return;
          terminal.options.disableStdin = true;
          setState({ kind: 'error', message: `Terminal input failed: ${errorMessage(error)}` });
        });
      }
    });
    const selectionSubscription = terminal.onSelectionChange(() => {
      setHasSelection(terminal.hasSelection());
      window.clearTimeout(selectionTimer);
      if (!terminal.hasSelection() || !translationRef.current.active || !translationRef.current.autoTranslate) return;
      // Wait until the user has finished adjusting the highlighted range.
      selectionTimer = window.setTimeout(() => {
        const current = translationRef.current;
        if (!disposed && current.active && current.autoTranslate && terminal.hasSelection()) {
          void current.onTranslateSelection(terminal.getSelection());
        }
      }, 650);
    });
    function translateSelectionShortcut(event: globalThis.KeyboardEvent): void {
      const current = translationRef.current;
      if (disposed || !current.active || !isTranslateSelectionShortcut(event)) return;
      const text = terminal.getSelection();
      // Ctrl+T keeps its usual shell/input behavior when nothing is selected.
      if (!text.trim()) return;
      // Capture this app shortcut before xterm or a focused note/input consumes
      // it. Reading xterm's selection doesn't touch the system clipboard.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== 'keydown' || event.repeat) return;
      window.clearTimeout(selectionTimer);
      setClipboardError(null);
      void current.onTranslateSelection(text);
    }
    const shortcutEvents = ['keydown', 'keypress', 'keyup'] as const;
    for (const type of shortcutEvents) window.addEventListener(type, translateSelectionShortcut, true);
    terminal.attachCustomKeyEventHandler((event: globalThis.KeyboardEvent) => {
      if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey)) return true;
      const key = event.key.toLowerCase();
      if (key === 'c' && (event.shiftKey || terminal.hasSelection())) {
        event.preventDefault();
        if (terminal.hasSelection()) {
          void bridge.writeTerminalClipboard(terminal.getSelection()).then(
            () => setClipboardError(null),
            (error: unknown) => setClipboardError(`Copy failed: ${errorMessage(error)}`),
          );
        }
        return false;
      }
      if (key === 'v') {
        event.preventDefault();
        if (sessionId && !terminal.options.disableStdin) {
          void bridge.readTerminalClipboard().then(
            (data) => { if (!disposed && data) terminal.paste(data); setClipboardError(null); },
            (error: unknown) => setClipboardError(`Paste failed: ${errorMessage(error)}`),
          );
        }
        return false;
      }
      return true;
    });

    const startTimer = window.setTimeout(() => {
      if (disposed) return;
      fitTerminal();
      const cols = Math.max(2, terminal.cols);
      const rows = Math.max(1, terminal.rows);
      lastSize = `${cols}:${rows}`;
      void bridge.createTerminal(cols, rows).then((session) => {
        if (disposed) {
          void bridge.closeTerminal(session.id).catch(() => undefined);
          return;
        }
        sessionId = session.id;
        creating = false;
        const output = earlyData.get(session.id);
        if (output) terminal.write(output);
        earlyData.clear();
        const exitCode = earlyExits.get(session.id);
        earlyExits.clear();
        if (exitCode !== undefined) {
          exited = true;
          terminal.options.disableStdin = true;
          setState({ kind: 'exited', exitCode });
        } else {
          terminal.options.disableStdin = false;
          setState({ kind: 'ready', shell: session.shell, cwd: session.cwd });
        }
        fitTerminal();
      }).catch((error: unknown) => {
        if (!disposed) {
          creating = false;
          earlyData.clear();
          earlyExits.clear();
          setState({ kind: 'error', message: errorMessage(error) });
        }
      });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(selectionTimer);
      resizeObserver.disconnect();
      unsubscribeData();
      unsubscribeExit();
      inputSubscription.dispose();
      selectionSubscription.dispose();
      modeSubscription.dispose();
      for (const type of shortcutEvents) window.removeEventListener(type, translateSelectionShortcut, true);
      terminalRef.current = null;
      terminal.dispose();
      if (sessionId) void bridge.closeTerminal(sessionId).catch(() => undefined);
    };
  }, [bridge]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalThemes[theme];
  }, [theme]);

  useEffect(() => {
    if (active && shouldFocus && state.kind === 'ready') terminalRef.current?.focus();
  }, [active, shouldFocus, state.kind]);

  async function copySelection() {
    const terminal = terminalRef.current;
    if (!terminal?.hasSelection()) return;
    try {
      await bridge?.writeTerminalClipboard(terminal.getSelection());
      setClipboardError(null);
    } catch (error) {
      setClipboardError(`Copy failed: ${errorMessage(error)}`);
    }
  }

  async function pasteClipboard() {
    const terminal = terminalRef.current;
    if (!terminal || state.kind !== 'ready') return;
    try {
      const data = await bridge?.readTerminalClipboard();
      if (data) terminal.paste(data);
      terminal.focus();
      setClipboardError(null);
    } catch (error) {
      setClipboardError(`Paste failed: ${errorMessage(error)}`);
    }
  }

  // Keep a small toolbar alongside xterm's built-in text selection and scrollback.
  const statusLabel = state.kind === 'ready'
    ? `${state.shell} · ${state.cwd}`
    : state.kind === 'exited' ? `Exited (${state.exitCode})`
      : state.kind === 'connecting' ? 'Starting shell…'
        : state.kind === 'unavailable' ? 'Desktop shell unavailable' : 'Shell failed';

  return (
    <div id={panelId} role="tabpanel" aria-labelledby={tabId} aria-label={tab.name} hidden={!active} className={styles.pane}>
      <div className={styles.surface}>
        <div className={styles.terminalHost} ref={hostRef} aria-label={`${tab.name} terminal output and input`}
          aria-describedby={mouseReporting ? `${panelId}-selection-hint` : undefined} />
        {state.kind !== 'ready' && (
          <div className={styles.stateOverlay} role={state.kind === 'error' ? 'alert' : 'status'}>
            {state.kind === 'connecting' ? (
              <><Arc size={19} /><span>Starting shell…</span></>
            ) : state.kind === 'unavailable' ? (
              <><strong>Terminal unavailable</strong><span>Open this workspace in the desktop app to run commands.</span></>
            ) : state.kind === 'exited' ? (
              <><strong>Shell exited with code {state.exitCode}</strong><button type="button" onClick={onRestart}>Restart terminal</button></>
            ) : (
              <><strong>Could not start terminal</strong><span>{state.message}</span><button type="button" onClick={onRestart}>Try again</button></>
            )}
          </div>
        )}
      </div>
      <div className={styles.toolbar}>
        <span className={styles.status} title={statusLabel} aria-live="polite">{statusLabel}</span>
        <div className={styles.actions}>
          <button type="button" onMouseDown={(event) => event.preventDefault()}
            onClick={() => { const text = terminalRef.current?.getSelection(); if (text) void onTranslateSelection(text); }}
            disabled={!hasSelection} aria-keyshortcuts={TRANSLATE_SELECTION_ARIA_SHORTCUT}
            title={`Translate selected English to Vietnamese (${TRANSLATE_SELECTION_SHORTCUT})`}>Translate</button>
          <button type="button" onClick={() => { void copySelection(); }} disabled={!hasSelection} title="Copy selection (Ctrl+Shift+C)">Copy</button>
          <button type="button" onClick={() => { void pasteClipboard(); }} disabled={state.kind !== 'ready'} title="Paste clipboard (Ctrl+Shift+V)">Paste</button>
          <button type="button" onClick={() => terminalRef.current?.clear()} disabled={!terminalRef.current} title="Clear terminal display">Clear</button>
          <button type="button" onClick={onRestart} aria-label={`Restart ${tab.name}`} title={`Restart ${tab.name}`}><MorphIcon icon={RotateCcw} size={13} reducedMotion="user" aria-hidden="true" /></button>
        </div>
      </div>
      {mouseReporting && <div id={`${panelId}-selection-hint`} className={styles.selectionHint} role="status">
        Hold <kbd>Shift</kbd> and drag to select text. Release Shift, then press <kbd>{TRANSLATE_SELECTION_SHORTCUT}</kbd> to translate.
      </div>}
      {clipboardError && <div className={styles.clipboardError} role="alert">{clipboardError}<button type="button" onClick={() => setClipboardError(null)} aria-label="Dismiss clipboard error">×</button></div>}
    </div>
  );
}

export function TerminalWorkspace({ theme, autoTranslate, onTranslateSelection }: {
  theme: AppTheme;
  autoTranslate: boolean;
  onTranslateSelection: (text: string) => Promise<void>;
}) {
  const idPrefix = useId().replace(/:/g, '');
  const nextTabId = useRef(2);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, generation: 0, name: 'Terminal 1' }]);
  const [activeId, setActiveId] = useState<number | null>(1);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameIdRef = useRef<number | null>(null);
  const bridge = getBridge();

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming?.id]);

  function beginRename(tab: Tab) {
    renameIdRef.current = tab.id;
    setRenaming({ id: tab.id, value: tab.name });
    setActiveId(tab.id);
    setFocusId(null);
  }

  function finishRename(id: number, value: string, save: boolean, restoreFocus: boolean) {
    // Enter/Escape can unmount the focused input before its blur is delivered.
    if (renameIdRef.current !== id) return;
    renameIdRef.current = null;
    const name = value.trim();
    if (save && name) {
      setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, name } : tab));
    }
    setRenaming(null);
    if (restoreFocus) requestAnimationFrame(() => document.getElementById(`${idPrefix}-tab-${id}`)?.focus());
  }

  function addTab() {
    const id = nextTabId.current++;
    setTabs((current) => [...current, { id, generation: 0, name: `Terminal ${id}` }]);
    setActiveId(id);
    setFocusId(id);
  }

  function closeTab(id: number) {
    if (renameIdRef.current === id) {
      renameIdRef.current = null;
      setRenaming(null);
    }
    const index = tabs.findIndex((tab) => tab.id === id);
    const remaining = tabs.filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (activeId === id) {
      const nextId = remaining[Math.max(0, index - 1)]?.id ?? remaining[0]?.id ?? null;
      setActiveId(nextId);
      setFocusId(null);
      if (nextId !== null) requestAnimationFrame(() => document.getElementById(`${idPrefix}-tab-${nextId}`)?.focus());
    }
  }

  function restartTab(id: number) {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, generation: tab.generation + 1 } : tab));
    setFocusId(id);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'F2') {
      event.preventDefault();
      beginRename(tabs[index]);
      return;
    }
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break;
      case 'ArrowLeft': nextIndex = (index - 1 + tabs.length) % tabs.length; break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const nextId = tabs[nextIndex].id;
    setActiveId(nextId);
    setFocusId(null);
    document.getElementById(`${idPrefix}-tab-${nextId}`)?.focus();
  }

  return (
    <div className={styles.workspace}>
      <div className={styles.heading}>
        <div className={styles.title}><MorphIcon icon={TerminalIcon} size={18} reducedMotion="user" aria-hidden="true" /><h2>Terminal workspace</h2></div>
        <span className={styles.liveTag}>{bridge ? 'Live shell' : 'Desktop only'}</span>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Terminal tabs">
        <div className={styles.tabScroller}>
          {tabs.map((tab, index) => (
            <div className={styles.tabGroup} role="presentation" key={tab.id}>
              <button
                type="button"
                id={`${idPrefix}-tab-${tab.id}`}
                role="tab"
                aria-selected={activeId === tab.id}
                aria-controls={`${idPrefix}-panel-${tab.id}`}
                aria-label={tab.name}
                title={`${tab.name} — double-click or press F2 to rename`}
                tabIndex={activeId === tab.id ? 0 : -1}
                onClick={() => { setActiveId(tab.id); setFocusId(tab.id); }}
                onDoubleClick={() => beginRename(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              ><MorphIcon icon={TerminalIcon} size={13} reducedMotion="user" aria-hidden="true" />
                <span className={renaming?.id === tab.id ? styles.visuallyHidden : styles.tabName}>{tab.name}</span>
              </button>
              {renaming?.id === tab.id && <>
                <input ref={renameInputRef} className={styles.renameInput} type="text" value={renaming.value}
                  maxLength={MAX_TAB_NAME_LENGTH} spellCheck={false} aria-label={`Rename ${tab.name}`}
                  aria-describedby={`${idPrefix}-rename-help`} placeholder="Tab name" title="Enter to save, Escape to cancel"
                  onChange={(event) => setRenaming({ id: tab.id, value: event.target.value })}
                  onBlur={(event) => finishRename(tab.id, event.currentTarget.value, true, false)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === 'Enter' || event.key === 'Escape') {
                      event.preventDefault();
                      finishRename(tab.id, event.currentTarget.value, event.key === 'Enter', true);
                    }
                  }} />
                <span id={`${idPrefix}-rename-help`} className={styles.visuallyHidden}>Enter to save. Escape to cancel. Clicking elsewhere saves.</span>
              </>}
              {renaming?.id !== tab.id && <button type="button" className={styles.renameTab}
                aria-label={`Rename ${tab.name}`} title={`Rename ${tab.name}`} onClick={() => beginRename(tab)}>
                <MorphIcon icon={Pencil} size={12} reducedMotion="user" aria-hidden="true" />
              </button>}
              <button type="button" className={styles.closeTab} aria-label={`Close ${tab.name}`} title={`Close ${tab.name}`} onClick={() => closeTab(tab.id)}><MorphIcon icon={X} size={13} reducedMotion="user" aria-hidden="true" /></button>
            </div>
          ))}
        </div>
        <button type="button" className={styles.addTab} aria-label="New terminal" title="New terminal" onClick={addTab}><MorphIcon icon={Plus} size={16} reducedMotion="user" aria-hidden="true" /></button>
      </div>
      <div className={styles.panes}>
        {tabs.length === 0 ? (
          <div className={styles.emptyState}><MorphIcon icon={TerminalIcon} size={22} reducedMotion="user" aria-hidden="true" /><p>No terminal sessions</p><button type="button" onClick={addTab}>Open a terminal</button></div>
        ) : tabs.map((tab) => (
          <TerminalPane
            theme={theme}
            key={`${tab.id}-${tab.generation}`}
            tab={tab}
            active={activeId === tab.id}
            shouldFocus={focusId === tab.id}
            bridge={bridge}
            tabId={`${idPrefix}-tab-${tab.id}`}
            panelId={`${idPrefix}-panel-${tab.id}`}
            onRestart={() => restartTab(tab.id)}
            autoTranslate={autoTranslate}
            onTranslateSelection={onTranslateSelection}
          />
        ))}
      </div>
    </div>
  );
}
