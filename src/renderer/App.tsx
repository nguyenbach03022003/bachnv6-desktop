import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun,
  Cpu, LayoutGrid, MemoryStick, Minus, Moon, Pin, PinOff, RefreshCw, Search,
  Sparkles, Square, Sun, Wifi, X, type IconNode,
} from 'lucide';
import { MorphIcon } from 'morphicons/react';
import type { CodexUsageSnapshot } from '../shared/codex-usage-types';
import type { SystemMetricsSample } from '../shared/system-metrics-types';
import type { WeatherLocation, WeatherSnapshot } from '../shared/weather-types';
import { TranslatePanel } from './TranslatePanel';
import { useTranslation } from './useTranslation';
import { MascotWidget } from './MascotWidget';
import { NotesPanel } from './NotesPanel';
import { TerminalWorkspace } from './TerminalWorkspace';
import styles from './App.module.css';
import { applyTheme, readTheme, type AppTheme } from './theme';

type IconName =
  | 'cloud' | 'cloudDrizzle' | 'cloudFog' | 'cloudLightning' | 'cloudRain'
  | 'cloudSnow' | 'cloudSun' | 'cpu' | 'grid' | 'memory' | 'minus'
  | 'network' | 'refresh' | 'search' | 'sparkle' | 'sun' | 'window' | 'x';

const iconNodes: Record<IconName, IconNode> = {
  cloud: Cloud, cloudDrizzle: CloudDrizzle, cloudFog: CloudFog,
  cloudLightning: CloudLightning, cloudRain: CloudRain, cloudSnow: CloudSnow,
  cloudSun: CloudSun, cpu: Cpu, grid: LayoutGrid, memory: MemoryStick,
  minus: Minus, network: Wifi, refresh: RefreshCw, search: Search,
  sparkle: Sparkles, sun: Sun, window: Square, x: X,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <MorphIcon icon={iconNodes[name]} size={size} strokeWidth={1.8} reducedMotion="user" aria-hidden="true" />;
}

