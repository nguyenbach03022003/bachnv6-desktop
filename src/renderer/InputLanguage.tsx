import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { attach, loadModule, type FieldHandle } from '@viettelex/core';
import styles from './InputLanguage.module.css';

type InputLanguage = 'en' | 'vi';
const storageKey = 'desktop-input-language';
const Context = createContext<{ language: InputLanguage; ready: boolean; toggle(): void }>({ language: 'en', ready: false, toggle() {} });
const readLanguage = (): InputLanguage => {
  try { return localStorage.getItem(storageKey) === 'vi' ? 'vi' : 'en'; } catch { return 'en'; }
};

export function InputLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<InputLanguage>(readLanguage);
  const [ready, setReady] = useState(false);
  const languageRef = useRef(language);
  languageRef.current = language;
  const fieldsRef = useRef(new Map<HTMLElement, FieldHandle>());

  useEffect(() => {
    document.documentElement.dataset.inputLanguage = language;
    try { localStorage.setItem(storageKey, language); } catch { /* Session mode still works. */ }
    for (const handle of fieldsRef.current.values()) handle.setEnabled(language === 'vi');
  }, [language]);

  useEffect(() => {
    let active = true;
    const pending = new Set<HTMLElement>();
    const fields = fieldsRef.current;
    let observer: MutationObserver | undefined;
    function scan() {
      for (const [element, handle] of fields) {
        if (!element.isConnected) { handle(); fields.delete(element); }
      }
      for (const element of document.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"]')) {
        if (fields.has(element) || pending.has(element) || element.closest('.xterm')
          || element instanceof HTMLTextAreaElement && element.readOnly
          || element instanceof HTMLInputElement && (element.readOnly || !['text', 'search', ''].includes(element.type))) continue;
        pending.add(element);
        const enabled = languageRef.current === 'vi';
        void attach(element, { enabled, inputMethod: 'telex', modernTone: true, toggleKey: null }).then(handle => {
          pending.delete(element);
          if (!active || !element.isConnected) { handle(); return; }
          fields.set(element, handle);
          if (enabled !== (languageRef.current === 'vi')) handle.setEnabled(languageRef.current === 'vi');
        }).catch(reason => console.error('Could not attach Vietnamese typing', reason));
      }
    }
    void loadModule().then(() => {
      if (!active) return;
      scan();
      setReady(true);
      observer = new MutationObserver(records => {
        if (records.some(record => record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof HTMLElement))) scan();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
    }).catch(reason => console.error('Could not load Vietnamese typing', reason));
    return () => { active = false; observer?.disconnect(); for (const handle of fields.values()) handle(); fields.clear(); };
  }, []);

  useEffect(() => {
    let armed = false;
    function keyDown(event: KeyboardEvent) {
      if (event.repeat) return;
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
        && (event.key === 'Control' || event.key === 'Shift')) armed = true;
      else if (!['Control', 'Shift'].includes(event.key)) armed = false;
    }
    function keyUp(event: KeyboardEvent) {
      if (armed && (event.key === 'Control' || event.key === 'Shift')) {
        armed = false;
        if (!ready) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setLanguage(current => current === 'en' ? 'vi' : 'en');
      }
    }
    const blur = () => { armed = false; };
    function limitField(event: Event) {
      const field = event.target;
      if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
        && field.maxLength >= 0 && field.selectionStart !== null && field.value.length > field.maxLength) {
        field.setRangeText('', field.maxLength, field.value.length, 'end');
      }
    }
    const storage = (event: StorageEvent) => { if (event.key === storageKey) setLanguage(readLanguage()); };
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('blur', blur);
    window.addEventListener('storage', storage);
    document.addEventListener('input', limitField, true);
    return () => {
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('storage', storage);
      document.removeEventListener('input', limitField, true);
    };
  }, [ready]);

  return <Context.Provider value={{ language, ready, toggle: () => setLanguage(current => current === 'en' ? 'vi' : 'en') }}>{children}</Context.Provider>;
}

export const useInputLanguage = () => useContext(Context);

export function InputLanguageButton() {
  const { language, ready, toggle } = useInputLanguage();
  return <button type="button" className={styles.button} disabled={!ready} onMouseDown={event => event.preventDefault()}
    onClick={toggle} aria-pressed={language === 'vi'} aria-keyshortcuts="Control+Shift"
    aria-label={`Switch typing to ${language === 'en' ? 'Vietnamese' : 'English'} (Ctrl+Shift)`}
    title={`Typing: ${language === 'vi' ? 'Vietnamese Telex' : 'English'} · Ctrl+Shift`}>{language === 'vi' ? 'VI' : 'EN'}</button>;
}
