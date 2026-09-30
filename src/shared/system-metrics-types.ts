/** Values are collected on the local computer by Electron's main process. */
export interface SystemMetricsSample {
  /** Unix time in milliseconds of the most recent CPU/memory sample. */
  sampledAt: number;
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  memoryPercent: number | null;
  /** Download and upload rates for the default external network interface. */
  networkDownloadBytesPerSecond: number | null;
  networkUploadBytesPerSecond: number | null;
  networkInterface: string | null;
  networkStatus: 'warming-up' | 'live' | 'unavailable';
  /** Optional sensor reading; null means the platform exposed no reliable value. */
  temperatureCelsius: number | null;
}
