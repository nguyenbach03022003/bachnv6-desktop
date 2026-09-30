export interface CodexUsageWindow {
  limitId: string;
  label: string;
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexCreditBalance {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface CodexResetBank {
  availableCount: number;
  credits: CodexResetCredit[];
}

export interface CodexResetCredit {
  id: string;
  title: string | null;
  description: string | null;
  expiresAt: number | null;
}

export type CodexResetOutcome = 'reset' | 'alreadyRedeemed' | 'nothingToReset' | 'noCredit';

export interface CodexResetResult {
  snapshot: CodexUsageSnapshot;
  outcome: CodexResetOutcome;
}

export interface CodexUsageSnapshot {
  status: 'live' | 'stale' | 'unavailable';
  planType: string | null;
  windows: CodexUsageWindow[];
  creditBalance: CodexCreditBalance | null;
  resetBank: CodexResetBank | null;
  fetchedAt: number | null;
  error: string | null;
  nextRefreshAt: number | null;
}
