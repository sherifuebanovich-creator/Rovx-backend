'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useTranslation } from 'react-i18next';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { FaArrowLeft, FaRoute, FaMap, FaStar, FaTrophy, FaEdit, FaCrown, FaUser, FaCar, FaTruck, FaTrash, FaPlus, FaCheck, FaTimes, FaPhone, FaHome, FaBriefcase, FaMapMarkerAlt, FaCamera } from 'react-icons/fa';
import { usersApi } from '@/lib/api';
import { getFuelType } from '@/lib/fuelMap';
import { Vehicle } from '@/types';
import toast from 'react-hot-toast';

const CAR_MAKES_LIST = [
  'Abarth','Acura','Aixam','Alfa Romeo','Alpine','Aston Martin','Audi','BAW','Bentley','BMW','Brilliance',
  'Bugatti','Buick','BYD','Cadillac','Caterham','Changhe','Chery','Chevrolet','Chrysler','Citroen','Cupra',
  'Dacia','Daewoo','Daihatsu','Datsun','Dodge','DS','FAW','Ferrari','Fiat','Ford','Forthing','Foton',
  'Geely','Genesis','GMC','Great Wall','Haval','Honda','Hummer','Hyundai','Infiniti','Iran Khodro','Isuzu',
  'JAC','Jaguar','Jeep','Jetour','Kia','Koenigsegg','Lada','Lamborghini','Lancia','Land Rover','Lexus',
  'Lifan','Lincoln','Lotus','Lucid','Luxgen','Maserati','Mazda','McLaren','Mercedes-Benz','Mercury','MG',
  'Microcar','Mini','Mitsubishi','Morgan','Moskvich','NIO','Nissan','Oldsmobile','Opel','Ora','Peugeot',
  'Polestar','Pontiac','Porsche','Proton','RAM','Ravon','Renault','Rivian','Rolls-Royce','Saab','Saturn',
  'SAIC','SEAT','Skoda','Smart','SsangYong','Subaru','Suzuki','TagAZ','Tesla','Toyota','Trabant','UAZ',
  'Vauxhall','VinFast','Volkswagen','Volvo','Vortex','Voyah','Wartburg','Xiaomi','XPeng','Zaporozhets','ZAZ','Zeekr','Zotye',
];

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, setUser } = useAuthStore();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const years = useMemo(() => Array.from({ length: currentYear - 1969 + 1 }, (_, i) => currentYear - i), [currentYear]);
  const [addForm, setAddForm] = useState({ type: 'CAR' as 'CAR' | 'TRUCK', make: '', model: '', year: currentYear });
  const [addLoading, setAddLoading] = useState(false);

  // Edit profile state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ displayName: '', username: '', bio: '', phone: '', city: '', homeAddress: '', workAddress: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [avatarFile, setAvatarFile] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    usersApi.getVehicles()
      .then(res => setVehicles(res.data.data || res.data))
      .catch(() => {})
      .finally(() => setVehiclesLoading(false));
  }, [user]);

  const startEditing = () => {
    setEditForm({
      displayName: user?.displayName || '',
      username: user?.username || '',
      bio: user?.bio || '',
      phone: user?.phone || '',
      city: user?.city || '',
      homeAddress: user?.homeAddress || '',
      workAddress: user?.workAddress || '',
    });
    setEditing(true);
  };

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(t('profile.avatarTooLarge'));
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setAvatarFile(dataUrl);
  };

  const handleSaveProfile = async () => {
    if (!editForm.displayName.trim()) {
      toast.error(t('profile.displayNameRequired'));
      return;
    }
    setEditLoading(true);
    try {
      const payload: any = {
        displayName: editForm.displayName.trim(),
        username: editForm.username.trim(),
        bio: editForm.bio.trim(),
        phone: editForm.phone.trim(),
        city: editForm.city.trim(),
        homeAddress: editForm.homeAddress.trim(),
        workAddress: editForm.workAddress.trim(),
      };
      if (avatarFile) {
        payload.avatar = avatarFile;
      }
      const res = await usersApi.updateProfile(payload);
      const updated = res.data.data || res.data;
      setUser({ ...user!,
        displayName: updated.displayName,
        username: updated.username,
        bio: updated.bio,
        phone: updated.phone,
        city: updated.city,
        homeAddress: updated.homeAddress,
        workAddress: updated.workAddress,
        avatar: updated.avatar || user!.avatar,
      });
      setEditing(false);
      setAvatarFile(null);
      toast.success(t('profile.profileUpdated'));
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to update profile';
      toast.error(msg);
    } finally {
      setEditLoading(false);
    }
  };

  const handleAddVehicle = async () => {
    if (!addForm.make || !addForm.model) {       toast.error(t('profile.selectMakeModel')); return; }
    setAddLoading(true);
    try {
      const fuelType = getFuelType(addForm.make, addForm.model);
      const res = await usersApi.addVehicle({ ...addForm, fuelType, name: `${addForm.make} ${addForm.model}` });
      const newVehicle = res.data.data || res.data;
      setVehicles(prev => [...prev, newVehicle]);
      setShowAddForm(false);
      setAddForm({ type: 'CAR', make: '', model: '', year: currentYear });
      toast.success(t('profile.vehicleAdded'));
    } catch {
      toast.error(t('profile.vehicleAddFailed'));
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteVehicle = async (id: string) => {
    try {
      await usersApi.deleteVehicle(id);
      setVehicles(prev => prev.filter(v => v.id !== id));
      toast.success(t('profile.vehicleRemoved'));
    } catch {
      toast.error(t('profile.vehicleRemoveFailed'));
    }
  };

  if (!user) {
    return (
      <div className="min-h-dvh bg-dark-bg flex flex-col items-center justify-center gap-4 px-6 safe-bottom safe-top">
        <FaUser size={48} className="text-gray-600" />
          <h2 className="text-white font-bold text-xl text-center">{t('profile.notSignedIn')}</h2>
        <Link href="/auth/login" className="btn-primary px-6 py-3">{t('profile.signIn')}</Link>
        <button onClick={() => router.back()} className="text-gray-400 text-sm">{t('profile.goBack')}</button>
      </div>
    );
  }

  const stats = [
    { label: t('profile.totalTrips'), value: user.totalTrips ?? 0, icon: <FaRoute size={18} />, color: 'text-primary-400' },
    { label: t('profile.distanceKm'), value: Math.round(user.totalDistance ?? 0), icon: <FaMap size={18} />, color: 'text-blue-400' },
    { label: t('profile.driverScore'), value: user.driverScore?.toFixed(1) ?? '5.0', icon: <FaStar size={18} />, color: 'text-yellow-400' },
    { label: t('profile.reputation'), value: user.reputation ?? 0, icon: <FaTrophy size={18} />, color: 'text-accent-400' },
  ];

  const tierColors: Record<string, string> = {
    FREE: 'text-gray-400', PREMIUM_BASIC: 'text-primary-400', PREMIUM_STANDARD: 'text-accent-400', PREMIUM_MAX: 'text-yellow-400',
  };
  const tierLabels: Record<string, string> = {
    FREE: t('premium.free'), PREMIUM_BASIC: t('premium.basic'), PREMIUM_STANDARD: t('premium.standard'), PREMIUM_MAX: t('premium.max'),
  };

  return (
    <div className="min-h-dvh bg-dark-bg">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-primary-900/30 to-transparent" />
      </div>
      <div className="relative px-4 sm:px-6 pt-14 pb-safe-bottom pb-12 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('profile.back')}
        </button>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center mb-8">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-4xl font-bold text-white mb-4 shadow-glow-primary overflow-hidden relative">
            {editing ? (
              <>
                <div onClick={() => avatarInputRef.current?.click()} className="w-full h-full flex items-center justify-center cursor-pointer group">
                  {avatarFile ? (
                    <img src={avatarFile} className="w-full h-full object-cover" />
                  ) : user.avatar ? (
                    <Image src={user.avatar} alt={user.displayName} width={96} height={96} className="object-cover" />
                  ) : (
                    <span>{(user.displayName ?? '?')[0].toUpperCase()}</span>
                  )}
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <FaCamera size={20} className="text-white" />
                  </div>
                </div>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
              </>
            ) : (
              <>
                {user.avatar ? <Image src={user.avatar} alt={user.displayName} width={96} height={96} className="object-cover" /> : (user.displayName ?? '?')[0].toUpperCase()}
              </>
            )}
            <button onClick={startEditing} className="absolute bottom-0 right-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center border-2 border-dark-bg">
              <FaEdit size={12} className="text-white" />
            </button>
          </div>
          {editing ? (
            <div className="w-full mt-3">
              <div className="card p-4 space-y-3">
                <input
                  value={editForm.displayName}
                  onChange={e => setEditForm(p => ({ ...p, displayName: e.target.value }))}
                  className="input-field text-center text-lg font-bold"
                  placeholder={t('profile.displayNamePlaceholder')}
                />
                <input
                  value={editForm.username}
                  onChange={e => setEditForm(p => ({ ...p, username: e.target.value }))}
                  className="input-field text-center text-sm"
                  placeholder={t('profile.usernamePlaceholder')}
                />
                <textarea
                  value={editForm.bio}
                  onChange={e => setEditForm(p => ({ ...p, bio: e.target.value }))}
                  className="input-field text-center text-sm resize-none"
                  rows={2}
                  placeholder={t('profile.bioPlaceholder')}
                />

                <div className="border-t border-dark-border pt-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <FaPhone size={14} className="text-primary-400 flex-shrink-0" />
                    <input
                      value={editForm.phone}
                      onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                      className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                      placeholder={t('profile.phonePlaceholder') || 'Phone'}
                      type="tel"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <FaMapMarkerAlt size={14} className="text-primary-400 flex-shrink-0" />
                    <input
                      value={editForm.city}
                      onChange={e => setEditForm(p => ({ ...p, city: e.target.value }))}
                      className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                      placeholder={t('profile.cityPlaceholder') || 'City'}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <FaHome size={14} className="text-primary-400 flex-shrink-0" />
                    <input
                      value={editForm.homeAddress}
                      onChange={e => setEditForm(p => ({ ...p, homeAddress: e.target.value }))}
                      className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                      placeholder={t('profile.homeAddressPlaceholder') || 'Home address'}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <FaBriefcase size={14} className="text-primary-400 flex-shrink-0" />
                    <input
                      value={editForm.workAddress}
                      onChange={e => setEditForm(p => ({ ...p, workAddress: e.target.value }))}
                      className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                      placeholder={t('profile.workAddressPlaceholder') || 'Work address'}
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-center mt-3">
                <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl bg-white/5 text-gray-400 text-sm hover:bg-white/10 transition-all flex items-center gap-1">
                  <FaTimes size={12} /> {t('common.cancel')}
                </button>
                <button onClick={handleSaveProfile} disabled={editLoading} className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm hover:bg-primary-500 transition-all flex items-center gap-1 disabled:opacity-50">
                  {editLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><FaCheck size={12} /> {t('common.save')}</>}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-black text-white font-display">{user.displayName}</h1>
              <p className="text-gray-400 text-sm">@{user.username}</p>
              {user.bio && <p className="text-gray-500 text-xs mt-1 text-center max-w-xs">{user.bio}</p>}
              <div className="flex items-center gap-1 mt-2">
                <FaCrown size={12} className={tierColors[user.subscription]} />
                <span className={`text-sm font-semibold ${tierColors[user.subscription]}`}>{tierLabels[user.subscription] || user.subscription}</span>
              </div>
              <p className="text-gray-500 text-xs mt-1">{user.email}</p>
              {(user.phone || user.city) && (
                <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
                  {user.phone && <span className="flex items-center gap-1"><FaPhone size={10} /> {user.phone}</span>}
                  {user.city && <span className="flex items-center gap-1"><FaMapMarkerAlt size={10} /> {user.city}</span>}
                </div>
              )}
              {(user.homeAddress || user.workAddress) && (
                <div className="flex flex-col items-center gap-1 mt-2 text-xs text-gray-500">
                  {user.homeAddress && <span className="flex items-center gap-1"><FaHome size={10} /> {user.homeAddress}</span>}
                  {user.workAddress && <span className="flex items-center gap-1"><FaBriefcase size={10} /> {user.workAddress}</span>}
                </div>
              )}
            </>
          )}
        </motion.div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          {stats.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
              className="card p-4 flex flex-col gap-2">
              <span className={s.color}>{s.icon}</span>
              <p className="text-2xl font-black text-white">{s.value}</p>
              <p className="text-xs text-gray-400">{s.label}</p>
            </motion.div>
          ))}
        </div>

        {/* My Vehicles */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-bold text-base">{t('profile.myVehicles')}</h2>
            <button onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary-400 hover:text-primary-300 transition-all">
              <FaPlus size={10} /> {t('profile.add')}
            </button>
          </div>

          {vehiclesLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : vehicles.length === 0 ? (
            <div className="card p-4 text-center">
              <FaCar size={24} className="text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-400">{t('profile.noVehicles')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {vehicles.map(v => (
                <div key={v.id} className="card p-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm ${
                    v.fuelType === 'ELECTRIC' ? 'bg-green-600/20 text-green-400' :
                    v.fuelType === 'DIESEL' ? 'bg-orange-600/20 text-orange-400' :
                    'bg-yellow-600/20 text-yellow-400'
                  }`}>
                    {v.type === 'TRUCK' ? <FaTruck size={14} /> : <FaCar size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{v.make} {v.model}</p>
                    <p className="text-xs text-gray-500">{v.year} · {v.fuelType}</p>
                  </div>
                  <button onClick={() => handleDeleteVehicle(v.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
                    <FaTrash size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Vehicle Form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="card p-4 mb-6"
            >
              <p className="text-white text-sm font-semibold mb-3">{t('profile.addVehicle')}</p>

              {/* Type toggle */}
              <div className="flex gap-2 mb-3">
                <button type="button" onClick={() => setAddForm(p => ({ ...p, type: 'CAR', make: '', model: '' }))}
                  className={`flex-1 flex items-center justify-center gap-2 h-9 rounded-xl text-sm font-medium transition-all border ${
                    addForm.type === 'CAR'
                      ? 'bg-primary-600/30 border-primary-500/50 text-white'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                  }`}>
                   <FaCar size={13} /> {t('profile.car')}
                </button>
                <button type="button" onClick={() => setAddForm(p => ({ ...p, type: 'TRUCK', make: '', model: '' }))}
                  className={`flex-1 flex items-center justify-center gap-2 h-9 rounded-xl text-sm font-medium transition-all border ${
                    addForm.type === 'TRUCK'
                      ? 'bg-primary-600/30 border-primary-500/50 text-white'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                  }`}>
                   <FaTruck size={13} /> {t('profile.truck')}
                </button>
              </div>

              {/* Make */}
              <div className="mb-2">
                <select value={addForm.make} onChange={e => setAddForm(p => ({ ...p, make: e.target.value }))}
                  className="input-field text-sm">
                  <option value="">{t('profile.selectMake')}</option>
                  {CAR_MAKES_LIST.filter(m => addForm.type === 'TRUCK'
                    ? ['Ford','Isuzu','RAM','Toyota','Volkswagen'].includes(m)
                    : true
                  ).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              {/* Model */}
              <div className="mb-2">
                <input type="text" value={addForm.model} onChange={e => setAddForm(p => ({ ...p, model: e.target.value }))}
                  className="input-field text-sm" placeholder={t('profile.modelName')} disabled={!addForm.make} />
              </div>

              {/* Year */}
              <div className="mb-3">
                <select value={addForm.year} onChange={e => setAddForm(p => ({ ...p, year: Number(e.target.value) }))}
                  className="input-field text-sm appearance-none">
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {/* Auto-detected fuel type */}
              {addForm.make && addForm.model && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 mb-3">
                  <span className="text-xs text-gray-400">{t('profile.fuel')}</span>
                  <span className={`text-xs font-semibold ${
                    getFuelType(addForm.make, addForm.model) === 'ELECTRIC' ? 'text-green-400' :
                    getFuelType(addForm.make, addForm.model) === 'DIESEL' ? 'text-orange-400' :
                    'text-yellow-400'
                  }`}>
                    {getFuelType(addForm.make, addForm.model)}
                  </span>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setShowAddForm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 transition-all">
                  {t('profile.cancel')}
                </button>
                <button onClick={handleAddVehicle} disabled={addLoading || !addForm.make || !addForm.model}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary-600 text-white hover:bg-primary-500 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {addLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t('profile.add')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Link href="/settings" className="card p-4 flex items-center gap-3 hover:bg-white/5 transition-all">
          <FaEdit size={16} className="text-primary-400" />
          <span className="text-white text-sm font-medium flex-1">{t('profile.editProfileFull')}</span>
          <FaArrowLeft size={12} className="text-gray-500 rotate-180" />
        </Link>
      </div>
    </div>
  );
}