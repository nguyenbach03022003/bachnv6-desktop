export interface VocabularyCard {
  id: string;
  word: string;
  meaning: string;
  translation: string;
  example: string;
  createdAt: string;
  reviewCount: number;
  rememberedCount: number;
}

export interface VocabularyApi {
  list(): Promise<VocabularyCard[]>;
  generate(input: string): Promise<VocabularyCard[]>;
  review(id: string, remembered: boolean): Promise<VocabularyCard>;
  remove(id: string): Promise<void>;
}