function PanelTitle({ icon, title, tag, children }: { icon: IconName; title: string; tag: string; children?: ReactNode }) {
  return (
    <div className={styles.panelTitle}>
      <div className={styles.panelTitleText}><Icon name={icon} size={17} /><h2>{title}</h2></div>
      <div className={styles.panelTitleActions}>{children}<span className={styles.statusTag}>{tag}</span></div>
    </div>
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The service could not be reached.';
}

function formatRate(value: number | null): { amount: string; unit: string } {
  if (value === null) return { amount: '—', unit: '' };
  if (value >= 1024 ** 2) return { amount: (value / 1024 ** 2).toFixed(1), unit: 'MB/s' };
  if (value >= 1024) return { amount: (value / 1024).toFixed(1), unit: 'KB/s' };
  return { amount: Math.round(value).toString(), unit: 'B/s' };
}

type MetricCardData = {
  label: string;
  icon: IconName;
  value: string;
  unit: string;
  detail: string;
  values: (number | null)[];
  max: number;
  tone: 'lime' | 'blue' | 'purple';
  tag: string;
};

function MetricCard({ card }: { card: MetricCardData }) {
  return (
    <article className={`${styles.panel} ${styles.metricCard} ${styles[`tone${card.tone}`]}`}>
      <div className={styles.metricTop}>
        <div className={styles.metricLabel}><Icon name={card.icon} size={17} /><span>{card.label}</span></div>
        <span className={styles.statusTag}>{card.tag}</span>
      </div>
      <div className={styles.metricValue}>{card.value}<span>{card.unit}</span></div>
      <div className={styles.metricBottom}>
        <span title={card.detail}>{card.detail}</span>
        <div className={styles.microBars} aria-hidden="true">
          {card.values.map((value, index) => (
            <span key={index} style={{ height: `${value === null ? 5 : Math.max(5, Math.min(100, value / card.max * 100))}%`, opacity: value === null ? 0.2 : undefined }} />
          ))}
        </div>
      </div>
    </article>
  );
}

function SystemMetrics() {
  const [sample, setSample] = useState<SystemMetricsSample | null>(null);
  const [history, setHistory] = useState<SystemMetricsSample[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.dashboard?.metrics;
    if (!bridge) { setError('System metrics require the desktop app.'); return; }
    let mounted = true;
    const record = (next: SystemMetricsSample) => {
      if (!mounted || next.sampledAt <= 0) return;
      setSample(next);
      setHistory((previous) => [...previous.slice(-23), next]);
      setError(null);
    };
    const unsubscribe = bridge.onUpdate(record);
    void bridge.start().then(record).catch((reason: unknown) => {
      if (mounted) setError(errorText(reason));
    });
    return () => {
      mounted = false;
      unsubscribe();
      void bridge.stop().catch(() => undefined);
    };
  }, []);

  const tag = error ? 'Unavailable' : sample ? 'Live' : 'Connecting';
  const download = formatRate(sample?.networkDownloadBytesPerSecond ?? null);
  const upload = formatRate(sample?.networkUploadBytesPerSecond ?? null);
  const networkValues = history.map((entry) => entry.networkDownloadBytesPerSecond);
  const networkMax = Math.max(1024, ...networkValues.filter((value): value is number => value !== null));
  const cards: MetricCardData[] = [
    {
      label: 'CPU', icon: 'cpu',
      value: sample?.cpuPercent === null || sample?.cpuPercent === undefined ? '—' : sample.cpuPercent.toFixed(1),
      unit: sample?.cpuPercent === null || sample?.cpuPercent === undefined ? '' : '%',
      detail: error ?? (sample?.cpuPercent === null || sample?.cpuPercent === undefined ? 'CPU unavailable'
        : sample.temperatureCelsius === null ? 'Temperature unavailable'
          : `${sample.temperatureCelsius.toFixed(0)}°C CPU temperature`),
      values: history.map((entry) => entry.cpuPercent), max: 100, tone: 'lime',
      tag: sample && sample.cpuPercent === null && !error ? 'Unavailable' : tag,
    },
    {
      label: 'Memory', icon: 'memory',
      value: sample?.memoryUsedBytes === null || sample?.memoryUsedBytes === undefined
        ? '—' : (sample.memoryUsedBytes / 1024 ** 3).toFixed(1),
      unit: sample?.memoryTotalBytes === null || sample?.memoryTotalBytes === undefined
        ? '' : `/ ${(sample.memoryTotalBytes / 1024 ** 3).toFixed(1)} GB`,
      detail: error ?? (sample?.memoryPercent === null || sample?.memoryPercent === undefined
        ? 'Memory unavailable' : `${sample.memoryPercent.toFixed(0)}% in use`),
      values: history.map((entry) => entry.memoryPercent), max: 100, tone: 'blue',
      tag: sample && sample.memoryUsedBytes === null && !error ? 'Unavailable' : tag,
    },
    {
      label: 'Network', icon: 'network', value: download.amount, unit: download.unit,
      detail: error ?? (!sample ? 'Waiting for network sample' : sample.networkStatus === 'warming-up' ? 'Measuring network rate…'
        : sample?.networkStatus === 'unavailable' ? 'Network rate unavailable'
          : `↑ ${upload.amount} ${upload.unit}${sample?.networkInterface ? ` · ${sample.networkInterface}` : ''}`),
      values: networkValues, max: networkMax, tone: 'purple',
      tag: sample?.networkStatus === 'warming-up' && !error ? 'Measuring'
        : sample?.networkStatus === 'unavailable' && !error ? 'Unavailable' : tag,
    },
  ];
  return (
    <section className={styles.metrics} aria-label="Live system metrics and desk companion">
      <article className={`${styles.panel} ${styles.mascotTile}`} aria-label="Desk companion"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          event.currentTarget.querySelector('button')?.click();
        }}>
        <MascotWidget size={78} />
      </article>
      {cards.map((card) => <MetricCard card={card} key={card.label} />)}
    </section>
  );
}

