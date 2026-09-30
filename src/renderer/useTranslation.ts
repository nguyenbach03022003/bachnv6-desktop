import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_TRANSLATION_LENGTH, type TranslationLanguage, type TranslationResult } from '../shared/translation-types';

function initialSourceLanguage(): TranslationLanguage {
  try { return localStorage.getItem('translation-source-language') === 'vi' ? 'vi' : 'en'; }
  catch { return 'en'; }
}

function initialAutoTranslate(): boolean {
  try { return localStorage.getItem('translate-terminal-selections') !== 'false'; }
  catch { return true; }
}

export function useTranslation() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoTranslate, setAutoTranslate] = useState(initialAutoTranslate);
  const [sourceLanguage, setSourceLanguage] = useState(initialSourceLanguage);
  const targetLanguage = sourceLanguage === 'en' ? 'vi' : 'en';
  const requestId = useRef(0);

  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => {
    try { localStorage.setItem('translate-terminal-selections', String(autoTranslate)); }
    catch { /* Preference still works for this session. */ }
  }, [autoTranslate]);
  useEffect(() => {
    try { localStorage.setItem('translation-source-language', sourceLanguage); }
    catch { /* Direction still works for this session. */ }
  }, [sourceLanguage]);

  const editText = useCallback((value: string) => {
    requestId.current++;
    setText(value);
    setResult(null);
    setError(null);
    setLoading(false);
  }, []);

  const swapLanguages = useCallback(() => {
    requestId.current++;
    setSourceLanguage(sourceLanguage === 'en' ? 'vi' : 'en');
    if (result) setText(result.translatedText);
    setResult(null);
    setError(null);
    setLoading(false);
  }, [sourceLanguage, result]);

  const translate = useCallback(async (value: string) => {
    const id = ++requestId.current;
    setText(value);
    setResult(null);
    setError(null);
    if (!value.trim()) { setLoading(false); return; }
    if (value.length > MAX_TRANSLATION_LENGTH) {
      setError(`Select up to ${MAX_TRANSLATION_LENGTH.toLocaleString('en')} characters at a time.`);
      setLoading(false);
      return;
    }
    const bridge = window.dashboard?.translation;
    if (!bridge) { setError('Translation requires the desktop app.'); setLoading(false); return; }
    setLoading(true);
    try {
      const next = await bridge.translate(value, sourceLanguage);
      if (id === requestId.current) setResult(next);
    } catch (reason) {
      if (id === requestId.current) setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Translation failed.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [sourceLanguage]);

  return { text, editText, result, loading, error, autoTranslate, setAutoTranslate, translate, sourceLanguage, targetLanguage, swapLanguages };
}

export type TranslationController = ReturnType<typeof useTranslation>;
