import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Arc } from 'loading-dev';
import { Pencil, Plus, RotateCcw, Terminal as TerminalIcon, X } from 'lucide';
import { MorphIcon } from 'morphicons/react';
import '@xterm/xterm/css/xterm.css';
import styles from './TerminalWorkspace.module.css';
import { terminalThemes, type AppTheme } from './theme';
import { isTranslateSelectionShortcut, TRANSLATE_SELECTION_ARIA_SHORTCUT, TRANSLATE_SELECTION_SHORTCUT } from './translation-shortcut';
import { OPEN_TERMINAL_EVENT, REPORT_DRAFT_EVENT, REOPEN_TERMINAL_EVENT, type ReopenTerminalRequest } from './companion-events';
import type { TerminalStartOptions } from '../shared/terminal-types';
import { createEngine, REPLACE, PASSTHROUGH, type VietTelexEngine, type TypingAction } from '@viettelex/core';
import { useInputLanguage } from './InputLanguage';

interface TerminalSession {
  id: string;
  shell: string;
  cwd: string;
  reportFile?: string;
}

interface TerminalBridge {
  createTerminal(cols: number, rows: number, options?: TerminalStartOptions): Promise<TerminalSession>;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  closeTerminal(id: string): Promise<void>;
  onTerminalData(listener: (event: { id: string; data: string }) => void): () => void;
  onTerminalExit(listener: (event: { id: string; exitCode: number }) => void): () => void;
  readTerminalClipboard(): Promise<string>;
  writeTerminalClipboard(text: string): Promise<void>;
}

