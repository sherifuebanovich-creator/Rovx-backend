'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuthStore } from '@/store/auth.store';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/i18n';
import { motion } from 'framer-motion';
import { FaArrowLeft, FaBell, FaVolumeUp, FaMoon, FaGlobe, FaTrash, FaSignOutAlt, FaChevronRight, FaToggleOn, FaToggleOff, FaCheck, FaSearch, FaCar, FaTruck, FaPlus, FaTimes, FaCube, FaSatellite, FaRoad, FaHome, FaBriefcase, FaUser, FaIdBadge, FaKey, FaMapMarkerAlt, FaUsers } from 'react-icons/fa';
import { signOut } from 'next-auth/react';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { authApi, usersApi } from '@/lib/api';
import { LANGUAGES, getLanguageConfig } from '@/config/languages';
import { useMapStore } from '@/store/map.store';
import { VehicleForm } from '@/components/vehicles/VehicleForm';
import { AddressPicker } from '@/components/settings/AddressPicker';
import { Vehicle } from '@/types';
import { getStoredThemeMode, resolveIsDark } from '@/lib/theme';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';

// Pulls in maplibre-gl (~300KB+) — dynamic+ssr:false so that weight only
// loads if/when the user actually opens the map picker, instead of bloating
// every settings page load (this page has no map on it otherwise). Same
// pattern MapApp.tsx already uses for MapViewGL.
const MapAddressPickerModal = dynamic(
  () => import('@/components/settings/MapAddressPickerModal').then((m) => m.MapAddressPickerModal),
  { ssr: false },
);

