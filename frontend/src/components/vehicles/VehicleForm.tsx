'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FaCar, FaTruck, FaChevronDown } from 'react-icons/fa';
import { getFuelType } from '@/lib/fuelMap';
import { CAR_MAKES, TRUCK_MAKES, getYearsForMake } from '@/lib/vehicleMakes';
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
  // Clamped to the selected make's real production span (discontinued
  // brands stop at their last model year; newer brands start where they
  // were actually founded) instead of a blanket range for every brand.
  const years = useMemo(() => getYearsForMake(selectedMake, currentYear), [selectedMake, currentYear]);
  const [year, setYear] = useState(currentYear);

  // Picking a make with a narrower production span (e.g. a discontinued
  // brand) left `year` at whatever was previously selected, which could fall
  // outside the new `years` list — the <select> then matched no <option>,
  // silently submitting a year the vehicle was never made in.
  useEffect(() => {
    if (years.length > 0 && !years.includes(year)) {
      setYear(years[0]);
    }
  }, [years]);
  const [showMakeDropdown, setShowMakeDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const makeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  const fuelType = getFuelType(selectedMake, selectedModel);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // handleSubmit previously relied solely on the JSX `disabled` prop, which
  // isn't updated until React re-renders — a double-tap/double-click fired
  // in the same task called onSubmit (addVehicle) twice before that commit.
  const submittingRef = useRef(false);

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
    if (submittingRef.current) return;
    if (!selectedMake || !selectedModel) return;
    submittingRef.current = true;
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
      submittingRef.current = false;
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
        <label htmlFor="vehicleform-make" className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.make')}</label>
        <input id="vehicleform-make" type="text" value={makeSearch || selectedMake}
          role="combobox" aria-expanded={showMakeDropdown} aria-haspopup="listbox"
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
        <label htmlFor="vehicleform-model" className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.model')}</label>
        <input id="vehicleform-model" type="text" value={modelSearch || selectedModel}
          role="combobox" aria-expanded={showModelDropdown} aria-haspopup="listbox"
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
        <label htmlFor="vehicleform-year" className="block text-xs text-gray-400 mb-1 font-medium">{t('vehicleForm.year')}</label>
        <select id="vehicleform-year" value={year} onChange={(e) => setYear(Number(e.target.value))}
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
