import { useEffect, useState } from 'react';
import type { NotesWorkspaceState } from '../shared/notes-workspace-types';
import { NotesPanel } from './NotesPanel';
import styles from './NotesWorkspace.module.css';

export function NotesWorkspace({ detached = false }: { detached?: boolean }) {
  const api = window.dashboard?.notesWorkspace;
  const [state, setState] = useState<NotesWorkspaceState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = api.onStateChanged((next) => {
      receivedUpdate = true;
      if (active) setState(next);
    });
    void api.getState().then((next) => {
      if (active && !receivedUpdate) setState(next);
    }).catch(() => {
      if (active) setError('Could not load the notes workspace.');
    });
    return () => { active = false; unsubscribe(); };
  }, [api]);

  if (!api) return <NotesPanel />;
  if (!state) return <section className={styles.placeholder} aria-label="Notes workspace">
    <p role="status">{error ?? 'Loading notes workspace…'}</p>
  </section>;

  if (!detached && state.detached) return <section className={styles.placeholder} aria-label="Detached notes">
    <h2>Notes are in a separate window</h2>
    <p>Read and edit your notes with more room.</p>
    <button type="button" onClick={() => {
      void api.focus().catch(() => setError('Could not focus the notes window.'));
    }}>Open notes window</button>
    <button type="button" aria-label="Merge notes into dashboard" onClick={() => {
      void api.merge().catch(() => setError('Could not merge the notes window.'));
    }}>Merge back</button>
    {error && <p role="alert">{error}</p>}
  </section>;

  return <NotesPanel initialSelectedId={state.selectedId} detached={detached} />;
}

export function NotesWindow() {
  useEffect(() => {
    document.title = 'Notes — Bachnv6 Desktop';
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'desktop-theme') document.documentElement.dataset.theme = event.newValue === 'dark' ? 'dark' : 'light';
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return <main className={styles.detachedShell} aria-label="Separate notes window"><NotesWorkspace detached /></main>;
}
