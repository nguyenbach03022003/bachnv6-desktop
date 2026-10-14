export type AiProvider = 'codex' | 'claude';

export interface AiCliOptions {
  executable: string;
  model: string;
}

export interface AiSettings {
  provider: AiProvider;
  codex: AiCliOptions;
  claude: AiCliOptions;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'codex',
  codex: { executable: '', model: '' },
  claude: { executable: '', model: '' },
};

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { codex: 'Codex CLI', claude: 'Claude CLI' };

export interface AiCliCheck {
  ok: boolean;
  executable: string | null;
  version: string | null;
  error: string | null;
}

export interface AiSettingsApi {
  get(): Promise<AiSettings>;
  save(settings: AiSettings): Promise<AiSettings>;
  check(settings: AiSettings): Promise<AiCliCheck>;
  pickExecutable(): Promise<string | null>;
  onChanged(listener: (settings: AiSettings) => void): () => void;
}
