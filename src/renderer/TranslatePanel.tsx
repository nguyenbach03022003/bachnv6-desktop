import { useState } from 'react';
import { Arc } from 'loading-dev';
import { ArrowLeftRight, Languages } from 'lucide';
import { MorphIcon } from 'morphicons/react';
import { MAX_TRANSLATION_LENGTH } from '../shared/translation-types';
import type { TranslationController } from './useTranslation';
import styles from './TranslatePanel.module.css';
import { TRANSLATE_SELECTION_SHORTCUT } from './translation-shortcut';

export function TranslatePanel({ className, translation }: { className: string; translation: TranslationController }) {
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const { text, editText, result, loading, error, autoTranslate, setAutoTranslate, translate, sourceLanguage, targetLanguage, swapLanguages } = translation;
  const sourceLabel = sourceLanguage === 'en' ? 'English' : 'Tiếng Việt';
  const targetLabel = targetLanguage === 'en' ? 'English' : 'Tiếng Việt';
  const bridge = window.dashboard;

  async function copy() {
    if (!result) return;
    try { await bridge?.writeTerminalClipboard(result.translatedText); setActionStatus('Translation copied'); }
    catch { setActionStatus('Could not copy translation'); }
  }

  async function openGoogle() {
    try { await bridge?.translation.openGoogle(text, sourceLanguage); setActionStatus(null); }
    catch { setActionStatus('Could not open Google Translate'); }
  }

  return (
    <section className={`${className} ${styles.panel}`} aria-label={sourceLanguage === 'en' ? 'English to Vietnamese translation' : 'Vietnamese to English translation'}>
      <div className={styles.heading}>
        <div className={styles.title}><MorphIcon icon={Languages} size={17} reducedMotion="user" aria-hidden="true" /><h2>Google Translate</h2></div>
        <span className={styles.tag}>{sourceLanguage.toUpperCase()} → {targetLanguage.toUpperCase()}</span>
      </div>
      <div className={styles.languageRow} aria-label="Translation direction">
        <span>{sourceLabel}</span>
        <button type="button" className={styles.swapButton} aria-label="Swap languages" onClick={() => { swapLanguages(); setActionStatus(null); }}>
          <MorphIcon icon={ArrowLeftRight} size={14} reducedMotion="user" aria-hidden="true" />
        </button>
        <span>{targetLabel}</span>
      </div>
      <label className={styles.autoToggle}>
        <input type="checkbox" checked={autoTranslate} onChange={(event) => setAutoTranslate(event.target.checked)} />
        Translate terminal selections
      </label>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); setActionStatus(null); void translate(text); }}>
        <label htmlFor="translation-source">{sourceLabel}</label>
        <textarea id="translation-source" value={text} maxLength={MAX_TRANSLATION_LENGTH} spellCheck={false}
          placeholder={sourceLanguage === 'en' ? 'Type English or highlight terminal text…' : 'Nhập tiếng Việt hoặc chọn văn bản trong terminal…'} lang={sourceLanguage} rows={3}
          onChange={(event) => { editText(event.target.value); setActionStatus(null); }}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void translate(text); } }} />
        <div className={styles.actions}>
          <button className={styles.translateButton} type="submit" disabled={!bridge || !text.trim() || loading}>Translate</button>
          <button type="button" disabled={!bridge || text.length > MAX_TRANSLATION_LENGTH} onClick={() => { void openGoogle(); }}>Open in Google ↗</button>
        </div>
      </form>
      <div className={styles.outputHeading}><span>{targetLabel}</span><button type="button" disabled={!result} onClick={() => { void copy(); }}>Copy</button></div>
      <div className={styles.output} role="status" aria-live="polite" lang={targetLanguage} aria-busy={loading}>
        {loading ? <div className={styles.loading}><Arc size={15} /><span>{targetLanguage === 'vi' ? 'Đang dịch…' : 'Translating…'}</span></div>
          : result ? result.translatedText : <span className={styles.placeholder}>{targetLanguage === 'vi' ? 'Bản dịch sẽ hiện ở đây.' : 'Translation will appear here.'}</span>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {actionStatus && <p className={styles.actionStatus} role="status">{actionStatus}</p>}
      <p className={styles.footnote}>Highlight terminal text → {TRANSLATE_SELECTION_SHORTCUT}. In Codex, hold Shift while dragging to select. Text is sent to Google.</p>
    </section>
  );
}