function weatherCondition(code: number, isDay = true): { label: string; icon: IconName } {
  if (code === 0) return { label: 'Clear sky', icon: isDay ? 'sun' : 'cloud' };
  if (code <= 2) return { label: 'Partly cloudy', icon: 'cloudSun' };
  if (code === 3) return { label: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'cloudFog' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'cloudDrizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', icon: 'cloudRain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: 'cloudSnow' };
  if (code >= 95) return { label: 'Thunderstorm', icon: 'cloudLightning' };
  return { label: 'Conditions unavailable', icon: 'cloud' };
}

function formatUpdated(value: string | number | null) {
  if (value === null) return 'No update yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Update time unavailable'
    : `Updated ${date.toLocaleString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function WeatherPanel() {
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<WeatherLocation[]>([]);

  useEffect(() => {
    const bridge = window.dashboard?.weather;
    if (!bridge) { setRequestError('Weather requires the desktop app.'); setLoading(false); return; }
    let mounted = true;
    void bridge.get().then((next) => {
      if (mounted) { setSnapshot(next); setRequestError(null); }
    }).catch((reason: unknown) => {
      if (mounted) setRequestError(errorText(reason));
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const bridge = window.dashboard?.weather;
    if (!bridge) return;
    let mounted = true;
    const update = () => {
      if (document.visibilityState !== 'visible') return;
      void bridge.get().then((next) => {
        if (mounted) { setSnapshot(next); setRequestError(null); }
      }).catch((reason: unknown) => {
        if (mounted) setRequestError(errorText(reason));
      });
    };
    const timer = window.setInterval(update, 20 * 60 * 1000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => { mounted = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); };
  }, []);

  async function refresh() {
    const bridge = window.dashboard?.weather;
    if (!bridge || loading) return;
    setLoading(true);
    try { setSnapshot(await bridge.refresh()); setRequestError(null); }
    catch (reason) { setRequestError(errorText(reason)); }
    finally { setLoading(false); }
  }

  async function searchCity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const bridge = window.dashboard?.weather;
    if (!bridge) return;
    if (query.trim().length < 2) { setSearchError('Enter at least two characters.'); return; }
    setSearching(true);
    setSearchError(null);
    try {
      const matches = await bridge.search(query.trim());
      setResults(matches);
      if (matches.length === 0) setSearchError('No matching cities found.');
    } catch (reason) {
      setResults([]);
      setSearchError(errorText(reason));
    } finally { setSearching(false); }
  }

  async function selectCity(location: WeatherLocation) {
    const bridge = window.dashboard?.weather;
    if (!bridge) return;
    setLoading(true);
    setSearchError(null);
    try {
      setSnapshot(await bridge.setLocation(location));
      setRequestError(null);
      setSearchOpen(false);
      setResults([]);
      setQuery('');
    } catch (reason) { setSearchError(errorText(reason)); }
    finally { setLoading(false); }
  }

  const condition = snapshot?.current ? weatherCondition(snapshot.current.weatherCode, snapshot.current.isDay) : null;
  const status = loading && !snapshot ? 'Loading' : requestError ? (snapshot?.current ? 'Cached' : 'Unavailable') : snapshot?.status === 'live' ? 'Live'
    : snapshot?.status === 'stale' ? 'Cached' : 'Unavailable';
  const weatherMessage = requestError ?? snapshot?.error;
  return (
    <section className={`${styles.panel} ${styles.weatherPanel}`} aria-label="Weather">
      <PanelTitle icon="cloudSun" title="Weather" tag={status}>
        <button className={styles.iconButton} type="button" aria-label="Change weather city" title="Change city" aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}><Icon name="search" size={13} /></button>
        <button className={styles.iconButton} type="button" aria-label="Refresh weather" title="Refresh weather" disabled={loading} onClick={() => { void refresh(); }}><Icon name="refresh" size={13} /></button>
      </PanelTitle>
      {searchOpen && (
        <div className={styles.weatherSearchPopover}>
          <form className={styles.weatherSearchForm} onSubmit={(event) => { void searchCity(event); }}>
            <input aria-label="Search city" autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setSearchError(null); }} placeholder="Search city" />
            <button type="submit" disabled={searching}>{searching ? '…' : 'Find'}</button>
          </form>
          {searchError && <p className={styles.searchMessage} role="status">{searchError}</p>}
          <div className={styles.weatherSearchResults}>
            {results.map((result) => (
              <button type="button" key={`${result.id ?? result.name}-${result.latitude}-${result.longitude}`} onClick={() => { void selectCity(result); }} disabled={loading}>
                <strong>{result.name}</strong><span>{[result.admin1, result.country].filter(Boolean).join(', ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={styles.weatherLocation}>
        <span>{snapshot?.location.name ?? 'Ha Noi'}, {snapshot?.location.countryCode ?? 'VN'}</span>
        <small>{snapshot?.location.admin1 || snapshot?.location.country || 'Viet Nam'}</small>
      </div>
      <div className={styles.weatherNow}>
        <div className={styles.weatherTemperature}>{snapshot?.current ? Math.round(snapshot.current.temperatureC) : '—'}<span>°C</span></div>
        <div className={styles.weatherIllustration}><Icon name={condition?.icon ?? 'cloudSun'} size={51} /></div>
      </div>
      <div className={styles.weatherDescription}>
        {condition?.label ?? (loading ? 'Loading conditions…' : 'Conditions unavailable')}
        {snapshot?.current?.apparentTemperatureC !== null && snapshot?.current?.apparentTemperatureC !== undefined &&
          <span> · Feels {Math.round(snapshot.current.apparentTemperatureC)}°</span>}
      </div>
      <div className={styles.weatherForecast} aria-label="Three day forecast">
        {snapshot?.forecast.length ? snapshot.forecast.map((day, index) => (
          <div key={day.date}>
            <span>{index === 0 ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T12:00:00Z`))}</span>
            <Icon name={weatherCondition(day.weatherCode).icon} size={18} />
            <strong>{Math.round(day.maxTemperatureC)}° <small>{Math.round(day.minTemperatureC)}°</small></strong>
          </div>
        )) : <p className={styles.forecastEmpty}>Forecast unavailable</p>}
      </div>
      <p className={styles.panelFootnote} title={weatherMessage ?? undefined}>
        {weatherMessage ? `${snapshot?.current ? 'Cached forecast' : 'Weather unavailable'} · ${weatherMessage}` : `Open-Meteo · ${formatUpdated(snapshot?.fetchedAt ?? null)}`}
      </p>
    </section>
  );
}

