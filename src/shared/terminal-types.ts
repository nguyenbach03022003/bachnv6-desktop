export interface AiSessionLink {
  provider: 'codex' | 'claude';
  sessionId: string;
}

export interface SavedTerminalSession {
  id: string;
  name: string;
  shell: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'closed' | 'exited';
  exitCode: number | null;
  ai: AiSessionLink | null;
  outputChars: number;
  truncated: boolean;
}

export interface TerminalHistory {
  session: SavedTerminalSession;
  output: string;
}

export interface TerminalSessionsSnapshot {
  sessions: SavedTerminalSession[];
  error: string | null;
}

export interface TerminalStartOptions {
  sessionId?: string;
  name?: string;
  resumeAi?: boolean;
}

export interface StartedTerminal {
  id: string;
  shell: string;
  cwd: string;
  reportFile?: string;
}

export interface TerminalSessionsApi {
  list(): Promise<TerminalSessionsSnapshot>;
  read(id: string): Promise<TerminalHistory>;
  connect(id: string, ai: AiSessionLink | null): Promise<void>;
  remove(id: string): Promise<void>;
  onUpdate(listener: (snapshot: TerminalSessionsSnapshot) => void): () => void;
}
