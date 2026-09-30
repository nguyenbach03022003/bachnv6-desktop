export const MAX_TRANSLATION_LENGTH = 5_000;

export type TranslationLanguage = 'en' | 'vi';

export interface TranslationResult {
  sourceText: string;
  translatedText: string;
  sourceLanguage: TranslationLanguage;
  targetLanguage: TranslationLanguage;
  translatedAt: string;
}

export interface TranslationApi {
  translate(text: string, sourceLanguage?: TranslationLanguage): Promise<TranslationResult>;
  openGoogle(text?: string, sourceLanguage?: TranslationLanguage): Promise<void>;
}
