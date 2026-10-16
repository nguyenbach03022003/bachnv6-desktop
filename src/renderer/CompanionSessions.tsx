import { useEffect, useRef, useState } from 'react';
import type { TerminalHistory, TerminalSessionsSnapshot } from '../shared/terminal-types';
import { reopenTerminal } from './companion-events';
import styles from './CompanionPanel.module.css';

const time = (value: string) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function CompanionSessions() {
  const bridge = window.dashboard?.sessions;
  const [snapshot, setSnapshot] = useState<TerminalSessionsSnapshot>({ sessions: [], error: null });
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<TerminalHistory | null>(null);
  const [provider, setProvider] = useState<'codex' | 'claude'>('codex');
  const [nativeId, setNativeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const readSequence = useRef(0);

  useEffect(() => {
    if (!bridge) return;
    let mounted = true, received = false;
    const unsubscribe = bridge.onUpdate(next => { received = true; if (mounted) setSnapshot(next); });
    void bridge.list().then(next => { if (mounted && !received) setSnapshot(next); }).catch(reason => { if (mounted) setError(String(reason)); });
    return () => { mounted = false; unsubscribe(); readSequence.current++; };
  }, [bridge]);
  useEffect(() => {
    if (history && !dialog.current?.open) dialog.current?.showModal();
    if (!history && dialog.current?.open) dialog.current?.close();
  }, [history]);

  async function act(id: string, action: () => Promise<void>) {
    if (pending) return;
    setPending(id); setError(null);
    try { await action(); } catch (reason) { setError(String(reason)); }
    finally { setPending(null); }
  }
  async function showHistory(id: string) {
    const sequence = ++readSequence.current;
    await act(id, async () => {
      const next = await bridge!.read(id);
      if (sequence !== readSequence.current) return;
      setHistory(next); setProvider(next.session.ai?.provider ?? 'codex'); setNativeId(next.session.ai?.sessionId ?? ''); setDeleting(false);
    });
  }
  const selected = snapshot.sessions.find(session => session.id === history?.session.id) ?? history?.session;
  const filtered = snapshot.sessions.filter(session => `${session.name} ${session.cwd} ${session.ai?.provider ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <input className={styles.sessionSearch} aria-label="Search sessions" placeholder="Search sessions…" value={query} onChange={event => setQuery(event.target.value)} />
    <div className={styles.history} aria-label="Saved terminal sessions">
      {!filtered.length && <p className={styles.empty}>{query ? 'No matching sessions.' : 'Terminal sessions and their output are saved here automatically.'}</p>}
      {filtered.map(session => <article key={session.id} className={styles.report} data-session-id={session.id}>
        <div><strong>{session.name}</strong><span data-status={session.status}>{session.status === 'running' ? 'Running' : session.status === 'exited' ? `Exited (${session.exitCode})` : 'Closed'}</span></div>
        <small>{time(session.updatedAt)}{session.ai ? ` · ${session.ai.provider === 'codex' ? 'Codex' : 'Claude'}` : ''}</small>
        <p className={styles.sessionCwd} title={session.cwd}>{session.cwd}</p>
        <div className={styles.sessionActions}>
          <button type="button" disabled={!!pending} onClick={() => { void act(session.id, async () => {
            await reopenTerminal(session.id, session.name, !!session.ai);
          }); }}>{pending === session.id ? 'Opening…' : session.status === 'running' ? 'Open terminal' : session.ai ? `Resume ${session.ai.provider === 'codex' ? 'Codex' : 'Claude'}` : 'Reopen terminal'}</button>
          <button type="button" disabled={!!pending} onClick={() => { void showHistory(session.id); }}>History &amp; connection</button>
        </div>
      </article>)}
    </div>
    {(error || snapshot.error) && !history && <p className={styles.error} role="alert">{error || snapshot.error}</p>}
    <dialog ref={dialog} className={styles.sessionDialog} aria-label="Session history" onCancel={event => { event.preventDefault(); if (!pending) setHistory(null); }}>
      {history && selected && <>
        <div className={styles.sessionDialogHeading}><h3>{selected.name}</h3><button type="button" disabled={!!pending} aria-label="Close session history" onClick={() => setHistory(null)}>Close</button></div>
        <p className={styles.empty}>{selected.cwd} · {selected.shell}</p>
        <p className={styles.empty}>Saved terminal output{selected.truncated ? ' (older output trimmed; latest 512K characters kept)' : ''}. Reopening starts a new shell; a connected CLI restores its own conversation.</p>
        <pre className={styles.transcript} aria-label="Saved terminal output">{history.output || 'No terminal output saved yet.'}</pre>
        <form className={styles.connectionForm} onSubmit={event => { event.preventDefault(); void act(selected.id, async () => {
          await bridge!.connect(selected.id, nativeId.trim() ? { provider, sessionId: nativeId.trim() } : null);
          setHistory(await bridge!.read(selected.id));
        }); }}>
          <label>AI conversation<select aria-label="Session AI provider" value={provider} onChange={event => setProvider(event.target.value as typeof provider)}>
            <option value="codex">Codex CLI</option><option value="claude">Claude CLI</option>
          </select></label>
          <label>Session ID<input aria-label="AI session ID" value={nativeId} maxLength={36} placeholder="CLI session UUID" onChange={event => setNativeId(event.target.value)} /></label>
          <button type="submit" disabled={!!pending}>Save connection</button>
        </form>
        <p className={styles.empty}>Use the session ID from the CLI’s resume command, or include it in Connect reports. Clear the ID to disconnect. Resume requires the CLI’s local conversation files.</p>
        <div className={styles.sessionActions}>
          <button type="button" disabled={!!pending || selected.status === 'running'} onClick={() => { void act(selected.id, async () => { await reopenTerminal(selected.id, selected.name, false); setHistory(null); }); }}>Reopen shell only</button>
          <button type="button" disabled={!!pending} onClick={() => { void act(selected.id, async () => { await window.dashboard!.writeTerminalClipboard(history.output); }); }}>Copy output</button>
          <button type="button" disabled={!!pending || selected.status === 'running'} onClick={() => setDeleting(true)}>Delete saved session</button>
        </div>
        {deleting && <div className={styles.deleteSession}>
          <span>Delete this saved output and connection?</span>
          <button type="button" disabled={!!pending} onClick={() => setDeleting(false)}>Cancel</button>
          <button type="button" disabled={!!pending} onClick={() => { void act(selected.id, async () => { await bridge!.remove(selected.id); setHistory(null); }); }}>Delete history</button>
        </div>}
        {(error || snapshot.error) && <p className={styles.error} role="alert">{error || snapshot.error}</p>}
      </>}
    </dialog>
  </>;
}
