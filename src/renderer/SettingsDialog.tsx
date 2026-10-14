import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AI_PROVIDER_LABELS, DEFAULT_AI_SETTINGS, type AiCliCheck, type AiProvider, type AiSettings } from '../shared/ai-settings-types';
import styles from './SettingsDialog.module.css';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'check' | 'pick' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<AiCliCheck | null>(null);
  const bridge = window.dashboard?.aiSettings;
  const label = AI_PROVIDER_LABELS[draft.provider];

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let mounted = true;
    if (!bridge) { setLoading(false); setError('Settings require the desktop app.'); }
    else void bridge.get().then(next => { if (mounted) setDraft(next); })
      .catch((reason: unknown) => { if (mounted) setError(String(reason)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; element?.close(); };
  }, [bridge]);

  function change(next: AiSettings) { setDraft(next); setCheck(null); setError(null); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!bridge || busy || loading) return;
    setBusy('save'); setError(null);
    try { await bridge.save(draft); onClose(); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(null); }
  }
  async function checkCli() {
    if (!bridge || busy || loading) return;
    setBusy('check'); setCheck(null); setError(null);
    try { setCheck(await bridge.check(draft)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(null); }
  }
  async function browse() {
    if (!bridge || busy || loading) return;
    setBusy('pick'); setError(null);
    try {
      const executable = await bridge.pickExecutable();
      if (executable) change({ ...draft, [draft.provider]: { ...draft[draft.provider], executable } });
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(null); }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="settings-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => { void save(event); }}>
      <header className={styles.heading}><div><h2 id="settings-title">App settings</h2><p>Choose the CLI for fox chat and vocabulary.</p></div>
        <button type="button" aria-label="Close settings" disabled={!!busy} onClick={onClose}>×</button></header>
      <fieldset disabled={loading || !!busy || !bridge}>
        <label htmlFor="ai-provider">AI provider</label>
        <select id="ai-provider" value={draft.provider} onChange={event => change({ ...draft, provider: event.target.value as AiProvider })}>
          <option value="codex">Codex CLI</option><option value="claude">Claude CLI</option>
        </select>
        <label htmlFor="ai-executable">{label} executable <span>(optional)</span></label>
        <div className={styles.pathRow}><input id="ai-executable" value={draft[draft.provider].executable}
          placeholder={`Auto-detect ${draft.provider}`} maxLength={4096} spellCheck={false}
          onChange={event => change({ ...draft, [draft.provider]: { ...draft[draft.provider], executable: event.target.value } })} />
          <button type="button" onClick={() => { void browse(); }}>Browse…</button></div>
        <p className={styles.hint}>Leave blank to search this machine. Or choose an absolute executable path on Windows or Linux.</p>
        <label htmlFor="ai-model">Model <span>(optional)</span></label>
        <input id="ai-model" value={draft[draft.provider].model} maxLength={160} spellCheck={false} placeholder="Use the default model"
          onChange={event => change({ ...draft, [draft.provider]: { ...draft[draft.provider], model: event.target.value } })} />
        <p className={styles.hint}>{draft.provider === 'codex'
          ? 'Blank uses the Codex default for chat and gpt-6-luna for flashcards. An override applies to both.'
          : 'Blank uses the Claude default. An override applies to both chat and flashcards.'}</p>
      </fieldset>
      <div className={styles.connection}>
        <button type="button" disabled={loading || !!busy || !bridge} onClick={() => { void checkCli(); }}>{busy === 'check' ? 'Checking…' : 'Check CLI'}</button>
        <p>Checks installation and version without sending an AI request. Sign in separately in a terminal with <code>{draft.provider === 'codex' ? 'codex login' : 'claude auth login'}</code>.</p>
      </div>
      {loading && <p role="status">Loading settings…</p>}
      {check && <div className={styles.check} role={check.ok ? 'status' : 'alert'} data-ok={check.ok}>
        <strong>{check.ok ? `${label} detected · ${check.version}` : check.error}</strong>
        {check.executable && <code>{check.executable}</code>}
      </div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.notice}>{draft.provider === 'claude' ? 'Usage reporting and earned resets are available only for Codex. ' : ''}Settings are saved on this machine. New AI requests use the selected CLI; running requests keep their current provider. Terminal shells remain under your control.</p>
      <footer className={styles.actions}><button type="button" disabled={!!busy} onClick={onClose}>Cancel</button>
        <button className={styles.primary} type="submit" disabled={loading || !!busy || !bridge}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button></footer>
    </form>
  </dialog>;
}
