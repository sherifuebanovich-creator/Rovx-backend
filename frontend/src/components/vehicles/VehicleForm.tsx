'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FaCar, FaTruck, FaChevronDown } from 'react-icons/fa';
import { getFuelType } from '@/lib/fuelMap';
import { CAR_MAKES, TRUCK_MAKES } from '@/lib/vehicleMakes';
import { VehicleType } from '@/types';

interface VehicleFormProps {
  onSubmit: (data: {
    type: VehicleType;
    make: string;
    model: string;
    year: number;
    fuelType: string;
  }) => Promise<void>;
  onCancel: () => void;
}

export function VehicleForm({ onSubmit, onCancel }: VehicleFormProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<VehicleType>('TRUCK');
  const [makeSearch, setMakeSearch] = useState('');
  const [selectedMake, setSelectedMake] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  // 65 years back covers pretty much any vehicle still legitimately in
  // service (Soviet-era KAMAZ/MAZ/UAZ trucks and classic cars are common
  // in the CIS fleet this app targets), not just recent models.
  const years = useMemo(() => Array.from({ length: 65 }, (_, i) => currentYear - i), [currentYear]);
  const [year, setYear] = useState(currentYear);
  const [showMakeDropdown, setShowMakeDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const makeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  const fuelType = getFuelType(selectedMake, selectedModel);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const makesForType = type === 'TRUCK' ? TRUCK_MAKES : CAR_MAKES;

  const filteredMakes = Object.keys(makesForType)
    .filter((m) => m.toLowerCase().includes(makeSearch.toLowerCase()))
    .sort();

  const models = selectedMake ? makesForType[selectedMake] || [] : [];
  const filteredModels = models.filter((m) =>
    m.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (makeRef.current && !makeRef.current.contains(e.target as Node)) setShowMakeDropdown(false);
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setShowModelDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = async () => {
    if (!selectedMake || !selectedModel) return;
    setIsSubmitting(true);
    try {
      await onSubmit({
        type,
        make: selectedMake,
        model: selectedModel,
        year,
        fuelType,
      });
      setSelectedMake('');
      setSelectedModel('');
      setYear(new Date().getFullYear());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 mb-1">
        <button type="button"
          onClick={() => { setType('TRUCK'); setSelectedMake(''); setSelectedModel(''); setMakeSearch(''); setModelSearch(''); }}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
            type === 'TRUCK' ? 'bg-accent-500/10 border-accent-500/20 text-accent-300' : 'bg-white/5 border-dark-border text-gray-400'
          }`}>
          <FaTruck size={14} /> {t('vehicleForm.truck')}
        </button>
        <button type="button"
          onClick={() => { setType('CAR'); setSelectedMake(''); setSelectedModel(''); setMakeSearch(''); setModelSearch(''); }}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
            type === 'CAR' ? 'bg-accent-500/10 border-accent-500/20 text-accent-300' : 'bg-white/5 border-dark-border text-gray-400'
          }`}>
          <FaCar size={14} /> {t('vehicleForm.car')}
        </button>
      </div>

      <div className="relative" ref={makeRef}>
        <label className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.make')}</label>
        <input type="text" value={makeSearch || selectedMake}
          onChange={(e) => { setMakeSearch(e.target.value); setShowMakeDropdown(true); setSelectedMake(''); setSelectedModel(''); }}
          onFocus={() => setShowMakeDropdown(true)}
          className="input-field pr-8 text-sm" placeholder={t('vehicleForm.makePlaceholder')} />
        <FaChevronDown size={10} className="absolute right-3 bottom-3 text-gray-500 pointer-events-none" />
        {showMakeDropdown && (
          <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-dark-card border border-dark-border rounded-xl max-h-36 overflow-y-auto shadow-2xl">
            {filteredMakes.map((m) => (
              <button key={m} type="button" onClick={() => { setSelectedMake(m); setMakeSearch(m); setShowMakeDropdown(false); setModelSearch(''); }}
                className="w-full text-left px-3 py-2 text-xs text-white hover:bg-white/5 transition-all truncate">
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative" ref={modelRef}>
        <label className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.model')}</label>
        <input type="text" value={modelSearch || selectedModel}
          onChange={(e) => { setModelSearch(e.target.value); setShowModelDropdown(true); setSelectedModel(''); }}
          onFocus={() => setShowModelDropdown(true)}
          disabled={!selectedMake}
          className="input-field pr-8 text-sm disabled:opacity-50" placeholder={t('vehicleForm.modelPlaceholder')} />
        <FaChevronDown size={10} className="absolute right-3 bottom-3 text-gray-500 pointer-events-none" />
        {showModelDropdown && (
          <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-dark-card border border-dark-border rounded-xl max-h-36 overflow-y-auto shadow-2xl">
            {filteredModels.map((m) => (
              <button key={m} type="button" onClick={() => { setSelectedModel(m); setModelSearch(m); setShowModelDropdown(false); }}
                className="w-full text-left px-3 py-2 text-xs text-white hover:bg-white/5 transition-all truncate">
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.year')}</label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="input-field text-sm">
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={handleSubmit} disabled={!selectedMake || !selectedModel || isSubmitting}
          className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-50">
          {t('vehicleForm.save')}
        </button>
        <button onClick={onCancel}
          className="px-4 btn-secondary text-sm">
          {t('vehicleForm.cancel')}
        </button>
      </div>
    </div>
  );
}