type Tab = { id: number; generation: number; name: string; sessionId?: string; live?: boolean; restore?: ReopenTerminalRequest };
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
  onStarted,
  onStopped,
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
  onStarted: (sessionId: string) => void;
  onStopped: () => void;
  autoTranslate: boolean;
  onTranslateSelection?: (text: string) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Xterm | null>(null);
  const typingEngineRef = useRef<VietTelexEngine | null>(null);
  const { language } = useInputLanguage();
  const languageRef = useRef(language);
  languageRef.current = language;
  const sessionRef = useRef<TerminalSession | null>(null);
  const nameRef = useRef(tab.name);
  nameRef.current = tab.name;
  const [reportHelp, setReportHelp] = useState(false);
  const [reportFile, setReportFile] = useState<string | null>(null);
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
    let telexHandled = false;
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
    void createEngine({ inputMethod: 'telex', modernTone: true }).then(engine => {
      if (disposed) engine.destroy(); else typingEngineRef.current = engine;
    }).catch(reason => console.error('Could not load terminal typing', reason));
    const modeSubscription = terminal.onWriteParsed(() => {
      if (!disposed) setMouseReporting(terminal.modes.mouseTrackingMode !== 'none');
    });

    function fitTerminal() {
      if (disposed || !host || host.clientWidth < 25 || host.clientHeight < 25) return;
      try {
        fit.fit();
        const size = `${terminal.cols}:${terminal.rows}`;
        if (sessionId && !exited && size !== lastSize) {
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
        onStopped();
        terminal.options.disableStdin = true;
        setState({ kind: 'exited', exitCode });
      } else if (creating) {
        earlyExits.set(id, exitCode);
      }
    });
    function writeInput(data: string) {
      if (!disposed && sessionId) {
        const id = sessionId;
        // IPC bounds each write to 64 KiB. Serialize smaller chunks so a large
        // paste remains in order and does not vanish without feedback.
        writeQueue = writeQueue.then(async () => {
          for (let offset = 0; offset < data.length;) {
            let end = Math.min(offset + 16384, data.length);
            if (end < data.length && data.charCodeAt(end - 1) >= 0xd800 && data.charCodeAt(end - 1) <= 0xdbff
              && data.charCodeAt(end) >= 0xdc00 && data.charCodeAt(end) <= 0xdfff) end--;
            await bridge!.writeTerminal(id, data.slice(offset, end));
            offset = end;
          }
        }).catch((error: unknown) => {
          if (disposed || exited) return;
          terminal.options.disableStdin = true;
          setState({ kind: 'error', message: `Terminal input failed: ${errorMessage(error)}` });
        });
      }
    }
    const inputSubscription = terminal.onData(writeInput);
    function applyTyping(action: TypingAction) {
      if (action.kind === REPLACE) writeInput('\x7f'.repeat(action.backspaces) + action.insert);
    }
    const resetTyping = () => typingEngineRef.current?.resetContext();
    host.addEventListener('mousedown', resetTyping);
    terminal.textarea?.addEventListener('blur', resetTyping);
    terminal.textarea?.addEventListener('compositionstart', resetTyping);
    const selectionSubscription = terminal.onSelectionChange(() => {
      setHasSelection(terminal.hasSelection());
      window.clearTimeout(selectionTimer);
      if (!terminal.hasSelection() || !translationRef.current.active || !translationRef.current.autoTranslate) return;
      // Wait until the user has finished adjusting the highlighted range.
      selectionTimer = window.setTimeout(() => {
        const current = translationRef.current;
        if (!disposed && current.active && current.autoTranslate && terminal.hasSelection()) {
          void current.onTranslateSelection?.(terminal.getSelection());
        }
      }, 650);
    });
    function translateSelectionShortcut(event: globalThis.KeyboardEvent): void {
      const current = translationRef.current;
      if (disposed || !current.active || !current.onTranslateSelection || !isTranslateSelectionShortcut(event)) return;
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
      if (event.type === 'keypress' && telexHandled) { event.preventDefault(); return false; }
      if (event.type === 'keyup') telexHandled = false;
      if (event.type === 'keydown') telexHandled = false;
      // The global input-language handler owns the modifier chord; do not
      // turn its modifier presses into shell input.
      if (!event.altKey && !event.metaKey && (event.key === 'Shift' || event.key === 'Control')
        && event.ctrlKey && event.shiftKey) return false;
      // Let xterm's composition helper handle IME/AltGr input before shortcuts.
      if (event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')) { resetTyping(); return true; }
      const engine = typingEngineRef.current;
      if (event.type === 'keydown' && languageRef.current === 'vi' && engine && !terminal.options.disableStdin) {
        if (event.ctrlKey || event.altKey || event.metaKey) engine.reset();
        else if (/^[A-Za-z]$/.test(event.key)) {
          const action = engine.feed(event.key);
          if (action.kind === PASSTHROUGH) writeInput(event.key); else applyTyping(action);
          event.preventDefault();
          telexHandled = true;
          return false;
        } else if (event.key === 'Backspace') {
          const action = engine.backspace();
          if (action.kind !== PASSTHROUGH) {
            applyTyping(action);
            event.preventDefault();
            telexHandled = true;
            return false;
          }
        } else if (event.key === 'Enter' || event.key === 'Tab' || event.key.length === 1 && event.key.charCodeAt(0) < 128) {
          applyTyping(engine.commitBoundary());
        } else engine.reset();
      }
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
      const historyReady = tab.restore ? window.dashboard!.sessions.read(tab.restore.sessionId).then(history => {
        if (!disposed && history.output) {
          terminal.write(history.output.replace(/\n/g, '\r\n'));
          terminal.writeln('\r\n── Saved output ends; opening a new terminal ──\r\n');
        }
      }) : Promise.resolve();
      void historyReady.then(() => {
        if (disposed) throw new Error('Terminal tab was closed before it could open.');
        return bridge.createTerminal(cols, rows, { name: nameRef.current,
          ...(tab.restore ? { sessionId: tab.restore.sessionId, resumeAi: tab.restore.resumeAi } : {}) });
      }).then((session) => {
        if (disposed) {
          void bridge.closeTerminal(session.id).catch(() => undefined);
          return;
        }
        sessionId = session.id;
        sessionRef.current = session;
        onStarted(session.id);
        tab.restore?.resolve();
        setReportFile(session.reportFile ?? null);
        void window.dashboard?.companion.labelTerminal(session.id, nameRef.current).catch(() => undefined);
        creating = false;
        const output = earlyData.get(session.id);
        if (output) terminal.write(output);
        earlyData.clear();
        const exitCode = earlyExits.get(session.id);
        earlyExits.clear();
        if (exitCode !== undefined) {
          exited = true;
          onStopped();
          terminal.options.disableStdin = true;
          setState({ kind: 'exited', exitCode });
        } else {
          terminal.options.disableStdin = false;
          setState({ kind: 'ready', shell: session.shell, cwd: session.cwd });
        }
        fitTerminal();
      }).catch((error: unknown) => {
        tab.restore?.reject(error);
        if (!disposed) {
          onStopped();
          creating = false;
          earlyData.clear();
          earlyExits.clear();
          setState({ kind: 'error', message: errorMessage(error) });
        }
      });
    }, 0);

    return () => {
      disposed = true;
      if (!sessionId) tab.restore?.reject(new Error('Terminal tab was closed before it could open.'));
      window.clearTimeout(startTimer);
      window.clearTimeout(selectionTimer);
      resizeObserver.disconnect();
      unsubscribeData();
      unsubscribeExit();
      inputSubscription.dispose();
      selectionSubscription.dispose();
      modeSubscription.dispose();
      host.removeEventListener('mousedown', resetTyping);
      terminal.textarea?.removeEventListener('blur', resetTyping);
      terminal.textarea?.removeEventListener('compositionstart', resetTyping);
      typingEngineRef.current?.destroy();
      typingEngineRef.current = null;
      for (const type of shortcutEvents) window.removeEventListener(type, translateSelectionShortcut, true);
      terminalRef.current = null;
      sessionRef.current = null;
      terminal.dispose();
      if (sessionId) void bridge.closeTerminal(sessionId).catch(() => undefined);
    };
  }, [bridge]);

  useEffect(() => { typingEngineRef.current?.resetContext(); }, [language, active]);

  useEffect(() => {
    const session = sessionRef.current;
    if (session) void window.dashboard?.companion.labelTerminal(session.id, tab.name).catch(() => undefined);
  }, [tab.name]);
  useEffect(() => {
    function open(event: Event) {
      if ((event as CustomEvent<string>).detail === sessionRef.current?.id) {
        event.preventDefault();
        document.getElementById(tabId)?.click();
        requestAnimationFrame(() => terminalRef.current?.focus());
      }
    }
    window.addEventListener(OPEN_TERMINAL_EVENT, open);
    return () => window.removeEventListener(OPEN_TERMINAL_EVENT, open);
  }, [tabId]);

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
          <button type="button" disabled={!sessionRef.current || !window.dashboard?.companion}
            title="Leave a progress report for the fox; selected output is included"
            onClick={() => window.dispatchEvent(new CustomEvent(REPORT_DRAFT_EVENT, { detail: {
              sessionId: sessionRef.current!.id, source: tab.name, message: (terminalRef.current?.getSelection() ?? '').slice(0, 8000),
            } }))}>Save report</button>
          <button type="button" disabled={!reportFile} aria-expanded={reportHelp} onClick={() => setReportHelp(!reportHelp)}>Connect reports</button>
          {onTranslateSelection && <button type="button" onMouseDown={(event) => event.preventDefault()}
            onClick={() => { const text = terminalRef.current?.getSelection(); if (text) void onTranslateSelection(text); }}
            disabled={!hasSelection} aria-keyshortcuts={TRANSLATE_SELECTION_ARIA_SHORTCUT}
            title={`Translate selected text (${TRANSLATE_SELECTION_SHORTCUT})`}>Translate</button>}
          <button type="button" onClick={() => { void copySelection(); }} disabled={!hasSelection} title="Copy selection (Ctrl+Shift+C)">Copy</button>
          <button type="button" onClick={() => { void pasteClipboard(); }} disabled={state.kind !== 'ready'} title="Paste clipboard (Ctrl+Shift+V)">Paste</button>
          <button type="button" onClick={() => terminalRef.current?.clear()} disabled={!terminalRef.current} title="Clear terminal display">Clear</button>
          <button type="button" onClick={onRestart} aria-label={`Restart ${tab.name}`} title={`Restart ${tab.name}`}><MorphIcon icon={RotateCcw} size={13} reducedMotion="user" aria-hidden="true" /></button>
        </div>
      </div>
      {reportHelp && <div className={styles.reportHelp}>
          <p>Give this instruction to Claude or Codex in this terminal:</p>
        <p>After each milestone, overwrite the UTF-8 JSON file at DESK_COMPANION_REPORT with task, message, and status (working, waiting, completed, or failed). Include cwd and ai (provider and sessionId) to let Desk Companion resume this conversation. Use your actual CLI session ID; Codex exposes CODEX_THREAD_ID to its tools.</p>
        <code>{'{"task":"Fix login","message":"Tests passed","status":"completed"}'}</code>
        <p>Report file: {reportFile}</p>
        <button type="button" onClick={() => { void bridge?.writeTerminalClipboard('After each milestone, overwrite the UTF-8 JSON file at the path in the DESK_COMPANION_REPORT environment variable with an object containing task, message, and status (working, waiting, completed, or failed). Also include cwd (your absolute working directory) and ai: {provider: "codex" or "claude", sessionId: your actual CLI session UUID} so Desk Companion can resume this conversation after closing. For Codex, read CODEX_THREAD_ID from your tool environment. Omit ai if the actual ID is unknown; never guess. Keep reports concise.').catch((reason) => setClipboardError(errorMessage(reason))); }}>Copy instruction</button>
      </div>}
      {mouseReporting && <div id={`${panelId}-selection-hint`} className={styles.selectionHint} role="status">
        Hold <kbd>Shift</kbd> and drag to select text. Release Shift, then press <kbd>{TRANSLATE_SELECTION_SHORTCUT}</kbd> to translate.
      </div>}
      {clipboardError && <div className={styles.clipboardError} role="alert">{clipboardError}<button type="button" onClick={() => setClipboardError(null)} aria-label="Dismiss clipboard error">×</button></div>}
    </div>
  );
}

