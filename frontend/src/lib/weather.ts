import i18n from '@/i18n/i18n';

export interface WeatherData {
  temp: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDir: number;
  condition: string;
  icon: string;
  precipitation: number;
}

// Text keys are looked up via i18n so the condition shown matches the
// user's selected app language rather than always rendering in Russian
// (this value is displayed as-is in RoutePanel/SearchPanel).
const CONDITION_MAP: Record<number, { key: string; icon: string }> = {
  0:  { key: 'clear',             icon: '☀️' },
  1:  { key: 'mostlyClear',       icon: '🌤️' },
  2:  { key: 'partlyCloudy',      icon: '⛅' },
  3:  { key: 'overcast',          icon: '☁️' },
  45: { key: 'fog',               icon: '🌫️' },
  48: { key: 'rimeFog',           icon: '🌫️' },
  51: { key: 'drizzle',           icon: '🌦️' },
  53: { key: 'drizzle',           icon: '🌦️' },
  55: { key: 'drizzle',           icon: '🌦️' },
  56: { key: 'freezingDrizzle',   icon: '🌧️' },
  57: { key: 'freezingDrizzle',   icon: '🌧️' },
  61: { key: 'rain',              icon: '🌧️' },
  63: { key: 'rain',              icon: '🌧️' },
  65: { key: 'heavyRain',         icon: '🌧️' },
  66: { key: 'freezingRain',      icon: '🌧️' },
  67: { key: 'freezingRain',      icon: '🌧️' },
  71: { key: 'snow',              icon: '❄️' },
  73: { key: 'snow',              icon: '❄️' },
  75: { key: 'heavySnow',         icon: '❄️' },
  77: { key: 'snowGrains',        icon: '❄️' },
  80: { key: 'rainShowers',       icon: '🌧️' },
  81: { key: 'rainShowers',       icon: '🌧️' },
  82: { key: 'heavyRainShowers',  icon: '🌧️' },
  85: { key: 'snowShowers',       icon: '❄️' },
  86: { key: 'heavySnowShowers',  icon: '❄️' },
  95: { key: 'thunderstorm',      icon: '⛈️' },
  96: { key: 'thunderstormHail',  icon: '⛈️' },
  99: { key: 'thunderstormHail',  icon: '⛈️' },
};

export async function getWeather(lat: number, lng: number): Promise<WeatherData | null> {
  try {
    // wind_speed_unit=ms — Open-Meteo defaults to km/h, but every consumer
    // (SearchPanel/RoutePanel) labels and displays this value as m/s, so
    // without this the displayed wind speed was ~3.6x the real value.
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=ms&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const c = data.current;
    const cond = CONDITION_MAP[c.weather_code] || { key: 'unknown', icon: '❓' };
    return {
      temp: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      windDir: c.wind_direction_10m,
      condition: i18n.t(`weather.conditions.${cond.key}`),
      icon: cond.icon,
      precipitation: c.precipitation,
    };
  } catch {
    return null;
  }
}
