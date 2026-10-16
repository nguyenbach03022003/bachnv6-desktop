import type { NotesApi } from './notes-types';
import type { SystemMetricsSample } from './system-metrics-types';
import type { WeatherLocation, WeatherSnapshot } from './weather-types';
import type { CodexResetResult } from './codex-usage-types';
import type { AiUsageSnapshot } from './ai-usage-types';
import type { TranslationApi } from './translation-types';
import type { VocabularyApi } from './vocabulary-types';
import type { NotesWorkspaceApi } from './notes-workspace-types';
import type { CompanionApi } from './companion-types';
import type { AiSettingsApi } from './ai-settings-types';
import type { StartedTerminal, TerminalSessionsApi, TerminalStartOptions } from './terminal-types';

export interface WindowState {
  maximized: boolean;
  alwaysOnTop: boolean;
}

export interface DesktopApi {
  aiSettings: AiSettingsApi;
  minimize(): Promise<WindowState>;
  toggleMaximize(): Promise<WindowState>;
  toggleAlwaysOnTop(): Promise<WindowState>;
  close(): Promise<void>;
  getWindowState(): Promise<WindowState>;
  onWindowStateChanged(listener: (state: WindowState) => void): () => void;
  createTerminal(cols: number, rows: number, options?: TerminalStartOptions): Promise<StartedTerminal>;
  sessions: TerminalSessionsApi;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  closeTerminal(id: string): Promise<void>;
  onTerminalData(listener: (event: { id: string; data: string }) => void): () => void;
  onTerminalExit(listener: (event: { id: string; exitCode: number; signal: number | null }) => void): () => void;
  readTerminalClipboard(): Promise<string>;
  writeTerminalClipboard(text: string): Promise<void>;
  notes: NotesApi;
  companion: CompanionApi;
  notesWorkspace: NotesWorkspaceApi;
  vocabulary: VocabularyApi;
  metrics: {
    start(): Promise<SystemMetricsSample>;
    latest(): Promise<SystemMetricsSample>;
    stop(): Promise<void>;
    onUpdate(listener: (sample: SystemMetricsSample) => void): () => void;
  };
  weather: {
    get(): Promise<WeatherSnapshot>;
    refresh(): Promise<WeatherSnapshot>;
    search(query: string): Promise<WeatherLocation[]>;
    setLocation(location: WeatherLocation): Promise<WeatherSnapshot>;
  };
  usage: {
    get(): Promise<AiUsageSnapshot>;
    refresh(): Promise<AiUsageSnapshot>;
    useReset(creditId: string | null): Promise<CodexResetResult>;
  };
  translation: TranslationApi;
}

declare global {
  interface Window {
    dashboard?: DesktopApi;
  }
}
