'use client';
import { useState, useRef, useEffect } from 'react';
import { LANGUAGES } from '@/config/languages';
import { FaChevronDown, FaSearch } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';

const POPULAR = ['en', 'ru'];

interface LanguagePickerProps {
  value: string;
  onChange: (code: string) => void;
}

export default function LanguagePicker({ value, onChange }: LanguagePickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = LANGUAGES.find((l) => l.code === value) || LANGUAGES.find((l) => l.code === 'en') || LANGUAGES[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const popular = POPULAR.map((c) => LANGUAGES.find((l) => l.code === c)).filter(Boolean) as typeof LANGUAGES;
  const others = LANGUAGES.filter((l) => !POPULAR.includes(l.code));

  const filtered = search
    ? LANGUAGES.filter(
        (l) =>
          l.nativeName.toLowerCase().includes(search.toLowerCase()) ||
          l.englishName.toLowerCase().includes(search.toLowerCase()),
      )
    : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="input-field flex items-center gap-2 w-full cursor-pointer"
      >
        <span className="text-lg leading-none font-emojiflag">{selected.flag}</span>
        <span className="flex-1 text-left text-sm truncate">{selected.nativeName}</span>
        <span className="text-[10px] text-gray-500 uppercase ml-1">{selected.code}</span>
        <FaChevronDown size={10} className={`text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-dark-border bg-dark-card shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-dark-border bg-dark-bg/50">
            <FaSearch size={11} className="text-gray-500 shrink-0" />
            <input
              type="text"
              placeholder={t('settings.searchLanguage')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
              autoFocus
            />
          </div>

          <div className="overflow-y-auto max-h-56">
            {filtered ? (
              filtered.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => {
                    onChange(l.code);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-dark-border/60 ${
                    l.code === value ? 'bg-primary-900/20 text-primary-400' : 'text-white'
                  }`}
                >
                  <span className="text-lg leading-none font-emojiflag">{l.flag}</span>
                  <span>{l.nativeName}</span>
                  <span className="text-gray-500 text-[10px] uppercase font-mono ml-1">{l.code}</span>
                  <span className="text-gray-600 text-[11px] ml-auto">{l.englishName}</span>
                </button>
              ))
            ) : (
              <>
                <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                  {t('settings.popular')}
                </div>
                {popular.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => {
                      onChange(l.code);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-dark-border/60 ${
                      l.code === value ? 'bg-primary-900/20 text-primary-400' : 'text-white'
                    }`}
                  >
                    <span className="text-lg leading-none font-emojiflag">{l.flag}</span>
                    <span>{l.nativeName}</span>
                    <span className="text-gray-500 text-[10px] uppercase font-mono ml-1">{l.code}</span>
                  </button>
                ))}
                {others.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider font-semibold mt-0.5">
                      {t('settings.allLanguages')}
                    </div>
                    {others.map((l) => (
                      <button
                        key={l.code}
                        type="button"
                        onClick={() => {
                          onChange(l.code);
                          setIsOpen(false);
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors hover:bg-dark-border/60 ${
                          l.code === value ? 'bg-primary-900/20 text-primary-400' : 'text-white'
                        }`}
                      >
                        <span className="text-lg leading-none font-emojiflag">{l.flag}</span>
                        <span>{l.nativeName}</span>
                        <span className="text-gray-500 text-[10px] uppercase font-mono ml-1">{l.code}</span>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
