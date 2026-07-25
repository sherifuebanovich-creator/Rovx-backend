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

const CONDITION_MAP: Record<number, { text: string; icon: string }> = {
  0:  { text: 'Ясно',           icon: '☀️' },
  1:  { text: 'Преимущественно ясно', icon: '🌤️' },
  2:  { text: 'Переменная облачность', icon: '⛅' },
  3:  { text: 'Пасмурно',       icon: '☁️' },
  45: { text: 'Туман',          icon: '🌫️' },
  48: { text: 'Изморозь',       icon: '🌫️' },
  51: { text: 'Морось',         icon: '🌦️' },
  53: { text: 'Морось',         icon: '🌦️' },
  55: { text: 'Морось',         icon: '🌦️' },
  56: { text: 'Ледяная морось', icon: '🌧️' },
  57: { text: 'Ледяная морось', icon: '🌧️' },
  61: { text: 'Дождь',          icon: '🌧️' },
  63: { text: 'Дождь',          icon: '🌧️' },
  65: { text: 'Сильный дождь',  icon: '🌧️' },
  66: { text: 'Ледяной дождь',  icon: '🌧️' },
  67: { text: 'Ледяной дождь',  icon: '🌧️' },
  71: { text: 'Снег',           icon: '❄️' },
  73: { text: 'Снег',           icon: '❄️' },
  75: { text: 'Сильный снег',   icon: '❄️' },
  77: { text: 'Снежные зёрна',  icon: '❄️' },
  80: { text: 'Ливень',         icon: '🌧️' },
  81: { text: 'Ливень',         icon: '🌧️' },
  82: { text: 'Сильный ливень', icon: '🌧️' },
  85: { text: 'Снегопад',       icon: '❄️' },
  86: { text: 'Сильный снегопад', icon: '❄️' },
  95: { text: 'Гроза',          icon: '⛈️' },
  96: { text: 'Гроза с градом', icon: '⛈️' },
  99: { text: 'Гроза с градом', icon: '⛈️' },
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
    const cond = CONDITION_MAP[c.weather_code] || { text: 'Неизвестно', icon: '❓' };
    return {
      temp: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      windDir: c.wind_direction_10m,
      condition: cond.text,
      icon: cond.icon,
      precipitation: c.precipitation,
    };
  } catch {
    return null;
  }
}
