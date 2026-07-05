import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import lang_ru from './locales/ru.json';
import lang_en from './locales/en.json';

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: lang_ru },
    en: { translation: lang_en },
  },
  lng: 'ru',
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
  returnObjects: true,
});

export default i18n;
