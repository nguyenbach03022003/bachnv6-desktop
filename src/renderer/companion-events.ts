export interface ReportDraft {
  sessionId: string;
  source: string;
  message: string;
}
export const REPORT_DRAFT_EVENT = 'desk-companion-report-draft';
export const OPEN_TERMINAL_EVENT = 'desk-companion-open-terminal';
export interface ReopenTerminalRequest {
  sessionId: string;
  name: string;
  resumeAi: boolean;
  resolve(): void;
  reject(reason: unknown): void;
}
export const REOPEN_TERMINAL_EVENT = 'desk-companion-reopen-terminal';

export function reopenTerminal(sessionId: string, name: string, resumeAi: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const unhandled = window.dispatchEvent(new CustomEvent<ReopenTerminalRequest>(REOPEN_TERMINAL_EVENT, {
      cancelable: true, detail: { sessionId, name, resumeAi, resolve, reject },
    }));
    if (unhandled) reject(new Error('The terminal workspace is unavailable.'));
  });
}