export default function SettingsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, setUser, preferences, setPreferences } = useAuthStore();
  const { themeMode, setDarkMode, setThemeMode, mapStyle, setMapStyle, show3D, setShow3D } = useMapStore();
  const { speak, isSpeaking } = useVoiceAssistant();
  const [notifications, setNotifications] = useState(preferences?.trafficAlerts ?? true);
  const [shareLocation, setShareLocation] = useState(preferences?.shareLocationWithFriends ?? true);
  const [sound, setSound] = useState(preferences?.voiceEnabled ?? true);
  const [voiceGender, setVoiceGender] = useState<'MALE' | 'FEMALE'>(preferences?.voiceGender ?? 'FEMALE');
  // Off by default — out of the box every traffic-signal icon shows,
  // regardless of distance; other icon types (cameras, hazards) are never
  // affected by this setting either way.
  const [limitSignals, setLimitSignals] = useState(preferences?.limitTrafficSignalsRadius ?? false);
  const [lang, setLang] = useState(user?.preferredLang || i18n.language || 'ru');
  const [langSearch, setLangSearch] = useState('');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [mapPickerField, setMapPickerField] = useState<'home' | 'work' | null>(null);
  // Tracks the last SERVER-CONFIRMED address/coords per field, separate
  // from `user` (which the address inputs' onChange updates optimistically
  // on every keystroke) — needed to revert to a known-good value if a save
  // fails, and a per-field generation counter so a slow/failed older
  // request can't clobber a newer edit that already succeeded.
  const lastSavedAddressRef = useRef<Record<'home' | 'work', { address: string; lat: number | null; lng: number | null }>>({
    home: { address: '', lat: null, lng: null },
    work: { address: '', lat: null, lng: null },
  });
  const addressRequestIdRef = useRef<Record<'home' | 'work', number>>({ home: 0, work: 0 });

  useEffect(() => {
    if (!user) return;
    lastSavedAddressRef.current = {
      home: { address: user.homeAddress || '', lat: user.homeLat ?? null, lng: user.homeLng ?? null },
      work: { address: user.workAddress || '', lat: user.workLat ?? null, lng: user.workLng ?? null },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (preferences) {
      setNotifications(preferences.trafficAlerts ?? true);
      setShareLocation(preferences.shareLocationWithFriends ?? true);
      setSound(preferences.voiceEnabled ?? true);
      setVoiceGender(preferences.voiceGender ?? 'FEMALE');
      setLimitSignals(preferences.limitTrafficSignalsRadius ?? false);
    }
  }, [preferences]);

  // map.store resolves themeMode/darkMode from storage at creation time —
  // this only needs to catch a 'system' preference actually changing live
  // (OS switches) or another tab picking a different mode while this page
  // is open.
  useEffect(() => {
    const sync = () => {
      const mode = getStoredThemeMode();
      const isDark = resolveIsDark(mode);
      const state = useMapStore.getState();
      if (mode !== state.themeMode) useMapStore.setState({ themeMode: mode });
      if (isDark !== state.darkMode) setDarkMode(isDark);
    };
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', sync);
    window.addEventListener('storage', sync);
    return () => {
      mq?.removeEventListener('change', sync);
      window.removeEventListener('storage', sync);
    };
  }, [setDarkMode]);

  useEffect(() => {
    if (!user) return;
    setVehiclesLoading(true);
    setVehiclesError(false);
    usersApi.getVehicles().then(res => {
      setVehicles(res.data.data || res.data || []);
    }).catch((err: any) => {
      // Was a bare catch(() => ...) — swallowed the real backend/network
      // error completely, so every failure (cold start, a genuine 500,
      // an expired token) looked identical and undiagnosable from the UI.
      console.error('[Settings] Failed to load vehicles:', err?.response?.status, err?.response?.data || err?.message);
      setVehiclesError(true);
      toast.error(err?.response?.data?.message || t('settings.vehiclesLoadFailed'));
    }).finally(() => setVehiclesLoading(false));
  }, [user]);

  // Home/work addresses are set by picking a geocoded suggestion (see
  // AddressPicker), never by free-typing — so there's no ambiguous "first
  // search result" guess anymore, just whichever place the user selected.
  const revertAddressOnFailure = (field: 'home' | 'work', requestId: number) => {
    // A newer edit already superseded this one — let it own the outcome.
    if (requestId !== addressRequestIdRef.current[field]) return;
    const addressKey = field === 'home' ? 'homeAddress' : 'workAddress';
    const latKey = field === 'home' ? 'homeLat' : 'workLat';
    const lngKey = field === 'home' ? 'homeLng' : 'workLng';
    const saved = lastSavedAddressRef.current[field];
    const current = useAuthStore.getState().user;
    if (!current) return;
    setUser({ ...current, [addressKey]: saved.address, [latKey]: saved.lat, [lngKey]: saved.lng } as any);
  };

  const handleAddressSelect = async (field: 'home' | 'work', suggestion: { name: string; address?: string; lat: number; lng: number }) => {
    if (!user) return;
    const addressKey = field === 'home' ? 'homeAddress' : 'workAddress';
    const latKey = field === 'home' ? 'homeLat' : 'workLat';
    const lngKey = field === 'home' ? 'homeLng' : 'workLng';
    const value = suggestion.address || suggestion.name;
    const requestId = ++addressRequestIdRef.current[field];

    const patch = { [addressKey]: value, [latKey]: suggestion.lat, [lngKey]: suggestion.lng };
    setUser({ ...user, ...patch } as any);
    try {
      await usersApi.updateProfile(patch);
      if (requestId !== addressRequestIdRef.current[field]) return;
      lastSavedAddressRef.current[field] = { address: value, lat: suggestion.lat, lng: suggestion.lng };
    } catch (err: any) {
      console.error('[Settings] Failed to save address:', err?.response?.status, err?.response?.data || err?.message);
      toast.error(err?.response?.data?.message || t('settings.saveFailed'));
      revertAddressOnFailure(field, requestId);
    }
  };

  const handleAddressClear = async (field: 'home' | 'work') => {
    if (!user) return;
    const addressKey = field === 'home' ? 'homeAddress' : 'workAddress';
    const latKey = field === 'home' ? 'homeLat' : 'workLat';
    const lngKey = field === 'home' ? 'homeLng' : 'workLng';
    const requestId = ++addressRequestIdRef.current[field];
    const patch = { [addressKey]: '', [latKey]: null, [lngKey]: null };
    setUser({ ...user, ...patch } as any);
    try {
      await usersApi.updateProfile(patch);
      if (requestId !== addressRequestIdRef.current[field]) return;
      lastSavedAddressRef.current[field] = { address: '', lat: null, lng: null };
    } catch (err: any) {
      console.error('[Settings] Failed to clear address:', err?.response?.status, err?.response?.data || err?.message);
      toast.error(err?.response?.data?.message || t('settings.saveFailed'));
      revertAddressOnFailure(field, requestId);
    }
  };

  const handleLanguageChange = (code: string) => {
    const prevLang = lang;
    setLang(code);
    setLangSearch('');
    setShowLangPicker(false);
    i18n.changeLanguage(code);
    if (user) {
      const prevUser = user;
      setUser({ ...user, preferredLang: code });
      // Was fire-and-forget with only a toast on failure — the language
      // selector, i18n, and user.preferredLang stayed on the new (unsaved)
      // value forever with no re-sync to what the server actually has.
      usersApi.updateProfile({ preferredLang: code }).catch((err: any) => {
        console.error('[Settings] Failed to save language:', err?.response?.status, err?.response?.data || err?.message);
        toast.error(err?.response?.data?.message || t('settings.saveFailed'));
        setLang(prevLang);
        i18n.changeLanguage(prevLang);
        setUser(prevUser);
      });
    } else {
      localStorage.setItem('preferred_lang', code);
    }
    toast.success(`${getLanguageConfig(code).flag} ${getLanguageConfig(code).nativeName}`);
  };

  const updatePreference = (key: string, value: boolean | string) => {
    const prevPreferences = preferences;
    const updated = { ...(preferences ?? {}), [key]: value } as any;
    setPreferences(updated);
    if (user) {
      // Reverting `preferences` on failure also reverts the notifications/
      // sound toggles, since the effect above re-syncs them from it — same
      // fix as language above: a failed save used to leave the toggle
      // showing the new (unsaved) state forever.
      usersApi.updatePreferences({ [key]: value }).catch((err: any) => {
        console.error('[Settings] Failed to save preference:', key, err?.response?.status, err?.response?.data || err?.message);
        toast.error(err?.response?.data?.message || t('settings.saveFailed'));
        setPreferences(prevPreferences as any);
      });
    } else {
      localStorage.setItem('preferences', JSON.stringify(updated));
    }
  };

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    await signOut({ redirect: false });
    useAuthStore.getState().logout();
    toast.success(t('settings.loggedOut'));
    router.push('/auth/login');
  };

  const Toggle = ({ value, onChange }: { value: boolean; onChange: () => void }) => (
    <button onClick={onChange} className="text-2xl">
      {value ? <FaToggleOn className="text-primary-400" /> : <FaToggleOff className="text-gray-600" />}
    </button>
  );

  const filteredLangs = LANGUAGES.filter(
    (l) =>
      l.nativeName.toLowerCase().includes(langSearch.toLowerCase()) ||
      l.englishName.toLowerCase().includes(langSearch.toLowerCase()) ||
      l.code.includes(langSearch),
  );

  const sections = [
    {
      title: t('settings.preferences'),
      items: [
        { icon: <FaBell size={16} className="text-yellow-400" />, label: t('settings.notifications'), right: <Toggle value={notifications} onChange={() => { const v = !notifications; setNotifications(v); updatePreference('trafficAlerts', v); }} /> },
        { icon: <FaUsers size={16} className="text-green-400" />, label: t('settings.shareLocation'), right: <Toggle value={shareLocation} onChange={() => { const v = !shareLocation; setShareLocation(v); updatePreference('shareLocationWithFriends', v); }} /> },
        { icon: <FaVolumeUp size={16} className="text-blue-400" />, label: t('settings.sound'), right: <Toggle value={sound} onChange={() => { const v = !sound; setSound(v); updatePreference('voiceEnabled', v); }} /> },
        { icon: <FaVolumeUp size={16} className={`text-blue-400 ${isSpeaking ? 'animate-pulse' : ''}`} />, label: t('settings.voiceGender'),
          right: (
            <div className="flex items-center gap-1.5">
              {(['MALE', 'FEMALE'] as const).map((g) => (
                // Changing this toggle used to give zero feedback about
                // whether TTS actually works or what the voice sounds like —
                // the tap itself is a user gesture, so it's the one place we
                // can play a short preview without hitting the browser's
                // autoplay-block. setPreferences() below is synchronous, so
                // speak()'s own read of preferences.voiceGender already sees
                // the new value by the time it fires.
                <button key={g} type="button" onClick={() => {
                  setVoiceGender(g); updatePreference('voiceGender', g);
                  if (sound) speak(t('settings.voicePreviewText'), true);
                  else toast(t('settings.voicePreviewNeedsSound'));
                }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                    voiceGender === g
                      ? 'bg-primary-600/30 border-primary-500/50 text-white'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                  }`}>
                  {t(g === 'MALE' ? 'settings.voiceGenderMale' : 'settings.voiceGenderFemale')}
                </button>
              ))}
            </div>
          ),
        },
        { icon: <FaMoon size={16} className="text-purple-400" />, label: t('settings.darkMode'),
          right: (
            <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5">
              {(['light', 'system', 'dark'] as const).map((m) => (
                <button key={m} onClick={() => {
                  // Mirrors TopBar.tsx's quick toggle, but as an explicit
                  // 3-way choice — 'system' follows the OS's own light/dark
                  // preference (and updates live if it changes) instead of
                  // this app defaulting to a hardcoded light or dark theme.
                  setThemeMode(m);
                  const v = resolveIsDark(m);
                  if (v && mapStyle === 'streets') setMapStyle('night');
                  else if (!v && mapStyle === 'night') setMapStyle('streets');
                }}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${themeMode === m ? 'bg-primary-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                  {t(`settings.theme.${m}`)}
                </button>
              ))}
            </div>
          ),
        },
        { icon: <FaGlobe size={16} className="text-green-400" />, label: t('settings.language'),
          right: (
            <button onClick={() => setShowLangPicker(true)}
              className="text-sm text-gray-300 hover:text-white transition-all flex items-center gap-1.5">
              <span className="font-emojiflag">{getLanguageConfig(lang).flag}</span> {getLanguageConfig(lang).nativeName}
            </button>
          )
        },
      ]
    },
    {
      title: t('settings.mapMode'),
      items: [
        { icon: <FaRoad size={16} className="text-blue-400" />, label: t('settings.streets'),
          right: <div className={`w-5 h-5 rounded-full border-2 ${mapStyle === 'streets' ? 'border-primary-400 bg-primary-400/30' : 'border-gray-600'} flex items-center justify-center`}>
            {mapStyle === 'streets' && <div className="w-2.5 h-2.5 rounded-full bg-primary-400" />}
          </div>,
          onClick: () => { setMapStyle('streets'); },
        },
        { icon: <FaSatellite size={16} className="text-green-400" />, label: t('settings.satellite'),
          right: <div className={`w-5 h-5 rounded-full border-2 ${mapStyle === 'satellite' ? 'border-primary-400 bg-primary-400/30' : 'border-gray-600'} flex items-center justify-center`}>
            {mapStyle === 'satellite' && <div className="w-2.5 h-2.5 rounded-full bg-primary-400" />}
          </div>,
          onClick: () => { setMapStyle('satellite'); },
        },
        { icon: <FaCube size={16} className="text-purple-400" />, label: t('settings.3dBuildings'),
          right: <Toggle value={show3D} onChange={() => { setShow3D(!show3D); }} />,
        },
        { icon: <FaRoad size={16} className="text-amber-400" />, label: t('settings.limitTrafficSignals'),
          right: <Toggle value={limitSignals} onChange={() => { const v = !limitSignals; setLimitSignals(v); updatePreference('limitTrafficSignalsRadius', v); }} />,
        },
      ],
    },
    {
      title: t('settings.account'),
      items: user ? [
        { icon: <FaUser size={16} className="text-primary-400" />, label: t('settings.email'), right: <span className="text-sm text-gray-400 truncate max-w-[160px]">{user.email}</span> },
        { icon: <FaIdBadge size={16} className="text-gray-400" />, label: t('settings.accountId'), right: <span className="text-xs text-gray-500 font-mono">{user.id.slice(0, 8)}</span> },
      ] : [],
    },
    {
      title: t('settings.privacy'),
      subtitle: t('settings.privacyIntro'),
      items: [
        // A Google-only account (no password ever set) hitting this used to
        // land on /auth/reset-password, which auto-sends on mount — the
        // backend's forgot-password flow intentionally no-ops for accounts
        // with no passwordHash (anti-enumeration), but still returns a
        // generic "sent" response, so the user saw a fake success toast and
        // a code-entry screen for a code that was never emailed. We already
        // know hasPassword here (this is the logged-in Settings page, not
        // the public forgot-password form, so showing it doesn't leak
        // anything about other accounts).
        user?.hasPassword === false
          ? { icon: <FaKey size={16} className="text-gray-500" />, label: t('settings.changePassword'),
              right: <span className="text-xs text-gray-500">{t('settings.googleAccount')}</span>,
              onClick: () => toast(t('settings.googleAccountHint')),
            }
          : { icon: <FaKey size={16} className="text-blue-400" />, label: t('settings.changePassword'),
              right: <FaChevronRight size={12} className="text-gray-600" />,
              onClick: () => router.push(`/auth/reset-password${user?.email ? `?email=${encodeURIComponent(user.email)}` : ''}`),
            },
        { icon: <FaTrash size={16} className="text-red-400" />, label: t('settings.deleteMyData'),
          right: <FaChevronRight size={12} className="text-gray-600" />,
          onClick: () => router.push('/support'),
        },
      ],
    },
  ];

  return (
    <div className="min-h-dvh bg-dark-bg">
      <div className="relative px-4 sm:px-6 pt-14 pb-safe-bottom pb-12 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('settings.back')}
        </button>
        <h1 className="text-2xl font-black text-white font-display mb-6">{t('settings.title')}</h1>

        {sections.map((section, si) => (
          <div key={si} className="mb-5">
            <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-2 px-1">{section.title}</p>
            {section.subtitle && (
              <p className="text-xs text-gray-500 mb-2 px-1">{section.subtitle}</p>
            )}
            <div className="card overflow-hidden">
              {section.items.map((item, i) => {
                const rowClasses = `w-full flex items-center gap-3 px-4 py-3.5 text-left ${i > 0 ? 'border-t border-dark-border' : ''}`;
                // Read-only info rows (no onClick, e.g. email/account id) render
                // as a plain div — a motion.button with hover/tap feedback but
                // no action implied it was clickable when it did nothing.
                if (!item.onClick) {
                  return (
                    <div key={item.label} className={rowClasses}>
                      {item.icon}
                      <span className="flex-1 text-sm text-gray-200">{item.label}</span>
                      {item.right}
                    </div>
                  );
                }
                return (
                  <motion.button key={item.label} whileTap={{ scale: 0.98 }} onClick={item.onClick}
                    className={`${rowClasses} hover:bg-white/5 transition-all`}>
                    {item.icon}
                    <span className="flex-1 text-sm text-gray-200">{item.label}</span>
                    {item.right}
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}

        {user && (
          <>
            <div className="mb-5">
              <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-2 px-1">{t('settings.addresses')}</p>
              <div className="card overflow-hidden">
                {/* Home address */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center text-primary-400">
                    <FaHome size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 font-medium">{t('settings.home')}</p>
                    <AddressPicker
                      value={user.homeAddress || ''}
                      placeholder={t('settings.homePlaceholder')}
                      onSelect={(s) => handleAddressSelect('home', s)}
                      onClear={() => handleAddressClear('home')}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setMapPickerField('home')}
                    title={t('settings.pickOnMap')}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-primary-400 transition-all flex-shrink-0"
                  >
                    <FaMapMarkerAlt size={14} />
                  </button>
                  {user.homeLat && user.homeLng && (
                    <span className="text-[10px] text-green-400 bg-green-600/20 px-2 py-0.5 rounded-full flex-shrink-0">
                      {t('settings.onMap')}
                    </span>
                  )}
                </div>
                <div className="border-t border-dark-border" />
                {/* Work address */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-600/20 flex items-center justify-center text-accent-400">
                    <FaBriefcase size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 font-medium">{t('settings.work')}</p>
                    <AddressPicker
                      value={user.workAddress || ''}
                      placeholder={t('settings.workPlaceholder')}
                      onSelect={(s) => handleAddressSelect('work', s)}
                      onClear={() => handleAddressClear('work')}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setMapPickerField('work')}
                    title={t('settings.pickOnMap')}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-primary-400 transition-all flex-shrink-0"
                  >
                    <FaMapMarkerAlt size={14} />
                  </button>
                  {user.workLat && user.workLng && (
                    <span className="text-[10px] text-green-400 bg-green-600/20 px-2 py-0.5 rounded-full flex-shrink-0">
                      {t('settings.onMap')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mb-5">
              <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-2 px-1">{t('settings.vehicles')}</p>
              <div className="card overflow-hidden">
                {vehiclesLoading ? (
                  <div className="px-4 py-6 text-center">
                    <div className="w-5 h-5 border-2 border-primary-400/30 border-t-primary-400 rounded-full animate-spin mx-auto" />
                  </div>
                ) : vehiclesError ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-red-400">{t('settings.vehiclesLoadFailed')}</p>
                  </div>
                ) : vehicles.length === 0 && !showAddVehicle && (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-gray-500 mb-3">{t('settings.noVehicles')}</p>
                    <button onClick={() => setShowAddVehicle(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600/20 border border-primary-500/30 text-primary-400 text-sm font-medium hover:bg-primary-600/30 transition-all">
                      <FaPlus size={12} /> {t('settings.addVehicle')}
                    </button>
                  </div>
                )}

                {vehicles.map((v, i) => (
                  <div key={v.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-dark-border' : ''}`}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs bg-primary-600/20 text-primary-400">
                      {v.type === 'TRUCK' ? <FaTruck size={14} /> : <FaCar size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{v.name || `${v.make} ${v.model}`}</p>
                      <p className="text-xs text-gray-500">{v.year}</p>
                    </div>
                    <button onClick={async () => {
                      try {
                        await usersApi.deleteVehicle(v.id);
                        setVehicles(p => p.filter(x => x.id !== v.id));
                        toast.success(t('settings.vehicleRemoved'));
                      } catch { toast.error(t('settings.vehicleRemoveFailed')); }
                    }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-600/20 text-gray-500 hover:text-red-400 transition-all">
                      <FaTimes size={12} />
                    </button>
                  </div>
                ))}

                {!showAddVehicle && vehicles.length > 0 && (
                  <button onClick={() => setShowAddVehicle(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 border-t border-dark-border text-sm text-primary-400 hover:bg-white/5 transition-all">
                    <FaPlus size={12} /> {t('settings.addVehicle')}
                  </button>
                )}

                {showAddVehicle && (
                  <div className="border-t border-dark-border px-4 py-4">
                    <VehicleForm
                      onSubmit={async (data) => {
                        try {
                          await usersApi.addVehicle({
                            type: data.type,
                            make: data.make,
                            model: data.model,
                            year: data.year,
                            fuelType: data.fuelType,
                            name: `${data.make} ${data.model}`,
                          });
                          setVehiclesLoading(true);
                          const res = await usersApi.getVehicles();
                          setVehicles(res.data.data || res.data || []);
                          setShowAddVehicle(false);
                          toast.success(t('settings.vehicleAdded'));
                        } catch { toast.error(t('settings.vehicleAddFailed')); }
                        finally { setVehiclesLoading(false); }
                      }}
                      onCancel={() => setShowAddVehicle(false)}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Sign out / delete only mean anything with an actual session —
            unlike Account above (which already hides its rows for guests via
            an empty items array), this block rendered unconditionally, so a
            guest who never logged in saw a "Sign out" / "Delete account"
            section same as Profile/Notifications correctly gate for guests. */}
        {user && (
          <div className="mb-5">
            <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-2 px-1">{t('settings.dangerZone')}</p>
            <div className="card overflow-hidden">
              <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-600/10 transition-all text-left border-b border-dark-border">
                <FaSignOutAlt size={16} className="text-red-400" />
                <span className="flex-1 text-sm text-red-400">{t('settings.signOut')}</span>
              </button>
              <button onClick={() => toast.error(t('settings.contactSupport'))}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-600/10 transition-all text-left">
                <FaTrash size={16} className="text-red-600" />
                <span className="flex-1 text-sm text-red-600">{t('settings.deleteAccount')}</span>
              </button>
            </div>
          </div>
        )}
        <p className="text-center text-xs text-gray-600 mt-6">{t('settings.footer', { version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0' })}</p>
      </div>

      {/* Language picker modal */}
      {showLangPicker && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/60"
            onClick={() => { setShowLangPicker(false); setLangSearch(''); }}
          />
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }}
            className="relative bg-dark-card/98 backdrop-blur-2xl rounded-t-3xl md:rounded-3xl w-full max-w-md mx-0 md:mx-4 max-h-[80vh] flex flex-col border border-white/10 shadow-2xl">
            <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-dark-border">
              <FaGlobe size={16} className="text-primary-400" />
              <span className="font-display font-bold text-white text-lg">{t('settings.chooseLanguage')}</span>
              <button onClick={() => { setShowLangPicker(false); setLangSearch(''); }}
                className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10">
                <FaArrowLeft size={14} className="text-gray-400" />
              </button>
            </div>
            <div className="px-4 pt-3 pb-2">
              <div className="relative">
                <FaSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  value={langSearch}
                  onChange={(e) => setLangSearch(e.target.value)}
                  placeholder={t('settings.searchLanguage')}
                  className="w-full bg-dark-surface border border-dark-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500 transition-all"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {filteredLangs.map((l) => (
                <button key={l.code} onClick={() => handleLanguageChange(l.code)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left hover:bg-white/5 ${
                    lang === l.code ? 'bg-primary-600/20' : ''
                  }`}>
                  <span className="text-xl flex-shrink-0 font-emojiflag">{l.flag}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium">{l.nativeName}</p>
                    <p className="text-[11px] text-gray-500">{l.englishName}</p>
                  </div>
                  {lang === l.code && <FaCheck size={14} className="text-primary-400 flex-shrink-0" />}
                </button>
              ))}
              {filteredLangs.length === 0 && (
                <p className="text-center text-sm text-gray-500 py-8">{t('settings.noLanguages')}</p>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {mapPickerField && (
        <MapAddressPickerModal
          initial={
            mapPickerField === 'home'
              ? (user?.homeLat && user?.homeLng ? { lat: user.homeLat, lng: user.homeLng } : null)
              : (user?.workLat && user?.workLng ? { lat: user.workLat, lng: user.workLng } : null)
          }
          onConfirm={(s) => { handleAddressSelect(mapPickerField, s); setMapPickerField(null); }}
          onClose={() => setMapPickerField(null)}
        />
      )}

    </div>
  );
}
