'use client';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { fuelApi, mapApi } from '@/lib/api';
import { FuelResult, FuelCalculation } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { FaArrowLeft, FaGasPump, FaRoute, FaHistory, FaMapMarkerAlt, FaDollarSign, FaClock, FaTachometerAlt } from 'react-icons/fa';
import toast from 'react-hot-toast';

export default function FuelPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  const FUEL_TYPES = [
    { key: 'gasoline', label: t('fuel.petrol95'), price: 55.5 },
    { key: 'diesel', label: t('fuel.diesel'), price: 62.3 },
    { key: 'gas', label: t('fuel.gas'), price: 28.0 },
    { key: 'electric', label: t('fuel.electric'), price: 12.5 },
  ];
  const [origin, setOrigin] = useState({ name: '', lat: 0, lng: 0 });
  const [dest, setDest] = useState({ name: '', lat: 0, lng: 0 });
  const [efficiency, setEfficiency] = useState(10);
  const [fuelType, setFuelType] = useState('gasoline');
  const [result, setResult] = useState<FuelResult | null>(null);
  const [history, setHistory] = useState<FuelCalculation[]>([]);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [suggestions, setSuggestions] = useState<{ origin: any[]; dest: any[] }>({ origin: [], dest: [] });

  const searchIdRef = useRef(0);
  const searchLocation = async (q: string, field: 'origin' | 'dest') => {
    if (!q.trim()) { setSuggestions(p => ({ ...p, [field]: [] })); return; }
    const thisId = ++searchIdRef.current;
    try {
      const res = await mapApi.search(q);
      if (thisId !== searchIdRef.current) return;
      const data = res.data?.data || res.data;
      setSuggestions(p => ({ ...p, [field]: data || [] }));
    } catch {
      if (thisId === searchIdRef.current) setSuggestions(p => ({ ...p, [field]: [] }));
    }
  };

  useEffect(() => {
    fuelApi.getHistory().then(res => {
      setHistory(res.data?.data || res.data || []);
    }).catch(() => {});
  }, []);

  const handleCalculate = async () => {
    if (!origin.name || !dest.name) { toast.error(t('fuel.enterRoute')); return; }
    setLoading(true);
    try {
      const res = await fuelApi.calculate({
        originName: origin.name,
        originLat: origin.lat,
        originLng: origin.lng,
        destName: dest.name,
        destLat: dest.lat,
        destLng: dest.lng,
        vehicleFuelEfficiency: efficiency,
        fuelType,
      });
      setResult(res.data?.data || res.data);
      toast.success(t('fuel.calcDone'));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('fuel.calcError'));
    } finally {
      setLoading(false);
    }
  };

  const selectSuggestion = (s: any, field: 'origin' | 'dest') => {
    if (field === 'origin') {
      setOrigin({ name: s.name || s.displayName || s.address, lat: s.lat, lng: s.lng });
    } else {
      setDest({ name: s.name || s.displayName || s.address, lat: s.lat, lng: s.lng });
    }
    setSuggestions(p => ({ ...p, [field]: [] }));
  };

  return (
    <div className="min-h-dvh bg-dark-bg pb-safe-bottom">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-primary-900/30 to-transparent" />
      </div>
      <div className="relative px-4 pt-14 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('fuel.back')}
        </button>

        <div className="flex items-center gap-3 mb-6">
          <FaGasPump size={24} className="text-primary-400" />
          <div className="flex-1">
            <h1 className="text-2xl font-black text-white font-display">{t('fuel.title')}</h1>
            <p className="text-gray-400 text-xs">{t('fuel.subtitle')}</p>
          </div>
          <button onClick={() => setShowHistory(!showHistory)}
            className="px-3 py-2 rounded-xl bg-white/5 text-gray-400 text-sm hover:bg-white/10 flex items-center gap-1">
            <FaHistory size={12} /> {t('fuel.history')}
          </button>
        </div>

        {/* History */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-6"
            >
              <div className="card p-4 space-y-2 max-h-60 overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-center text-gray-500 text-sm py-4">{t('fuel.noHistory')}</p>
                ) : history.map(h => (
                  <div key={h.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white truncate">{h.originName} → {h.destName}</p>
                      <p className="text-[10px] text-gray-500">{h.distanceKm} {t('navigationHud.km')} · {h.fuelCost} {t('fuel.currency')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form */}
        <div className="card p-4 space-y-3 mb-4">
          {/* Origin */}
          <div className="relative">
            <FaMapMarkerAlt className="absolute left-3 top-3 text-green-400" size={14} />
            <input value={origin.name} onChange={e => { setOrigin(p => ({ ...p, name: e.target.value })); searchLocation(e.target.value, 'origin'); }}
              className="input-field pl-9 text-sm" placeholder={t('fuel.origin')} />
            <AnimatePresence>
              {suggestions.origin.length > 0 && (
                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                  className="absolute z-10 top-full left-0 right-0 mt-1 bg-dark-card border border-white/10 rounded-xl overflow-hidden shadow-xl">
                  {suggestions.origin.slice(0, 5).map((s: any, i: number) => (
                    <button key={i} onClick={() => selectSuggestion(s, 'origin')}
                      className="w-full text-left px-3 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-all border-b border-white/5 last:border-0">
                      {s.name || s.displayName || s.address}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Destination */}
          <div className="relative">
            <FaMapMarkerAlt className="absolute left-3 top-3 text-red-400" size={14} />
            <input value={dest.name} onChange={e => { setDest(p => ({ ...p, name: e.target.value })); searchLocation(e.target.value, 'dest'); }}
              className="input-field pl-9 text-sm" placeholder={t('fuel.destination')} />
            <AnimatePresence>
              {suggestions.dest.length > 0 && (
                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
                  className="absolute z-10 top-full left-0 right-0 mt-1 bg-dark-card border border-white/10 rounded-xl overflow-hidden shadow-xl">
                  {suggestions.dest.slice(0, 5).map((s: any, i: number) => (
                    <button key={i} onClick={() => selectSuggestion(s, 'dest')}
                      className="w-full text-left px-3 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-all border-b border-white/5 last:border-0">
                      {s.name || s.displayName || s.address}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('fuel.consumption')}</label>
              <input type="number" value={efficiency} onChange={e => setEfficiency(Number(e.target.value))}
                className="input-field text-sm mt-1" min={1} max={50} step={0.1} />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('fuel.fuelType')}</label>
              <select value={fuelType} onChange={e => setFuelType(e.target.value)}
                className="input-field text-sm mt-1 appearance-none">
                {FUEL_TYPES.map(ft => (
                  <option key={ft.key} value={ft.key}>{ft.label} ({ft.price} {t('fuel.currencyPerLiter')})</option>
                ))}
              </select>
            </div>
          </div>

          <button onClick={handleCalculate} disabled={loading || !origin.name || !dest.name}
            className="w-full py-3 rounded-xl bg-primary-600 text-white font-semibold text-sm hover:bg-primary-500 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <><FaRoute size={14} /> {t('fuel.calculate')}</>
            )}
          </button>
        </div>

        {/* Result */}
        {result && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card p-5 border border-primary-500/30">
            <h3 className="text-white font-bold text-sm mb-4 flex items-center gap-2">
              <FaRoute className="text-primary-400" size={14} />
              {t('fuel.results')}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
                  <FaRoute className="text-blue-400" size={14} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('fuel.distance')}</p>
                  <p className="text-white font-bold">{result.distanceKm} {t('navigationHud.km')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-green-600/20 flex items-center justify-center">
                  <FaClock className="text-green-400" size={14} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('fuel.time')}</p>
                  <p className="text-white font-bold">{Math.floor(result.durationMin / 60)}{t('fuel.hourAbbr')} {result.durationMin % 60}{t('fuel.minAbbr')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-yellow-600/20 flex items-center justify-center">
                  <FaTachometerAlt className="text-yellow-400" size={14} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('fuel.fuel')}</p>
                  <p className="text-white font-bold">{result.fuelConsumed} {t('fuel.literAbbr')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-600/20 flex items-center justify-center">
                  <FaDollarSign className="text-red-400" size={14} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{t('fuel.cost')}</p>
                  <p className="text-white font-bold">{result.fuelCost} {t('fuel.currency')}</p>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2 text-xs text-gray-500">
              <FaGasPump size={10} />
              <span>{result.fuelType} · {result.efficiencyUsed} {t('fuel.perLiter100km')} · {result.fuelPricePerLiter} {t('fuel.currencyPerLiter')}</span>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
