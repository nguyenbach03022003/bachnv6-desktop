/** A city returned by Open-Meteo geocoding, or a named coordinate selection. */
export interface WeatherLocation {
  id?: number;
  name: string;
  country: string;
  countryCode: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface CurrentWeather {
  /** Local time at the selected location, as returned by Open-Meteo. */
  time: string;
  temperatureC: number;
  apparentTemperatureC: number | null;
  relativeHumidityPercent: number | null;
  precipitationMm: number | null;
  weatherCode: number;
  windSpeedKmh: number | null;
  isDay: boolean;
}

export interface WeatherForecastDay {
  /** Calendar date at the selected location, YYYY-MM-DD. */
  date: string;
  maxTemperatureC: number;
  minTemperatureC: number;
  weatherCode: number;
  precipitationProbabilityPercent: number | null;
}

export interface WeatherSnapshot {
  status: 'live' | 'stale' | 'unavailable';
  location: WeatherLocation;
  current: CurrentWeather | null;
  /** Today plus the next two days in the selected location's timezone. */
  forecast: WeatherForecastDay[];
  /** UTC ISO timestamp for the last successful network update. */
  fetchedAt: string | null;
  /** UTC ISO timestamp when another network refresh can be attempted. */
  nextRefreshAt: string | null;
  /** Human-readable reason when status is stale or unavailable. */
  error: string | null;
  source: 'Open-Meteo';
}
