import { useEffect, useRef, useState } from 'react';
import type { CompanionSnapshot, ReportStatus } from '../shared/companion-types';
import { MascotWidget } from './MascotWidget';
import { OPEN_TERMINAL_EVENT, REPORT_DRAFT_EVENT, type ReportDraft } from './companion-events';
import styles from './CompanionPanel.module.css';

const labels: Record<ReportStatus, string> = { working: 'Working', waiting: 'Waiting', completed: 'Completed', failed: 'Failed' };
const formatTime = (time: string) => new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function CompanionPanel({ className }: { className: string }) {
  const [snapshot, setSnapshot] = useState<CompanionSnapshot>({ messages: [], reports: [], busy: false, error: null });
  const [view, setView] = useState<'chat' | 'reports'>('chat');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [task, setTask] = useState('');
  const [reportStatus, setReportStatus] = useState<ReportStatus>('working');
  const [saving, setSaving] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bridge = window.dashboard?.companion;

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    let received = false;
    const unsubscribe = bridge.onUpdate((next) => { received = true; if (mounted) setSnapshot(next); });
    void bridge.get().then((next) => { if (mounted && !received) setSnapshot(next); })
      .catch((reason: unknown) => { if (mounted) setError(String(reason)); });
    return () => { mounted = false; unsubscribe(); };
  }, [bridge]);
  useEffect(() => {
    function beginReport(event: Event) {
      const next = (event as CustomEvent<ReportDraft>).detail;
      setDraft(next);
      setTask('Progress update');
      setReportStatus('working');
      setView('reports');
      setError(null);
    }
    window.addEventListener(REPORT_DRAFT_EVENT, beginReport);
    return () => window.removeEventListener(REPORT_DRAFT_EVENT, beginReport);
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [snapshot.messages.length, snapshot.reports.length, view]);
  useEffect(() => {
    if (draft) panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [draft?.sessionId]);

  async function send() {
    if (!bridge || !input.trim() || sending || clearing || snapshot.busy) return;
    const message = input.trim();
    setSending(true);
    setError(null);
    setInput('');
    try { await bridge.chat(message); }
    catch (reason) { setError(String(reason)); setInput(message); }
    finally { setSending(false); inputRef.current?.focus(); }
  }
  async function clearChat() {
    if (!bridge || sending || snapshot.busy || clearing || !snapshot.messages.length) return;
    setClearing(true);
    setError(null);
    try { await bridge.clearChat(); }
    catch (reason) { setError(String(reason)); }
    finally { setClearing(false); inputRef.current?.focus(); }
  }
  async function saveReport() {
    if (!draft || !bridge || saving) return;
    setSaving(true);
    setError(null);
    try {
      await bridge.saveReport({ ...draft, task: task.trim(), status: reportStatus });
      setDraft(null);
    } catch (reason) { setError(String(reason)); }
    finally { setSaving(false); }
  }
  const busy = sending || snapshot.busy;
  const latest = snapshot.reports.at(-1);
  return (
    <section ref={panelRef} className={`${className} ${styles.panel}`} aria-label="Desk companion">
      <div className={styles.content}>
        <header className={styles.heading}>
          <div className={styles.identity}>
            <div className={styles.avatar}><MascotWidget size={40} mode="overlay" /></div>
            <h2>Desk Companion</h2>
          </div>
          <div className={styles.tabs} role="group" aria-label="Companion view">
            <button type="button" aria-pressed={view === 'chat'} onClick={() => setView('chat')}>Chat</button>
            <button type="button" aria-pressed={view === 'reports'} onClick={() => setView('reports')}>Reports {snapshot.reports.length || ''}</button>
          </div>
        </header>
        {view === 'chat' ? <>
          <div className={styles.history} ref={listRef} role="log" aria-label="Fox conversation">
            {!snapshot.messages.length && <p className={styles.empty}>Hi, I’m your desk fox. Ask me about your work or save a terminal progress report.</p>}
            {snapshot.messages.map((message) => <div key={message.id} className={styles.message} data-role={message.role}>
              <small>{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Fox' : 'Notice'} · {formatTime(message.createdAt)}</small>
              <p>{message.text}</p>
            </div>)}
            {busy && <p className={styles.empty} role="status">Fox is thinking…</p>}
          </div>
          {latest && <button className={styles.latest} type="button" onClick={() => setView('reports')} title={latest.message}>
            {latest.source} · {labels[latest.status]} · {latest.task}
          </button>}
          <form className={styles.compose} onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <textarea ref={inputRef} aria-label="Message the fox" value={input} maxLength={4000} rows={1}
              placeholder="Message the fox…" disabled={!bridge || clearing}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            <div className={styles.composeActions}>
              <button type="button" aria-label="Clear chat" title="Delete the saved conversation" disabled={!bridge || busy || clearing || !snapshot.messages.length}
                onClick={() => { void clearChat(); }}>{clearing ? 'Clearing…' : 'Clear chat'}</button>
              {busy ? <button type="button" onClick={() => { void bridge?.cancel().catch((reason) => setError(String(reason))); }}>Stop</button>
                : <button type="submit" disabled={!bridge || clearing || !input.trim()}>Send</button>}
            </div>
          </form>
        </> : draft ? <form className={styles.reportForm} onSubmit={(event) => { event.preventDefault(); void saveReport(); }}>
          <div className={styles.reportFields}>
            <input aria-label="Report task" value={task} maxLength={160} placeholder="Task" required onChange={(event) => setTask(event.target.value)} />
            <select aria-label="Report status" value={reportStatus} onChange={(event) => setReportStatus(event.target.value as ReportStatus)}>
              {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <textarea aria-label="Progress report" value={draft.message} maxLength={8000} required placeholder="What has changed?" onChange={(event) => setDraft({ ...draft, message: event.target.value })} />
          <div className={styles.reportActions}><span>{draft.source}</span><button type="button" disabled={saving} onClick={() => setDraft(null)}>Cancel</button>
            <button type="submit" disabled={saving || !draft.message.trim() || !task.trim()}>{saving ? 'Saving…' : 'Save report'}</button></div>
        </form> : <div className={styles.history} ref={listRef} role="log" aria-label="Saved progress reports">
          {!snapshot.reports.length && <p className={styles.empty}>Use Save report in a terminal to leave an update here. Select output first to include it. Use Connect reports to let Claude or Codex publish updates.</p>}
          {snapshot.reports.map((report) => <article key={report.id} className={styles.report}>
            <div><strong>{report.source}</strong><span data-status={report.status}>{labels[report.status]}</span><small>{formatTime(report.createdAt)}</small></div>
            <h3>{report.task}</h3><p>{report.message}</p>
            <button type="button" onClick={() => {
              const unopened = window.dispatchEvent(new CustomEvent(OPEN_TERMINAL_EVENT, { detail: report.sessionId, cancelable: true }));
              setError(unopened ? 'This terminal has closed. Its report is still saved.' : null);
            }}>Open terminal</button>
          </article>)}
        </div>}
        {(error || snapshot.error) && <p className={styles.error} role="alert">{error || snapshot.error}</p>}
        {!bridge && <p className={styles.error}>Open the desktop app to chat and save reports.</p>}
      </div>
    </section>
  );
}
