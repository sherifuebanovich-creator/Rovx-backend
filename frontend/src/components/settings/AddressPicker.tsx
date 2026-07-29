'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FaTimes } from 'react-icons/fa';
import { mapApi } from '@/lib/api';
import { SearchSuggestion } from '@/types';

interface AddressPickerProps {
  value: string;
  placeholder: string;
  onSelect: (suggestion: SearchSuggestion) => void;
  onClear: () => void;
}

// A place picker, not a free-text field — typing filters a dropdown of real
// geocoded suggestions (mirrors SearchPanel's autocomplete), and a value is
// only ever committed by picking one of them. The previous version was a
// plain <input> that geocoded whatever the user typed on blur and silently
// took the first search result — no way to see or choose among candidates,
// so a common street name in the wrong city could get saved with no
// indication anything was ambiguous.
export function AddressPicker({ value, placeholder, onSelect, onClear }: AddressPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const fetchIdRef = useRef(0);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const fetchSuggestions = useCallback((q: string) => {
    clearTimeout(debounceRef.current);
    if (!q.trim() || q.trim().length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const thisFetch = ++fetchIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await mapApi.suggest(q);
        if (thisFetch !== fetchIdRef.current) return;
        setSuggestions(res.data?.data || res.data || []);
      } catch {
        if (thisFetch === fetchIdRef.current) setSuggestions([]);
      } finally {
        if (thisFetch === fetchIdRef.current) setLoading(false);
      }
    }, 350);
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); fetchSuggestions(e.target.value); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-white placeholder-gray-600 outline-none mt-0.5"
        />
        {value && (
          <button
            type="button"
            onClick={() => { setQuery(''); setSuggestions([]); setOpen(false); onClear(); }}
            className="text-gray-600 hover:text-gray-400 transition-all flex-shrink-0"
          >
            <FaTimes size={12} />
          </button>
        )}
      </div>
      {open && (loading || suggestions.length > 0 || query.trim().length >= 2) && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-dark-card border border-dark-border rounded-xl shadow-xl max-h-56 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-xs text-gray-500">…</div>}
          {!loading && suggestions.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-500">{t('settings.noPlacesFound')}</div>
          )}
          {!loading && suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setQuery(s.address || s.name);
                setSuggestions([]);
                setOpen(false);
                onSelect(s);
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/5 transition-all"
            >
              <p className="truncate">{s.name}</p>
              {s.address && s.address !== s.name && <p className="truncate text-xs text-gray-500">{s.address}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