export function TerminalWorkspace({ theme, autoTranslate = false, onTranslateSelection }: {
  theme: AppTheme;
  autoTranslate?: boolean;
  onTranslateSelection?: (text: string) => Promise<void>;
}) {
  const idPrefix = useId().replace(/:/g, '');
  const nextTabId = useRef(2);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, generation: 0, name: 'Terminal 1' }]);
  const [activeId, setActiveId] = useState<number | null>(1);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameIdRef = useRef<number | null>(null);
  const draggedIdRef = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: number; side: 'before' | 'after' } | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<number | null>(null);
  const closeDialogRef = useRef<HTMLDialogElement>(null);
  const cancelCloseRef = useRef<HTMLButtonElement>(null);
  const pendingClose = tabs.find(tab => tab.id === pendingCloseId);
  const bridge = getBridge();

  useEffect(() => {
    function reopen(event: Event) {
      const request = (event as CustomEvent<ReopenTerminalRequest>).detail;
      event.preventDefault();
      const existing = tabs.find(tab => tab.sessionId === request.sessionId || tab.restore?.sessionId === request.sessionId);
      if (existing) {
        setActiveId(existing.id);
        setFocusId(existing.id);
        if (existing.live === false) {
          setTabs(current => current.map(tab => tab.id === existing.id ? { ...tab, live: undefined, restore: request, generation: tab.generation + 1 } : tab));
        } else if (existing.live) request.resolve();
        else request.reject(new Error('This terminal is still opening.'));
        return;
      }
      if (tabs.length >= 8) { request.reject(new Error('Close a terminal tab before opening another session (maximum 8).')); return; }
      const id = nextTabId.current++;
      setTabs(current => [...current, { id, generation: 0, name: request.name, restore: request }]);
      setActiveId(id);
      setFocusId(id);
    }
    window.addEventListener(REOPEN_TERMINAL_EVENT, reopen);
    return () => window.removeEventListener(REOPEN_TERMINAL_EVENT, reopen);
  }, [tabs]);

  useEffect(() => {
    const dialog = closeDialogRef.current;
    if (!dialog) return;
    if (pendingCloseId !== null) {
      if (!dialog.open) dialog.showModal();
      cancelCloseRef.current?.focus();
    } else if (dialog.open) dialog.close();
  }, [pendingCloseId]);

  function cancelClose() {
    const id = pendingCloseId;
    setPendingCloseId(null);
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-close-${id}`)?.focus());
  }

  function moveTab(sourceId: number, targetId: number, side: 'before' | 'after') {
    if (sourceId === targetId) return;
    setTabs(current => {
      const source = current.find(tab => tab.id === sourceId);
      if (!source || !current.some(tab => tab.id === targetId)) return current;
      const reordered = current.filter(tab => tab.id !== sourceId);
      const index = reordered.findIndex(tab => tab.id === targetId);
      reordered.splice(index + (side === 'after' ? 1 : 0), 0, source);
      return reordered;
    });
  }

  function tabDropSide(event: DragEvent<HTMLDivElement>): 'before' | 'after' {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left + box.width / 2 ? 'before' : 'after';
  }

  function endDrag() {
    draggedIdRef.current = null;
    setDropTarget(null);
  }

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
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, sessionId: undefined, live: undefined, restore: undefined, generation: tab.generation + 1 } : tab));
    setFocusId(id);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.nativeEvent.isComposing) return;
    if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey
      && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const source = tabs[index];
      const target = tabs[index + (event.key === 'ArrowLeft' ? -1 : 1)];
      if (target) moveTab(source.id, target.id, event.key === 'ArrowLeft' ? 'before' : 'after');
      requestAnimationFrame(() => document.getElementById(`${idPrefix}-tab-${source.id}`)?.focus());
      return;
    }
    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
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
        <div className={styles.tabScroller}
          onDragOver={event => {
            if (draggedIdRef.current === null) return;
            event.preventDefault();
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX < box.left + 28) event.currentTarget.scrollLeft -= 18;
            else if (event.clientX > box.right - 28) event.currentTarget.scrollLeft += 18;
          }}
          onDrop={event => {
            if (draggedIdRef.current === null) return;
            event.preventDefault();
            const last = tabs.at(-1);
            if (last) moveTab(draggedIdRef.current, last.id, 'after');
            endDrag();
          }}>
          {tabs.map((tab, index) => (
            <div className={styles.tabGroup} role="presentation" key={tab.id}
              data-drop-side={dropTarget?.id === tab.id ? dropTarget.side : undefined}
              onDragOver={event => {
                if (draggedIdRef.current === null || draggedIdRef.current === tab.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget({ id: tab.id, side: tabDropSide(event) });
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
              }}
              onDrop={event => {
                if (draggedIdRef.current === null) return;
                event.preventDefault();
                event.stopPropagation();
                moveTab(draggedIdRef.current, tab.id, tabDropSide(event));
                endDrag();
              }}>
              <button
                type="button"
                id={`${idPrefix}-tab-${tab.id}`}
                role="tab"
                aria-selected={activeId === tab.id}
                aria-controls={`${idPrefix}-panel-${tab.id}`}
                aria-label={tab.name}
                title={`${tab.name} — drag to reorder; double-click or press F2 to rename`}
                aria-describedby={`${idPrefix}-tab-help`}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                draggable={renaming === null}
                onDragStart={event => {
                  draggedIdRef.current = tab.id;
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-bachnv6-terminal-tab', String(tab.id));
                }}
                onDragEnd={endDrag}
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
              <button id={`${idPrefix}-close-${tab.id}`} type="button" className={styles.closeTab} aria-label={`Close ${tab.name}`} title={`Close ${tab.name}`} onClick={() => setPendingCloseId(tab.id)}><MorphIcon icon={X} size={13} reducedMotion="user" aria-hidden="true" /></button>
            </div>
          ))}
        </div>
        <button type="button" className={styles.addTab} aria-label="New terminal" title="New terminal" onClick={addTab}><MorphIcon icon={Plus} size={16} reducedMotion="user" aria-hidden="true" /></button>
      </div>
      <span id={`${idPrefix}-tab-help`} className={styles.visuallyHidden}>Drag to reorder tabs, or use Alt and the left or right arrow. Press F2 to rename.</span>
      <div className={styles.panes}>
        {tabs.length === 0 ? (
          <div className={styles.emptyState}><MorphIcon icon={TerminalIcon} size={22} reducedMotion="user" aria-hidden="true" /><p>No terminal sessions</p><button type="button" onClick={addTab}>Open a terminal</button></div>
        ) : tabs.map((tab) => (
          <TerminalPane
            theme={theme}
            key={`${tab.id}-${tab.generation}`}
            tab={tab}
            active={activeId === tab.id}
            shouldFocus={pendingCloseId === null && focusId === tab.id}
            bridge={bridge}
            tabId={`${idPrefix}-tab-${tab.id}`}
            panelId={`${idPrefix}-panel-${tab.id}`}
            onRestart={() => restartTab(tab.id)}
            onStarted={(sessionId) => setTabs(current => current.map(item => item.id === tab.id ? { ...item, sessionId, live: true } : item))}
            onStopped={() => setTabs(current => current.map(item => item.id === tab.id ? { ...item, live: false } : item))}
            autoTranslate={autoTranslate}
            onTranslateSelection={onTranslateSelection}
          />
        ))}
      </div>
      <dialog ref={closeDialogRef} className={styles.closeDialog} aria-labelledby={`${idPrefix}-close-title`}
        aria-describedby={`${idPrefix}-close-description`} onCancel={event => { event.preventDefault(); cancelClose(); }}>
        <h3 id={`${idPrefix}-close-title`}>Close {pendingClose?.name}?</h3>
        <p id={`${idPrefix}-close-description`}>This will stop the shell and any commands running in it. Its saved output and connected AI conversation can be opened again from Desk Companion → Sessions.</p>
        <div className={styles.dialogActions}>
          <button ref={cancelCloseRef} type="button" onClick={cancelClose}>Cancel</button>
          <button type="button" className={styles.confirmClose} onClick={() => {
            if (pendingCloseId !== null) closeTab(pendingCloseId);
            setPendingCloseId(null);
          }}>Close terminal</button>
        </div>
      </dialog>
    </div>
  );
}
