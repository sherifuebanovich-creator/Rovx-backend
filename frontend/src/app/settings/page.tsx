'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/i18n';
import { motion } from 'framer-motion';
import { FaArrowLeft, FaBell, FaVolumeUp, FaMoon, FaGlobe, FaShieldAlt, FaTrash, FaSignOutAlt, FaChevronRight, FaToggleOn, FaToggleOff, FaCheck, FaSearch, FaCar, FaTruck, FaPlus, FaTimes, FaCube, FaSatellite, FaRoad, FaHome, FaBriefcase } from 'react-icons/fa';
import { signOut } from 'next-auth/react';
import toast from 'react-hot-toast';
import { authApi, usersApi, mapApi } from '@/lib/api';
import { LANGUAGES, getLanguageConfig } from '@/config/languages';
import { useMapStore } from '@/store/map.store';
import { VehicleForm } from '@/components/vehicles/VehicleForm';
import { Vehicle } from '@/types';

export default function SettingsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, setUser, preferences, setPreferences } = useAuthStore();
  const { darkMode, setDarkMode, mapStyle, setMapStyle, show3D, setShow3D } = useMapStore();
  const [notifications, setNotifications] = useState(preferences?.trafficAlerts ?? true);
  const [sound, setSound] = useState(preferences?.voiceEnabled ?? true);
  const [lang, setLang] = useState(user?.preferredLang || i18n.language || 'ru');
  const [langSearch, setLangSearch] = useState('');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);

  useEffect(() => {
    if (preferences) {
      setNotifications(preferences.trafficAlerts ?? true);
      setSound(preferences.voiceEnabled ?? true);
    }
  }, [preferences]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('darkMode');
      if (stored !== null) {
        const isDark = stored !== 'false';
        setDarkMode(isDark);
        document.documentElement.classList.toggle('dark', isDark);
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    setVehiclesLoading(true);
    setVehiclesError(false);
    usersApi.getVehicles().then(res => {
      setVehicles(res.data.data || res.data || []);
    }).catch(() => {
      setVehiclesError(true);
      toast.error(t('settings.vehiclesLoadFailed'));
    }).finally(() => setVehiclesLoading(false));
  }, [user]);

  // Free-text home/work addresses were saving text without geocoding it,
  // so an edited address kept the OLD lat/lng — SearchPanel's quick-
  // destination buttons would then route to a stale location under the
  // new label. Geocode on blur and keep coords in lockstep with the text;
  // clear them (rather than leave stale) if geocoding finds nothing.
  const handleAddressBlur = async (field: 'home' | 'work', rawValue: string) => {
    if (!user) return;
    const value = rawValue.trim();
    const addressKey = field === 'home' ? 'homeAddress' : 'workAddress';
    const latKey = field === 'home' ? 'homeLat' : 'workLat';
    const lngKey = field === 'home' ? 'homeLng' : 'workLng';

    if (!value) {
      const patch = { [addressKey]: '', [latKey]: null, [lngKey]: null };
      try {
        await usersApi.updateProfile(patch);
        setUser({ ...user, ...patch });
      } catch {
        toast.error(t('settings.saveFailed'));
      }
      return;
    }

    try {
      const res = await mapApi.search(value, undefined, undefined, 20);
      const results = res.data?.data || res.data || [];
      const match = results[0];
      const patch = {
        [addressKey]: value,
        [latKey]: match?.lat ?? null,
        [lngKey]: match?.lng ?? null,
      };
      await usersApi.updateProfile(patch);
      setUser({ ...user, ...patch });
      if (!match) toast.error(t('settings.addressNotFound'));
    } catch {
      toast.error(t('settings.saveFailed'));
    }
  };

  const handleLanguageChange = (code: string) => {
    setLang(code);
    setLangSearch('');
    setShowLangPicker(false);
    i18n.changeLanguage(code);
    if (user) {
      setUser({ ...user, preferredLang: code });
      usersApi.updateProfile({ preferredLang: code }).catch(() => toast.error(t('settings.saveFailed')));
    } else {
      localStorage.setItem('preferred_lang', code);
    }
    toast.success(`${getLanguageConfig(code).flag} ${getLanguageConfig(code).nativeName}`);
  };

  const updatePreference = (key: string, value: boolean) => {
    const updated = { ...(preferences ?? {}), [key]: value } as any;
    setPreferences(updated);
    if (user) {
      usersApi.updatePreferences({ [key]: value }).catch(() => toast.error(t('settings.saveFailed')));
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
        { icon: <FaVolumeUp size={16} className="text-blue-400" />, label: t('settings.sound'), right: <Toggle value={sound} onChange={() => { const v = !sound; setSound(v); updatePreference('voiceEnabled', v); }} /> },
        { icon: <FaMoon size={16} className="text-purple-400" />, label: t('settings.darkMode'), right: <Toggle value={darkMode} onChange={() => { useMapStore.getState().setDarkMode(!darkMode); const v = !darkMode; document.documentElement.classList.toggle('dark', v); localStorage.setItem('darkMode', String(v)); }} /> },
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
      ],
    },
    {
      title: t('settings.account'),
      items: [
        { icon: <FaShieldAlt size={16} className="text-primary-400" />, label: t('settings.privacy'), right: <FaChevronRight size={12} className="text-gray-600" />, onClick: () => {} },
      ]
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
            <div className="card overflow-hidden">
              {section.items.map((item, i) => (
                <motion.button key={item.label} whileTap={{ scale: 0.98 }} onClick={item.onClick}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 transition-all text-left ${i > 0 ? 'border-t border-dark-border' : ''}`}>
                  {item.icon}
                  <span className="flex-1 text-sm text-gray-200">{item.label}</span>
                  {item.right}
                </motion.button>
              ))}
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
                    <input
                      value={user.homeAddress || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setUser({ ...user, homeAddress: val });
                      }}
                      onBlur={(e) => handleAddressBlur('home', e.target.value)}
                      className="w-full bg-transparent text-sm text-white placeholder-gray-600 outline-none mt-0.5"
                      placeholder={t('settings.homePlaceholder')}
                    />
                  </div>
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
                    <input
                      value={user.workAddress || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setUser({ ...user, workAddress: val });
                      }}
                      onBlur={(e) => handleAddressBlur('work', e.target.value)}
                      className="w-full bg-transparent text-sm text-white placeholder-gray-600 outline-none mt-0.5"
                      placeholder={t('settings.workPlaceholder')}
                    />
                  </div>
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
        <p className="text-center text-xs text-gray-600 mt-6">{t('settings.footer')}</p>
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

    </div>
  );
}
