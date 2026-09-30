import { app, ipcMain, net, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { MAX_TRANSLATION_LENGTH, type TranslationLanguage, type TranslationResult } from './shared/translation-types';

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const CACHE_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 50;

export function normalizeTranslationText(raw: unknown, allowEmpty = false): string {
  if (typeof raw !== 'string' || raw.length > MAX_TRANSLATION_LENGTH || raw.includes('\0')) {
    throw new Error(`Select or enter up to ${MAX_TRANSLATION_LENGTH.toLocaleString('en')} characters to translate.`);
  }
  const text = raw.trim();
  if (!allowEmpty && !text) throw new Error('Select or enter some text first.');
  return text;
}

function normalizeSourceLanguage(raw: unknown = 'en'): TranslationLanguage {
  if (raw !== 'en' && raw !== 'vi') throw new Error('Choose English or Vietnamese to translate.');
  return raw;
}

export function parseGoogleTranslation(raw: unknown): string {
  if (!Array.isArray(raw) || !Array.isArray(raw[0]) || !raw[0].length) {
    throw new Error('Google returned an unreadable translation. Try Open in Google.');
  }
  const segments = raw[0] as unknown[];
  if (!segments.every((segment) => Array.isArray(segment) && typeof segment[0] === 'string')) {
    throw new Error('Google returned an unreadable translation. Try Open in Google.');
  }
  const text = segments.map((segment) => (segment as string[])[0]).join('');
  if (!text.trim()) throw new Error('Google returned an empty translation.');
  return text;
}

/** Text stays in memory; only requested snippets are sent to Google. */
export function registerTranslationIpc(getWindow: () => BrowserWindow | null): void {
  const cache = new Map<string, { result: TranslationResult; expiresAt: number }>();
  const pending = new Map<string, Promise<TranslationResult>>();
  const controllers = new Set<AbortController>();

  function assertSender(event: IpcMainInvokeEvent): void {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unknown window');
  }

  async function translate(text: string, sourceLanguage: TranslationLanguage): Promise<TranslationResult> {
    const targetLanguage = sourceLanguage === 'en' ? 'vi' : 'en';
    const key = `${sourceLanguage}:${text}`;
    const saved = cache.get(key);
    if (saved && saved.expiresAt > Date.now()) return saved.result;
    const existing = pending.get(key);
    if (existing) return existing;
    if (pending.size >= 3) throw new Error('Translation is busy. Please try again in a moment.');

    const request = (async () => {
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        // This keyless Google Translate endpoint is undocumented. Keep a website
        // fallback in the UI; it can be throttled or changed by Google.
        const response = await net.fetch(TRANSLATE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client: 'gtx', sl: sourceLanguage, tl: targetLanguage, dt: 't', q: text }).toString(),
          signal: controller.signal,
          credentials: 'omit',
        });
        if (response.status === 429) throw new Error('Google is limiting translations. Try again later or Open in Google.');
        if (!response.ok) throw new Error(`Google Translate returned HTTP ${response.status}. Try Open in Google.`);
        const body = await response.text();
        if (body.length > 256 * 1024) throw new Error('Google returned an oversized translation.');
        let raw: unknown;
        try { raw = JSON.parse(body); }
        catch { throw new Error('Google returned an unreadable translation. Try Open in Google.'); }
        const result: TranslationResult = {
          sourceText: text, translatedText: parseGoogleTranslation(raw),
          sourceLanguage, targetLanguage, translatedAt: new Date().toISOString(),
        };
        cache.delete(key);
        cache.set(key, { result, expiresAt: Date.now() + CACHE_MS });
        if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        return result;
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Translation timed out. Check your connection and try again.');
        if (error instanceof TypeError) throw new Error('Could not reach Google Translate. Check your internet connection.');
        throw error;
      } finally {
        clearTimeout(timer);
        controllers.delete(controller);
      }
    })();
    pending.set(key, request);
    try { return await request; }
    finally { pending.delete(key); }
  }

  ipcMain.handle('translation:translate', (event, raw: unknown, rawLanguage: unknown) => {
    assertSender(event);
    return translate(normalizeTranslationText(raw), normalizeSourceLanguage(rawLanguage));
  });
  ipcMain.handle('translation:open-google', async (event, raw: unknown = '', rawLanguage: unknown) => {
    assertSender(event);
    const text = normalizeTranslationText(raw, true);
    const sourceLanguage = normalizeSourceLanguage(rawLanguage);
    const targetLanguage = sourceLanguage === 'en' ? 'vi' : 'en';
    const url = new URL('https://translate.google.com/');
    url.search = new URLSearchParams({ sl: sourceLanguage, tl: targetLanguage, text, op: 'translate' }).toString();
    await shell.openExternal(url.toString());
  });
  app.once('before-quit', () => { for (const controller of controllers) controller.abort(); });
}
