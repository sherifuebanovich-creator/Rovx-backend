'use client';
import { useEffect } from 'react';
import i18n from './i18n';
import { useAuthStore } from '@/store/auth.store';

export function I18nInitializer() {
  const { user } = useAuthStore();

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('preferred_lang') : null;
    // A logged-in user's saved account language must win over whatever
    // happens to be cached in this browser's localStorage — otherwise a
    // stale value left over from browsing as a guest (or a different
    // account on the same device) silently overrides the account's actual
    // preference forever, showing e.g. a Russian UI with "English" selected
    // in Settings (which reads user.preferredLang directly, not this cache).
    // localStorage is only the right fallback for a guest with no account.
    const lang = user?.preferredLang || stored || i18n.language || 'ru';
    if (i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }
    document.documentElement.lang = lang;
  }, [user?.preferredLang, user?.id]);

  useEffect(() => {
    const handler = (lng: string) => {
      document.documentElement.lang = lng;
      if (typeof window !== 'undefined') {
        localStorage.setItem('preferred_lang', lng);
      }
    };
    i18n.on('languageChanged', handler);
    return () => { i18n.off('languageChanged', handler); };
  }, []);

  return null;
}
