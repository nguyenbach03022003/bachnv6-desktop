export interface ReportDraft {
  sessionId: string;
  source: string;
  message: string;
}
export const REPORT_DRAFT_EVENT = 'desk-companion-report-draft';
export const OPEN_TERMINAL_EVENT = 'desk-companion-open-terminal';
