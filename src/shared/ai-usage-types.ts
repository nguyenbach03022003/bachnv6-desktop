import type { AiProvider } from './ai-settings-types';
import type { CodexUsageSnapshot } from './codex-usage-types';

export interface AiUsageSnapshot extends CodexUsageSnapshot {
  provider: AiProvider;
}
