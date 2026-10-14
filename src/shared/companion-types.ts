export type ReportStatus = 'working' | 'waiting' | 'completed' | 'failed';

export interface ProgressReport {
  id: string;
  sessionId: string;
  source: string;
  task: string;
  message: string;
  status: ReportStatus;
  createdAt: string;
}

export interface CompanionMessage {
  id: string;
  role: 'user' | 'assistant' | 'notice';
  text: string;
  createdAt: string;
}

export interface CompanionSnapshot {
  messages: CompanionMessage[];
  reports: ProgressReport[];
  busy: boolean;
  error: string | null;
}

export interface CompanionApi {
  get(): Promise<CompanionSnapshot>;
  chat(text: string): Promise<void>;
  cancel(): Promise<void>;
  clearChat(): Promise<void>;
  saveReport(report: { sessionId: string; source: string; task: string; message: string; status: ReportStatus }): Promise<void>;
  labelTerminal(id: string, name: string): Promise<void>;
  onUpdate(listener: (snapshot: CompanionSnapshot) => void): () => void;
}
