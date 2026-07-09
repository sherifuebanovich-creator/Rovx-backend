'use client';
import { FaTruck } from 'react-icons/fa';
import { useMapStore } from '@/store/map.store';
import { useTranslation } from 'react-i18next';

export function VehicleModeToggle() {
  const { t } = useTranslation();
  const { setVehicleMode } = useMapStore();

  return (
    <div className="glass-dark rounded-xl p-1 flex flex-col md:flex-row gap-1">
      <button onClick={() => setVehicleMode('TRUCK')}
        className={`w-10 h-10 md:w-12 md:h-12 rounded-lg flex items-center justify-center transition-all bg-accent-500 text-white shadow-glow-accent`}
        title={t('vehicleModeToggle.truckMode')}>
        <FaTruck size={18} />
      </button>
    </div>
  );
}
