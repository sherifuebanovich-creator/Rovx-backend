'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { FaGoogle, FaEye, FaEyeSlash, FaUser, FaEnvelope, FaLock, FaAt, FaCar, FaTruck, FaChevronDown } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { authApi, usersApi } from '@/lib/api';
import LanguagePicker from '@/components/auth/LanguagePicker';
import { getFuelType } from '@/lib/fuelMap';
import { CAR_MAKES, TRUCK_MAKES } from '@/lib/vehicleMakes';
import { VehicleType } from '@/types';
import toast from 'react-hot-toast';

const ALL_MAKES = Object.keys(CAR_MAKES).sort((a, b) => a.localeCompare(b));

export default function RegisterPage() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { setUser, setTokens } = useAuthStore();
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const years = useMemo(() => Array.from({ length: currentYear - 1969 + 1 }, (_, i) => currentYear - i), [currentYear]);
  const [form, setForm] = useState({
    email: '', username: '', displayName: '', password: '', lang: 'ru',
    vehicleType: 'CAR' as VehicleType,
    vehicleMake: '', vehicleModel: '', vehicleYear: currentYear,
  });
  const [showPass, setShowPass] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [makeSearch, setMakeSearch] = useState('');
  const [showMakeDropdown, setShowMakeDropdown] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [vehicleFuel, setVehicleFuel] = useState('PETROL');
  const makeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const makesForType = form.vehicleType === 'TRUCK' ? TRUCK_MAKES : CAR_MAKES;
  const allTruckMakes = useMemo(() => Object.keys(TRUCK_MAKES).sort((a, b) => a.localeCompare(b)), []);

  const filteredMakes = useMemo(() => {
    const available = form.vehicleType === 'TRUCK' ? allTruckMakes : ALL_MAKES;
    return available.filter(m => m.toLowerCase().includes(makeSearch.toLowerCase()));
  }, [form.vehicleType, makeSearch, allTruckMakes]);

  const availableModels = useMemo(() => {
    return makesForType[form.vehicleMake] || [];
  }, [form.vehicleMake, makesForType]);

  const filteredModels = useMemo(() => {
    return availableModels.filter(m => m.toLowerCase().includes(modelSearch.toLowerCase()));
  }, [availableModels, modelSearch]);

  // Auto-detect fuel type when make/model changes
  useEffect(() => {
    const fuel = getFuelType(form.vehicleMake, form.vehicleModel);
    setVehicleFuel(fuel);
  }, [form.vehicleMake, form.vehicleModel]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (makeRef.current && !makeRef.current.contains(e.target as Node)) setShowMakeDropdown(false);
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setShowModelDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) { toast.error(t('auth.register.passwordTooShort')); return; }
    if (!/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/[0-9]/.test(form.password)) { toast.error(t('auth.register.passwordWeak') || 'Password must contain uppercase, lowercase, and numbers'); return; }
    setIsLoading(true);
    try {
      const payload = {
        email: form.email,
        username: form.username,
        displayName: form.displayName,
        password: form.password,
        lang: form.lang,
      };
      const res = await authApi.register(payload);
      const raw = res.data;
      const responseData = raw?.data ?? raw;
      const data = responseData?.data ?? responseData;

      if (data?.needsVerification) {
        toast.success(t('auth.verify.codeSent'));
        router.push(`/auth/verify?email=${encodeURIComponent(form.email)}`);
        return;
      }

      const user = data?.user;
      const accessToken = data?.accessToken || data?.access_token;
      const refreshToken = data?.refreshToken;

      if (!accessToken || !user) {
        toast.error(t('auth.register.failed'));
        return;
      }

      setTokens(accessToken, refreshToken);
      setUser(user);

      if (form.vehicleMake && form.vehicleModel) {
        usersApi.addVehicle({
          type: form.vehicleType,
          make: form.vehicleMake,
          model: form.vehicleModel,
          year: form.vehicleYear,
          fuelType: vehicleFuel,
          name: `${form.vehicleMake} ${form.vehicleModel}`,
        }).catch(() => {});
      }

      toast.success(t('auth.register.welcome'));
      router.push('/');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('auth.register.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setIsGoogleLoading(true);
    try {
      localStorage.setItem('pending_lang', form.lang);
      localStorage.setItem('preferred_lang', form.lang);
      await signIn('google', { callbackUrl: '/' }, { state: JSON.stringify({ lang: form.lang }) });
    } catch {
      toast.error(t('auth.register.googleFailed'));
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-dark-bg flex flex-col overflow-y-auto safe-bottom safe-top">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-[50vw] h-[50vw] max-w-80 max-h-80 bg-primary-900/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-[40vw] h-[40vw] max-w-64 max-h-64 bg-accent-900/10 rounded-full blur-3xl" />
      </div>

      <div className="relative flex-1 flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex items-center gap-3 mb-8">
          <Image src="/logo.png" alt={t('auth.register.brand')} width={48} height={48} className="rounded-xl object-cover" />
          <div>
            <h1 className="font-display text-2xl font-black text-white">ROVX</h1>
            <p className="text-primary-400 text-xs">{t('auth.register.brand')}</p>
          </div>
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="w-full max-w-sm">
          <div className="card p-6">
            <h2 className="font-display font-bold text-xl text-white mb-1">{t('auth.register.title')}</h2>
            <p className="text-sm text-gray-400 mb-5">{t('auth.register.subtitle')}</p>

            {/* Google OAuth */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleGoogleSignUp}
              disabled={isGoogleLoading}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl
                         bg-white hover:bg-gray-100 text-gray-800 font-semibold text-sm
                         transition-all disabled:opacity-60 mb-4 shadow-sm"
            >
              {isGoogleLoading ? (
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
              ) : (
                <FaGoogle size={18} className="text-red-500" />
              )}
              {t('auth.register.continueWithGoogle')}
            </motion.button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-dark-border" />
              <span className="text-xs text-gray-500">{t('auth.register.orEmail')}</span>
              <div className="flex-1 h-px bg-dark-border" />
            </div>

            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.displayNameLabel')}</label>
                <div className="relative">
                  <FaUser size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input type="text" value={form.displayName} onChange={update('displayName')} className="input-field pl-9" placeholder={t('auth.register.displayNamePlaceholder')} required />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.usernameLabel')}</label>
                <div className="relative">
                  <FaAt size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input type="text" value={form.username} onChange={update('username')} className="input-field pl-9" placeholder={t('auth.register.usernamePlaceholder')} pattern="[a-zA-Z0-9_]+" minLength={3} maxLength={30} required />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.emailLabel')}</label>
                <div className="relative">
                  <FaEnvelope size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input type="email" value={form.email} onChange={update('email')} className="input-field pl-9" placeholder={t('auth.register.emailPlaceholder')} required />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.passwordLabel')}</label>
                <div className="relative">
                  <FaLock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input type={showPass ? 'text' : 'password'} value={form.password} onChange={update('password')} className="input-field pl-9 pr-10" placeholder={t('auth.register.passwordPlaceholder')} minLength={8} required />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showPass ? <FaEyeSlash size={13} /> : <FaEye size={13} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.language')}</label>
                <LanguagePicker value={form.lang} onChange={(code) => { setForm((p) => ({ ...p, lang: code })); i18n.changeLanguage(code); }} />
              </div>

              {/* Vehicle section */}
              <div className="pt-2 border-t border-dark-border">
                <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">{t('auth.register.vehicleSection')}</p>

                {/* Vehicle type toggle */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button type="button" onClick={() => { setForm(p => ({ ...p, vehicleType: 'CAR', vehicleMake: '', vehicleModel: '' })); setMakeSearch(''); setModelSearch(''); }}
                    className={`flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium transition-all border ${
                      form.vehicleType === 'CAR'
                        ? 'bg-primary-600/30 border-primary-500/50 text-white'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}>
                    <FaCar size={14} /> {t('auth.register.car')}
                  </button>
                  <button type="button" onClick={() => { setForm(p => ({ ...p, vehicleType: 'TRUCK', vehicleMake: '', vehicleModel: '' })); setMakeSearch(''); setModelSearch(''); }}
                    className={`flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-medium transition-all border ${
                      form.vehicleType === 'TRUCK'
                        ? 'bg-primary-600/30 border-primary-500/50 text-white'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}>
                    <FaTruck size={14} /> {t('auth.register.truck')}
                  </button>
                </div>

                {/* Make (autocomplete) */}
                <div className="relative mb-3" ref={makeRef}>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.makeLabel')}</label>
                  <input type="text" value={makeSearch || form.vehicleMake}
                    onChange={(e) => { setMakeSearch(e.target.value); setShowMakeDropdown(true); setForm(p => ({ ...p, vehicleMake: '', vehicleModel: '' })); }}
                    onFocus={() => { setMakeSearch(''); setShowMakeDropdown(true); }}
                    className="input-field pr-10" placeholder={t('auth.register.makePlaceholder')} />
                  <FaChevronDown size={12} className="absolute right-3 bottom-3 text-gray-500 pointer-events-none" />
                  {showMakeDropdown && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-dark-card border border-dark-border rounded-xl max-h-40 overflow-y-auto shadow-2xl">
                      {filteredMakes.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-3">{t('auth.register.noMatches')}</p>
                      ) : filteredMakes.map(m => (
                        <button key={m} type="button" onClick={() => {
                          setForm(p => ({ ...p, vehicleMake: m }));
                          setMakeSearch(m);
                          setShowMakeDropdown(false);
                        }}
                          className={`w-full text-left px-3 py-2 text-sm transition-all hover:bg-white/5 ${
                            form.vehicleMake === m ? 'text-primary-400 bg-primary-600/10' : 'text-gray-300'
                          }`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Model (autocomplete, filtered by make) */}
                <div className="relative mb-3" ref={modelRef}>
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.modelLabel')}</label>
                  <input type="text" value={modelSearch || form.vehicleModel}
                    onChange={(e) => { setModelSearch(e.target.value); setShowModelDropdown(true); setForm(p => ({ ...p, vehicleModel: '' })); }}
                    onFocus={() => { setShowModelDropdown(true); }}
                    disabled={!form.vehicleMake}
                    className="input-field pr-10 disabled:opacity-40" placeholder={form.vehicleMake ? t('auth.register.modelPlaceholderSelect') : t('auth.register.modelPlaceholderFirst')} />
                  <FaChevronDown size={12} className="absolute right-3 bottom-3 text-gray-500 pointer-events-none" />
                  {showModelDropdown && form.vehicleMake && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-dark-card border border-dark-border rounded-xl max-h-40 overflow-y-auto shadow-2xl">
                      {filteredModels.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-3">{t('auth.register.noMatches')}</p>
                      ) : filteredModels.map(m => (
                        <button key={m} type="button" onClick={() => {
                          setForm(p => ({ ...p, vehicleModel: m }));
                          setModelSearch(m);
                          setShowModelDropdown(false);
                        }}
                          className={`w-full text-left px-3 py-2 text-sm transition-all hover:bg-white/5 ${
                            form.vehicleModel === m ? 'text-primary-400 bg-primary-600/10' : 'text-gray-300'
                          }`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Year */}
                <div className="mb-3">
                  <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.register.yearLabel')}</label>
                  <select value={form.vehicleYear} onChange={update('vehicleYear')}
                    className="input-field appearance-none">
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>

                {/* Fuel type (auto-detected) */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-xs text-gray-400">{t('auth.register.fuelLabel')}</span>
                  <span className={`text-xs font-semibold ${
                    vehicleFuel === 'ELECTRIC' ? 'text-green-400' :
                    vehicleFuel === 'DIESEL' ? 'text-orange-400' :
                    vehicleFuel === 'HYBRID' ? 'text-cyan-400' :
                    'text-yellow-400'
                  }`}>
                    {vehicleFuel === 'ELECTRIC' ? `⚡ ${t('auth.register.electric')}` :
                     vehicleFuel === 'DIESEL' ? `⛽ ${t('auth.register.diesel')}` :
                     vehicleFuel === 'HYBRID' ? `🔋 ${t('auth.register.hybrid')}` :
                     vehicleFuel === 'LPG' ? `🟢 ${t('auth.register.lpg')}` :
                     `⛽ ${t('auth.register.petrol')}`}
                  </span>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={isLoading}
                className="w-full btn-primary py-3.5 flex items-center justify-center gap-2 font-semibold text-base disabled:opacity-50 mt-2"
              >
                {isLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t('auth.register.submit')}
              </motion.button>
            </form>

            <p className="text-center text-sm text-gray-400 mt-6">
              {t('auth.register.hasAccount')}{' '}
              <Link href="/auth/login" className="text-primary-400 hover:text-primary-300 font-medium">{t('auth.register.signIn')}</Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
