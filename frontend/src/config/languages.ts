export interface LanguageConfig {
  code: string;
  nativeName: string;
  englishName: string;
  flag: string;
  voiceLang: string;
  speechLang: string;
}

export const LANGUAGES: LanguageConfig[] = [
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', flag: '🇷🇺', voiceLang: 'ru-RU', speechLang: 'ru-RU' },
  { code: 'en', nativeName: 'English', englishName: 'English', flag: '🇬🇧', voiceLang: 'en-US', speechLang: 'en-US' },
];

export function getLanguageConfig(code: string): LanguageConfig {
  return LANGUAGES.find(l => l.code === code) || LANGUAGES[0];
}
