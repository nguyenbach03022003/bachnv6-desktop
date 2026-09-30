import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import si from 'systeminformation';
import type { SystemMetricsSample } from './shared/system-metrics-types';

const SAMPLE_INTERVAL_MS = 1_000;
const TEMPERATURE_INTERVAL_MS = 30_000;

interface NetworkCounters {
  iface: string;
  received: number;
  sent: number;
  sampledAt: number;
}

function finiteNonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function percentage(value: unknown): number | null {
  const number = finiteNonnegative(value);
  return number === null ? null : Math.min(100, number);
}

function emptySample(): SystemMetricsSample {
  return {
    sampledAt: 0,
    cpuPercent: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    memoryPercent: null,
    networkDownloadBytesPerSecond: null,
    networkUploadBytesPerSecond: null,
    networkInterface: null,
    networkStatus: 'warming-up',
    temperatureCelsius: null,
  };
}

/**
 * Register the local system monitor IPC endpoints. The renderer starts/stops
 * sampling through its narrow preload bridge; collection also pauses while the
 * dashboard is hidden. Call once after Electron is ready.
 */
export function registerSystemMetricsIpc(getDashboardWindow: () => BrowserWindow | null): () => void {
  let sample = emptySample();
  let subscribed = false;
  let disposed = false;
  let timer: NodeJS.Timeout | null = null;
  let coreInFlight = false;
  let networkInFlight = false;
  let temperatureInFlight = false;
  let lastTemperatureAttempt = 0;
  let networkBaseline: NetworkCounters | null = null;
  let generation = 0;
  const trackedWindows = new WeakSet<BrowserWindow>();

  function assertDashboardSender(event: IpcMainInvokeEvent): BrowserWindow {
    const window = getDashboardWindow();
    if (disposed || !window || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unknown window');
    }
    return window;
  }

  function isSampling(currentGeneration: number): boolean {
    const window = getDashboardWindow();
    return !disposed && subscribed && currentGeneration === generation
      && Boolean(window && !window.isDestroyed() && window.isVisible() && !window.webContents.isDestroyed());
  }

  function emitUpdate(): void {
    const window = getDashboardWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && window.isVisible()) {
      window.webContents.send('metrics:update', { ...sample });
    }
  }

  function collectNetwork(currentGeneration: number): void {
    if (networkInFlight) return;
    networkInFlight = true;
    void si.networkStats().then((stats) => {
      if (!isSampling(currentGeneration)) return;
      const active = stats.find((stat) => stat.operstate === 'up') ?? stats[0];
      const received = finiteNonnegative(active?.rx_bytes);
      const sent = finiteNonnegative(active?.tx_bytes);
      const iface = active?.iface;
      if (!iface || received === null || sent === null) {
        networkBaseline = null;
        sample = {
          ...sample,
          networkDownloadBytesPerSecond: null,
          networkUploadBytesPerSecond: null,
          networkInterface: null,
          networkStatus: 'unavailable',
        };
        return;
      }

      const sampledAt = Date.now();
      const previous = networkBaseline;
      networkBaseline = { iface, received, sent, sampledAt };
      const elapsedSeconds = previous && previous.iface === iface
        ? (sampledAt - previous.sampledAt) / 1_000 : 0;
      if (!previous || elapsedSeconds <= 0 || received < previous.received || sent < previous.sent) {
        sample = {
          ...sample,
          networkDownloadBytesPerSecond: null,
          networkUploadBytesPerSecond: null,
          networkInterface: iface,
          networkStatus: 'warming-up',
        };
        return;
      }

      sample = {
        ...sample,
        networkDownloadBytesPerSecond: (received - previous.received) / elapsedSeconds,
        networkUploadBytesPerSecond: (sent - previous.sent) / elapsedSeconds,
        networkInterface: iface,
        networkStatus: 'live',
      };
    }).catch(() => {
      if (!isSampling(currentGeneration)) return;
      networkBaseline = null;
      sample = {
        ...sample,
        networkDownloadBytesPerSecond: null,
        networkUploadBytesPerSecond: null,
        networkStatus: 'unavailable',
      };
    }).finally(() => {
      networkInFlight = false;
    });
  }

  function collectTemperature(currentGeneration: number): void {
    if (temperatureInFlight || Date.now() - lastTemperatureAttempt < TEMPERATURE_INTERVAL_MS) return;
    temperatureInFlight = true;
    lastTemperatureAttempt = Date.now();
    void si.cpuTemperature().then((temperature) => {
      if (!isSampling(currentGeneration)) return;
      const celsius = finiteNonnegative(temperature.main);
      sample = { ...sample, temperatureCelsius: celsius && celsius > 0 ? celsius : null };
    }).catch(() => {
      if (isSampling(currentGeneration)) sample = { ...sample, temperatureCelsius: null };
    }).finally(() => {
      temperatureInFlight = false;
    });
  }

  function collectCore(currentGeneration: number): void {
    if (coreInFlight) return;
    coreInFlight = true;
    void Promise.allSettled([si.currentLoad(), si.mem()]).then(([cpuResult, memoryResult]) => {
      if (!isSampling(currentGeneration)) return;

      const cpuPercent = cpuResult.status === 'fulfilled'
        ? percentage(cpuResult.value.currentLoad) : null;
      let memoryTotalBytes: number | null = null;
      let memoryUsedBytes: number | null = null;
      let memoryPercent: number | null = null;
      if (memoryResult.status === 'fulfilled') {
        const memory = memoryResult.value;
        const total = finiteNonnegative(memory.total);
        // "available" excludes reclaimable caches on Linux, unlike "free".
        const available = finiteNonnegative(memory.available)
          ?? finiteNonnegative(memory.free);
        if (total !== null && total > 0 && available !== null) {
          memoryTotalBytes = total;
          memoryUsedBytes = Math.max(0, total - Math.min(total, available));
          memoryPercent = Math.min(100, (memoryUsedBytes / total) * 100);
        }
      }

      sample = {
        ...sample,
        sampledAt: Date.now(),
        cpuPercent,
        memoryUsedBytes,
        memoryTotalBytes,
        memoryPercent,
      };
      emitUpdate();
    }).finally(() => {
      coreInFlight = false;
    });
  }

  function tick(): void {
    const currentGeneration = generation;
    if (!isSampling(currentGeneration)) return;
    collectCore(currentGeneration);
    collectNetwork(currentGeneration);
    collectTemperature(currentGeneration);
  }

  function pause(): void {
    generation++;
    if (timer) clearInterval(timer);
    timer = null;
    networkBaseline = null;
    sample = {
      ...sample,
      networkDownloadBytesPerSecond: null,
      networkUploadBytesPerSecond: null,
      networkStatus: 'warming-up',
    };
  }

  function resume(): void {
    if (timer || !subscribed || disposed) return;
    const window = getDashboardWindow();
    if (!window || window.isDestroyed() || !window.isVisible()) return;
    tick();
    timer = setInterval(tick, SAMPLE_INTERVAL_MS);
  }

  function trackWindow(window: BrowserWindow): void {
    if (trackedWindows.has(window)) return;
    trackedWindows.add(window);
    window.on('show', resume);
    window.on('hide', pause);
    window.once('closed', () => {
      subscribed = false;
      pause();
    });
    window.webContents.once('destroyed', () => {
      subscribed = false;
      pause();
    });
  }

  ipcMain.handle('metrics:start', (event) => {
    const window = assertDashboardSender(event);
    trackWindow(window);
    subscribed = true;
    resume();
    return { ...sample };
  });

  ipcMain.handle('metrics:latest', (event) => {
    assertDashboardSender(event);
    return { ...sample };
  });

  ipcMain.handle('metrics:stop', (event) => {
    assertDashboardSender(event);
    subscribed = false;
    pause();
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    subscribed = false;
    pause();
    ipcMain.removeHandler('metrics:start');
    ipcMain.removeHandler('metrics:latest');
    ipcMain.removeHandler('metrics:stop');
    app.removeListener('before-quit', dispose);
  };
  app.on('before-quit', dispose);
  return dispose;
}