function formatReset(unixSeconds: number | null) {
  if (unixSeconds === null) return 'Reset time unavailable';
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return 'Reset time unavailable';
  return `Resets ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function formatCreditAmount(balance: string | null): string | null {
  if (!balance) return null;
  if (!/^\d+(?:\.\d+)?$/.test(balance)) return balance;
  const [whole, decimal] = balance.split('.');
  const fraction = decimal?.replace(/0+$/, '');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(fraction ?? '').padEnd(2, '0')}`;
}

function CodexUsagePanel() {
  const [snapshot, setSnapshot] = useState<CodexUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [selectedReset, setSelectedReset] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.dashboard?.usage;
    if (!bridge) { setRequestError('Codex usage requires the desktop app.'); setLoading(false); return; }
    let mounted = true;
    void bridge.get().then((next) => {
      if (mounted) { setSnapshot(next); setRequestError(null); }
    }).catch((reason: unknown) => {
      if (mounted) setRequestError(errorText(reason));
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const bridge = window.dashboard?.usage;
    if (!bridge) return;
    let mounted = true;
    const update = () => {
      if (document.visibilityState !== 'visible') return;
      void bridge.get().then((next) => {
        if (mounted) { setSnapshot(next); setRequestError(null); }
      }).catch((reason: unknown) => {
        if (mounted) setRequestError(errorText(reason));
      });
    };
    const timer = window.setInterval(update, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => { mounted = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); };
  }, []);

  async function refresh() {
    const bridge = window.dashboard?.usage;
    if (!bridge || loading) return;
    setLoading(true);
    try { setSnapshot(await bridge.refresh()); setRequestError(null); setConfirmReset(false); }
    catch (reason) { setRequestError(errorText(reason)); }
    finally { setLoading(false); }
  }

  async function useReset() {
    const bridge = window.dashboard?.usage;
    if (!bridge || redeeming || !confirmReset) return;
    setRedeeming(true);
    setResetMessage(null);
    try {
      const { snapshot: next, outcome } = await bridge.useReset(selectedReset || null);
      setSnapshot(next);
      setRequestError(null);
      setSelectedReset('');
      setConfirmReset(false);
      setResetMessage({
        reset: 'One reset was used. Usage and reset bank are updated.',
        alreadyRedeemed: 'This reset was already used. Usage and reset bank are updated.',
        nothingToReset: 'There is no eligible usage window to reset.',
        noCredit: 'No earned reset is available.',
      }[outcome]);
    } catch (reason) {
      setConfirmReset(false);
      setResetMessage(`${errorText(reason)} Refresh usage before trying again.`);
    } finally { setRedeeming(false); }
  }

  const status = loading && !snapshot ? 'Loading' : requestError ? (snapshot?.windows.length ? 'Cached' : 'Unavailable') : snapshot?.status === 'live' ? 'Live'
    : snapshot?.status === 'stale' ? 'Cached' : 'Unavailable';
  const windows = snapshot?.windows ?? [];
  const message = requestError ?? snapshot?.error;
  const creditBalance = snapshot?.creditBalance;
  const creditAmount = creditBalance?.unlimited ? 'Unlimited'
    : formatCreditAmount(creditBalance?.balance ?? null)
    ?? (creditBalance?.hasCredits === false ? 'None' : 'Not reported');
  const resetBank = snapshot?.resetBank?.availableCount;
  const resetChoices = snapshot?.resetBank?.credits ?? [];
  const selectedResetTitle = resetChoices.find((credit) => credit.id === selectedReset)?.title || 'the next available reset';
  return (
    <section className={`${styles.panel} ${styles.aiPanel}`} aria-label="Codex CLI usage">
      <PanelTitle icon="sparkle" title="AI usage" tag={status}>
        <button className={styles.iconButton} type="button" aria-label="Refresh Codex usage" title="Refresh Codex usage" disabled={loading} onClick={() => { void refresh(); }}><Icon name="refresh" size={13} /></button>
      </PanelTitle>
      <p className={styles.aiIntro}>Codex CLI{snapshot?.planType ? ` · ${snapshot.planType} plan` : ''}</p>
      <div className={styles.aiBalances} aria-label="Codex credits and reset bank">
        <div className={styles.aiBalance}>
          <span>Credits remaining</span>
          <strong title={creditBalance?.balance ?? creditAmount}>{creditAmount}</strong>
        </div>
        <div className={styles.aiBalance}>
          <span title="Earned rate-limit reset credits">Reset bank</span>
          <strong>{resetBank === undefined ? 'Not reported' : `${resetBank.toLocaleString()} available`}</strong>
        </div>
      </div>
      {resetBank !== undefined && resetBank > 0 && (
        <div className={styles.aiResetControl}>
          <label htmlFor="codex-reset-choice">Use an earned reset</label>
          <div className={styles.aiResetRow}>
            <select id="codex-reset-choice" value={resetChoices.some((credit) => credit.id === selectedReset) ? selectedReset : ''}
              disabled={redeeming} onChange={(event) => { setSelectedReset(event.target.value); setConfirmReset(false); setResetMessage(null); }}>
              <option value="">Next available reset</option>
              {resetChoices.map((credit, index) => (
                <option key={credit.id} value={credit.id} title={credit.description ?? undefined}>
                  {credit.title || `Reset ${index + 1}`}{credit.expiresAt ? ` · expires ${new Date(credit.expiresAt * 1000).toLocaleDateString()}` : ''}
                </option>
              ))}
            </select>
            {!confirmReset && <button type="button" disabled={loading || redeeming || snapshot?.status !== 'live'}
              onClick={() => { setConfirmReset(true); setResetMessage(null); }}>Use reset</button>}
          </div>
          {confirmReset && <div className={styles.aiResetConfirm}>
            <span>Spend {selectedResetTitle} now?</span>
            <button type="button" disabled={redeeming} onClick={() => { void useReset(); }}>Confirm</button>
            <button type="button" disabled={redeeming} onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>}
        </div>
      )}
      {resetMessage && <p className={styles.aiResetMessage} role="status">{resetMessage}</p>}
      {windows.length > 0 ? (
        <div className={styles.usageList}>
          {windows.map((item) => {
            const used = Math.max(0, Math.min(100, item.usedPercent));
            return (
              <div className={styles.usageItem} key={`${item.limitId}-${item.windowDurationMins ?? item.label}`}>
                <div className={styles.usageLabels}><span>{item.label}</span><strong>{Math.round(used)}% used</strong></div>
                <div className={styles.usageTrack} role="img" aria-label={`${item.label}: ${Math.round(used)} percent used`}><span className={styles.usagelime} style={{ width: `${used}%` }} /></div>
                <small className={styles.usageReset}>{formatReset(item.resetsAt)}</small>
              </div>
            );
          })}
        </div>
      ) : <p className={styles.aiEmpty}>{loading ? 'Reading Codex usage…' : message ?? 'No usage windows are available from Codex CLI.'}</p>}
      <div className={styles.aiNotice}><span className={styles.noticeIcon}>i</span><span>{message && windows.length > 0 ? `Showing cached usage · ${message}` : `Reported by your local Codex CLI · ${formatUpdated(snapshot?.fetchedAt ?? null)}`}</span></div>
    </section>
  );
}

