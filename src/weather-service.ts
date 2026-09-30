import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type {
  CurrentWeather,
  WeatherForecastDay,
  WeatherLocation,
  WeatherSnapshot,
} from './shared/weather-types';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_CACHE_MS = 20 * 60_000;
const MIN_REFRESH_MS = 60_000;
const SEARCH_CACHE_MS = 30 * 60_000;
const MIN_SEARCH_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_SEARCH_CACHE_ENTRIES = 50;

export const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  id: 1581130,
  name: 'Hanoi',
  country: 'Vietnam',
  countryCode: 'VN',
  latitude: 21.0245,
  longitude: 105.84117,
  timezone: 'Asia/Ho_Chi_Minh',
};

interface WeatherData {
  current: CurrentWeather;
  forecast: WeatherForecastDay[];
  fetchedAt: string;
}

interface WeatherFile {
  version: 1;
  location: WeatherLocation;
  cached: WeatherData | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optionalFiniteNumber(value: unknown): number | null {
  return finiteNumber(value) ? value : null;
}

function boundedString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${name}`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error(`Invalid ${name}`);
  }
  return trimmed;
}

function normalizeLocation(raw: unknown): WeatherLocation {
  if (!isRecord(raw)) throw new Error('Invalid weather location');
  const name = boundedString(raw.name, 'location name', 120);
  const country = boundedString(raw.country, 'country', 120);
  const countryCode = boundedString(raw.countryCode, 'country code', 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('Invalid country code');
  if (!finiteNumber(raw.latitude) || raw.latitude < -90 || raw.latitude > 90
    || !finiteNumber(raw.longitude) || raw.longitude < -180 || raw.longitude > 180) {
    throw new Error('Invalid weather coordinates');
  }
  const timezone = boundedString(raw.timezone, 'timezone', 80);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error('Invalid timezone');
  }
  const location: WeatherLocation = {
    name, country, countryCode,
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone,
  };
  if (raw.id !== undefined) {
    if (!Number.isSafeInteger(raw.id) || (raw.id as number) < 1) throw new Error('Invalid location identifier');
    location.id = raw.id as number;
  }
  if (raw.admin1 !== undefined && raw.admin1 !== null && raw.admin1 !== '') {
    location.admin1 = boundedString(raw.admin1, 'region', 120);
  }
  return location;
}

function numberArray(raw: unknown, count: number, name: string): number[] {
  if (!Array.isArray(raw) || raw.length < count || !raw.slice(0, count).every(finiteNumber)) {
    throw new Error(`Weather service returned invalid ${name}`);
  }
  return raw.slice(0, count);
}

function parseForecast(raw: unknown): WeatherData {
  if (!isRecord(raw) || !isRecord(raw.current) || !isRecord(raw.daily)) {
    throw new Error('Weather service returned unexpected data');
  }
  const current = raw.current;
  const daily = raw.daily;
  if (typeof current.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(current.time)
    || !finiteNumber(current.temperature_2m)
    || !Number.isInteger(current.weather_code)
    || (current.is_day !== 0 && current.is_day !== 1)) {
    throw new Error('Weather service returned invalid current conditions');
  }
  if (!Array.isArray(daily.time) || daily.time.length < 3
    || !daily.time.slice(0, 3).every((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error('Weather service returned invalid forecast dates');
  }
  const max = numberArray(daily.temperature_2m_max, 3, 'maximum temperatures');
  const min = numberArray(daily.temperature_2m_min, 3, 'minimum temperatures');
  const codes = numberArray(daily.weather_code, 3, 'weather codes');
  const probabilities = Array.isArray(daily.precipitation_probability_max)
    ? daily.precipitation_probability_max : [];
  const forecast: WeatherForecastDay[] = (daily.time as string[]).slice(0, 3).map((date, index) => ({
    date,
    maxTemperatureC: max[index],
    minTemperatureC: min[index],
    weatherCode: codes[index],
    precipitationProbabilityPercent: optionalFiniteNumber(probabilities[index]),
  }));
  return {
    current: {
      time: current.time,
      temperatureC: current.temperature_2m,
      apparentTemperatureC: optionalFiniteNumber(current.apparent_temperature),
      relativeHumidityPercent: optionalFiniteNumber(current.relative_humidity_2m),
      precipitationMm: optionalFiniteNumber(current.precipitation),
      weatherCode: current.weather_code as number,
      windSpeedKmh: optionalFiniteNumber(current.wind_speed_10m),
      isDay: current.is_day === 1,
    },
    forecast,
    fetchedAt: new Date().toISOString(),
  };
}

function parseStoredData(raw: unknown): WeatherData | null {
  if (!isRecord(raw) || !isRecord(raw.current) || !Array.isArray(raw.forecast)
    || raw.forecast.length !== 3 || typeof raw.fetchedAt !== 'string'
    || !Number.isFinite(Date.parse(raw.fetchedAt))) return null;
  const current = raw.current;
  if (typeof current.time !== 'string' || !finiteNumber(current.temperatureC)
    || !Number.isInteger(current.weatherCode) || typeof current.isDay !== 'boolean') return null;
  const optional = [current.apparentTemperatureC, current.relativeHumidityPercent,
    current.precipitationMm, current.windSpeedKmh];
  if (!optional.every((value) => value === null || finiteNumber(value))) return null;
  const forecast: WeatherForecastDay[] = [];
  for (const day of raw.forecast) {
    if (!isRecord(day) || typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
      || !finiteNumber(day.maxTemperatureC) || !finiteNumber(day.minTemperatureC)
      || !Number.isInteger(day.weatherCode)
      || (day.precipitationProbabilityPercent !== null && !finiteNumber(day.precipitationProbabilityPercent))) return null;
    forecast.push(day as unknown as WeatherForecastDay);
  }
  return { current: current as unknown as CurrentWeather, forecast, fetchedAt: raw.fetchedAt };
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'Weather request timed out';
    if (error.message.startsWith('Open-Meteo returned HTTP ')) return error.message;
    if (error.message.startsWith('Weather service returned ')) return error.message;
  }
  return 'Could not reach Open-Meteo';
}

function locationKey(location: WeatherLocation): string {
  return `${location.latitude},${location.longitude},${location.timezone}`;
}

function localDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function cacheIsFresh(file: WeatherFile): boolean {
  const data = file.cached;
  if (!data) return false;
  const age = Date.now() - Date.parse(data.fetchedAt);
  return age >= 0 && age < FORECAST_CACHE_MS && data.forecast[0]?.date === localDate(file.location.timezone);
}

/** Register main-process-only weather endpoints. Call once after app.whenReady(). */
export function registerWeatherIpc(getDashboardWindow: () => BrowserWindow | null): void {
  const weatherDir = path.join(app.getPath('userData'), 'weather');
  const weatherPath = path.join(weatherDir, 'weather.json');
  let state: WeatherFile | null = null;
  let operationTail: Promise<unknown> = Promise.resolve();
  let lastAttemptAt = 0;
  let lastError: string | null = null;
  let lastSearchAt = 0;
  let searchTail: Promise<unknown> = Promise.resolve();
  const searchCache = new Map<string, { expiresAt: number; results: WeatherLocation[] }>();

  function assertDashboardSender(event: IpcMainInvokeEvent): void {
    const window = getDashboardWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Unknown window');
    }
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation);
    operationTail = result.catch(() => undefined);
    return result;
  }

  async function load(): Promise<WeatherFile> {
    if (state) return state;
    try {
      const raw: unknown = JSON.parse(await fs.readFile(weatherPath, 'utf8'));
      if (isRecord(raw) && raw.version === 1) {
        state = {
          version: 1,
          location: normalizeLocation(raw.location),
          cached: parseStoredData(raw.cached),
        };
        return state;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Could not load saved weather', error);
      }
    }
    state = { version: 1, location: DEFAULT_WEATHER_LOCATION, cached: null };
    return state;
  }

  async function persist(next: WeatherFile): Promise<void> {
    await fs.mkdir(weatherDir, { recursive: true });
    const tempPath = path.join(weatherDir, `weather-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(tempPath, JSON.stringify(next), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(tempPath, weatherPath);
      state = next;
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  function snapshot(file: WeatherFile): WeatherSnapshot {
    const data = file.cached;
    const live = cacheIsFresh(file) && lastError === null;
    const nextRefresh = lastAttemptAt > 0 && Date.now() - lastAttemptAt < MIN_REFRESH_MS
      ? new Date(lastAttemptAt + MIN_REFRESH_MS).toISOString() : null;
    return {
      status: live ? 'live' : data ? 'stale' : 'unavailable',
      location: file.location,
      current: data?.current ?? null,
      forecast: data?.forecast ?? [],
      fetchedAt: data?.fetchedAt ?? null,
      nextRefreshAt: nextRefresh,
      error: lastError ?? (data && !live ? 'Forecast is due for an update' : data ? null : 'Weather has not loaded yet'),
      source: 'Open-Meteo',
    };
  }

  async function refresh(force: boolean): Promise<WeatherSnapshot> {
    const file = await load();
    if (!force && cacheIsFresh(file)) return snapshot(file);
    if (lastAttemptAt > 0 && Date.now() - lastAttemptAt < MIN_REFRESH_MS) return snapshot(file);
    lastAttemptAt = Date.now();

    const url = new URL(FORECAST_URL);
    url.searchParams.set('latitude', String(file.location.latitude));
    url.searchParams.set('longitude', String(file.location.longitude));
    url.searchParams.set('current', [
      'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
      'precipitation', 'weather_code', 'wind_speed_10m', 'is_day',
    ].join(','));
    url.searchParams.set('daily', [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min',
      'precipitation_probability_max',
    ].join(','));
    url.searchParams.set('temperature_unit', 'celsius');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('timezone', file.location.timezone);
    url.searchParams.set('forecast_days', '3');

    try {
      const data = parseForecast(await fetchJson(url));
      const next: WeatherFile = { ...file, cached: data };
      await persist(next);
      lastError = null;
      return snapshot(next);
    } catch (error) {
      lastError = readableError(error);
      return snapshot(file);
    }
  }

  async function search(query: string): Promise<WeatherLocation[]> {
    const key = query.toLocaleLowerCase('en');
    const cached = searchCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.results;

    const result = searchTail.then(async () => {
      const pause = Math.max(0, lastSearchAt + MIN_SEARCH_MS - Date.now());
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
      lastSearchAt = Date.now();
      const url = new URL(GEOCODING_URL);
      url.searchParams.set('name', query);
      url.searchParams.set('count', '8');
      url.searchParams.set('language', 'en');
      url.searchParams.set('format', 'json');
      const raw = await fetchJson(url);
      if (!isRecord(raw) || (raw.results !== undefined && !Array.isArray(raw.results))) {
        throw new Error('Weather service returned unexpected search data');
      }
      const results = (raw.results as unknown[] | undefined ?? []).flatMap((candidate) => {
        if (!isRecord(candidate)) return [];
        try {
          return [normalizeLocation({
            id: candidate.id,
            name: candidate.name,
            country: candidate.country,
            countryCode: candidate.country_code,
            admin1: candidate.admin1,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            timezone: candidate.timezone,
          })];
        } catch {
          return [];
        }
      });
      searchCache.set(key, { expiresAt: Date.now() + SEARCH_CACHE_MS, results });
      if (searchCache.size > MAX_SEARCH_CACHE_ENTRIES) {
        searchCache.delete(searchCache.keys().next().value as string);
      }
      return results;
    });
    searchTail = result.catch(() => undefined);
    return result;
  }

  ipcMain.handle('weather:get', (event) => {
    assertDashboardSender(event);
    return serialize(() => refresh(false));
  });
  ipcMain.handle('weather:refresh', (event) => {
    assertDashboardSender(event);
    return serialize(() => refresh(true));
  });
  ipcMain.handle('weather:search', (event, rawQuery: unknown) => {
    assertDashboardSender(event);
    if (typeof rawQuery !== 'string') throw new Error('Enter a city name');
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 100 || /[\u0000-\u001f\u007f]/u.test(query)) {
      throw new Error('Enter at least two city-name characters');
    }
    return search(query);
  });
  ipcMain.handle('weather:set-location', (event, rawLocation: unknown) => {
    assertDashboardSender(event);
    const location = normalizeLocation(rawLocation);
    return serialize(async () => {
      const file = await load();
      if (locationKey(file.location) === locationKey(location) && file.location.name === location.name) {
        return refresh(false);
      }
      const next: WeatherFile = { version: 1, location, cached: null };
      await persist(next);
      lastAttemptAt = 0;
      lastError = null;
      return refresh(true);
    });
  });
}
