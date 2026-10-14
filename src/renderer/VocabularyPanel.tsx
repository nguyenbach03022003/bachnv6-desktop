import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide';
import { MorphIcon } from 'morphicons/react';
import type { VocabularyCard } from '../shared/vocabulary-types';
import styles from './VocabularyPanel.module.css';

export function VocabularyPanel({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const api = window.dashboard?.vocabulary;
  const [cards, setCards] = useState<VocabularyCard[]>([]);
  const [input, setInput] = useState('');
  const [showCreator, setShowCreator] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'learn' | 'practice'>('learn');
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedIndex = Math.max(0, cards.findIndex((card) => card.id === selectedId));
  const card = cards[selectedIndex];

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!api) { setLoading(false); return; }
    let active = true;
    void api.list().then((loaded) => {
      if (!active) return;
      setCards(loaded);
      setSelectedId(loaded[0]?.id ?? null);
      setShowCreator(loaded.length === 0);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError('Could not load your flashcards.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api]);

  function choose(index: number): void {
    const next = cards[(index + cards.length) % cards.length];
    setSelectedId(next?.id ?? null);
    setRevealed(false);
    setAnswer('');
    setMessage(null);
  }

  function changeMode(next: 'learn' | 'practice'): void {
    setMode(next);
    setRevealed(false);
    setAnswer('');
    setMessage(null);
  }

  async function generate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!api || busy || !input.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await api.generate(input);
      if (created.length) {
        setCards((current) => [...current, ...created]);
        setSelectedId(created[0].id);
        setRevealed(false);
        setAnswer('');
        setInput('');
        setShowCreator(false);
        setMessage(`${created.length} flashcard${created.length === 1 ? '' : 's'} added.`);
      } else {
        setMessage('Those words are already in your cards.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create flashcards.');
    } finally { setBusy(false); }
  }

  async function review(remembered: boolean): Promise<void> {
    if (!api || !card || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.review(card.id, remembered);
      setCards((current) => current.map((item) => item.id === updated.id ? updated : item));
      choose(selectedIndex + 1);
      setMessage(remembered ? 'Remembered. Nice work!' : 'Marked for more practice.');
    } catch {
      setError('Could not save your practice result.');
    } finally { setBusy(false); }
  }

  async function remove(): Promise<void> {
    if (!api || !card || busy || !window.confirm(`Delete the flashcard for “${card.word}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.remove(card.id);
      const remaining = cards.filter((item) => item.id !== card.id);
      setCards(remaining);
      setSelectedId(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id ?? null);
      setRevealed(false);
      setAnswer('');
      setMessage('Flashcard deleted.');
    } catch {
      setError('Could not delete this flashcard.');
    } finally { setBusy(false); }
  }

  return (
    <div className={styles.space}>
      <div className={styles.heading}>
        <span><MorphIcon icon={BookOpen} size={16} reducedMotion="user" /> Learn vocabulary</span>
        <span className={styles.headingActions}>
          <span>{cards.length} {cards.length === 1 ? 'card' : 'cards'}</span>
          {cards.length > 0 && <button type="button" aria-expanded={showCreator}
            onClick={() => setShowCreator((current) => !current)}>
            {showCreator ? 'Done' : '+ Add words'}
          </button>}
        </span>
      </div>
      {showCreator && <form className={styles.creator} onSubmit={(event) => { void generate(event); }}>
        <label htmlFor="vocabulary-input">New words or phrases</label>
        <textarea id="vocabulary-input" value={input} maxLength={800} rows={2}
          placeholder="e.g. resilient, curious, take for granted"
          onChange={(event) => setInput(event.target.value)} disabled={busy || !api} />
        <div className={styles.creatorFoot}>
          <small>Separate up to 8 with commas or new lines.</small>
          <button type="submit" disabled={!api || busy || !input.trim()}>
            <MorphIcon icon={busy ? Sparkles : Plus} size={14} reducedMotion="user" />
            {busy ? 'Creating…' : 'Create with AI'}
          </button>
        </div>
      </form>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.message} role="status">{message}</p>}
      {loading ? <p className={styles.empty}>Loading flashcards…</p> : !api ? (
        <p className={styles.empty}>Vocabulary learning is available in the desktop app.</p>
      ) : cards.length === 0 ? (
        <div className={styles.empty}>Add a word to make your first flashcard. AI will add its meaning, Vietnamese translation, and an example.</div>
      ) : (
        <div className={styles.study}>
          <div className={styles.studyTabs} role="group" aria-label="Flashcard mode">
            <button type="button" aria-pressed={mode === 'learn'} onClick={() => changeMode('learn')}>Learn</button>
            <button type="button" aria-pressed={mode === 'practice'} onClick={() => changeMode('practice')}>Practice</button>
          </div>
          <div className={styles.card} aria-live="polite">
            <div className={styles.cardTop}>
              <span>Card {selectedIndex + 1} of {cards.length}</span>
              <button type="button" aria-label="Delete flashcard" title="Delete flashcard" disabled={busy}
                onClick={() => { void remove(); }}><MorphIcon icon={Trash2} size={14} reducedMotion="user" /></button>
            </div>
            <strong className={styles.word}>{card.word}</strong>
            {mode === 'practice' && !revealed && (
              <label className={styles.answer}>What does it mean?
                <input value={answer} onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Type your answer, then reveal" />
              </label>
            )}
            {revealed ? (
              <div className={styles.back}>
                {mode === 'practice' && answer.trim() && <p className={styles.yourAnswer}>Your answer: {answer}</p>}
                <p><span>Meaning</span>{card.meaning}</p>
                <p><span>Vietnamese</span>{card.translation}</p>
                <p className={styles.example}><span>Example</span>{card.example}</p>
              </div>
            ) : <button type="button" className={styles.reveal} onClick={() => setRevealed(true)}>
              {mode === 'practice' ? 'Check answer' : 'Reveal meaning & example'}
            </button>}
          </div>
          {mode === 'practice' && revealed ? (
            <div className={styles.practiceActions}>
              <button type="button" disabled={busy} onClick={() => { void review(false); }}>
                <MorphIcon icon={RotateCcw} size={13} reducedMotion="user" /> Again
              </button>
              <button type="button" disabled={busy} onClick={() => { void review(true); }}>
                <MorphIcon icon={Check} size={13} reducedMotion="user" /> Remembered
              </button>
            </div>
          ) : (
            <div className={styles.navigation}>
              <button type="button" aria-label="Previous flashcard" onClick={() => choose(selectedIndex - 1)}>
                <MorphIcon icon={ArrowLeft} size={15} reducedMotion="user" />
              </button>
              <span>{card.reviewCount ? `${card.rememberedCount}/${card.reviewCount} remembered` : 'Ready to practice'}</span>
              <button type="button" aria-label="Next flashcard" onClick={() => choose(selectedIndex + 1)}>
                <MorphIcon icon={ArrowRight} size={15} reducedMotion="user" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