export default function App() {
  const translation = useTranslation();
  const [theme, setTheme] = useState<AppTheme>(readTheme);
  const [isPinned, setIsPinned] = useState<boolean | null>(null);
  const windowControls = window.dashboard;

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    setTheme(next);
  }

  useEffect(() => {
    const bridge = window.dashboard;
    if (!bridge) return;
    let mounted = true;
    void bridge.getWindowState().then((state) => {
      if (mounted) setIsPinned(state.alwaysOnTop);
    }).catch(() => {
      if (mounted) setIsPinned(null);
    });
    const unsubscribe = bridge.onWindowStateChanged((state) => {
      if (mounted) setIsPinned(state.alwaysOnTop);
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  async function togglePin() {
    if (!windowControls || isPinned === null) return;
    try {
      const state = await windowControls.toggleAlwaysOnTop();
      setIsPinned(state.alwaysOnTop);
    } catch {
      setIsPinned(null);
    }
  }

  return (
    <div className={styles.appShell}>
      <header className={styles.titleBar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true"><Icon name="grid" size={20} /></span>
          <div className={styles.brandName}><strong>BACHNV6</strong><span>DESKTOP</span></div>
        </div>
        <div className={styles.headerDivider} aria-hidden="true" />
        <div className={styles.pageTitle}><span>Workspace</span><span className={styles.slash}>/</span><strong>Overview</strong></div>
        <div className={styles.headerSpacer} />
        <span className={styles.previewPill}><span aria-hidden="true" />Local dashboard</span>
        <button type="button" className={styles.themeButton} onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
          <MorphIcon icon={theme === 'light' ? Sun : Moon} size={15} reducedMotion="user" aria-hidden="true" />
          <span>{theme === 'light' ? 'Light' : 'Dark'}</span>
        </button>
        <button
          type="button"
          className={styles.pinButton}
          aria-label={isPinned ? 'Unpin window from top' : 'Pin window on top'}
          aria-pressed={isPinned === true}
          title={isPinned ? 'Unpin window from top' : 'Pin window on top'}
          disabled={!windowControls || isPinned === null}
          onClick={() => { void togglePin(); }}
        >
          <MorphIcon icon={isPinned ? PinOff : Pin} size={15} reducedMotion="user" />
          <span>{isPinned ? 'Pinned' : 'Pin window'}</span>
        </button>
        <div className={styles.windowControls} aria-label="Window controls">
          <button type="button" aria-label="Minimize window" title="Minimize window" disabled={!windowControls?.minimize} onClick={() => windowControls?.minimize?.()}><Icon name="minus" size={17} /></button>
          <button type="button" aria-label="Toggle maximize window" title="Toggle maximize window" disabled={!windowControls?.toggleMaximize} onClick={() => windowControls?.toggleMaximize()}><Icon name="window" size={16} /></button>
          <button type="button" aria-label="Close window" title="Close window" disabled={!windowControls?.close} onClick={() => windowControls?.close?.()}><Icon name="x" size={17} /></button>
        </div>
      </header>
      <main className={styles.dashboard}>
        <aside className={styles.leftColumn} aria-label="Weather and translation">
          <WeatherPanel />
          <TranslatePanel className={`${styles.panel} ${styles.translationPanel}`} translation={translation} />
        </aside>
        <div className={styles.centerColumn}>
          <SystemMetrics />
          <section className={`${styles.panel} ${styles.terminalPanel}`} aria-label="Terminal workspace">
            <TerminalWorkspace theme={theme} autoTranslate={translation.autoTranslate} onTranslateSelection={translation.translate} />
          </section>
        </div>
        <aside className={styles.rightColumn} aria-label="AI usage, notes, and vocabulary">
          <CodexUsagePanel />
          <NotesPanel />
        </aside>
      </main>
      <footer className={styles.footer}>
        <span>Bachnv6 Desktop <span aria-hidden="true">·</span> Workspace</span>
        <span>System · Open-Meteo · Google Translate · Codex CLI</span>
        <span>Windows + Linux</span>
      </footer>
    </div>
  );
}
