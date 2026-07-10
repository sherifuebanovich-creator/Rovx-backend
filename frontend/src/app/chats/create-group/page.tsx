'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { socialApi } from '@/lib/api';
import { motion } from 'framer-motion';
import { FaArrowLeft, FaCrown, FaImage, FaCheck } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function CreateGroupPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [avatar, setAvatar] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMax = user?.subscription === 'PREMIUM_MAX';

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(t('profile.avatarTooLarge') || 'Image too large (max 2MB)');
      return;
    }
    if (!file.type.match(/^image\/(jpeg|png|webp|gif)$/)) {
      toast.error(t('profile.avatarInvalidType') || 'Only JPEG, PNG, WebP, GIF allowed');
      return;
    }
    setAvatarFile(file);
    const preview = URL.createObjectURL(file);
    setAvatar(preview);
  };

  const handleCreate = async () => {
    if (!name.trim()) { toast.error(t('createGroup.enterName')); return; }
    if (!isMax) { toast.error(t('createGroup.premiumRequired')); return; }
    setLoading(true);
    try {
      const res = await socialApi.createGroup({ name: name.trim(), description: description.trim(), city: city.trim() || undefined, isPublic });
      const group = res.data?.data || res.data;
      if (avatarFile && group.id) {
        try {
          await socialApi.uploadGroupAvatar(group.id, avatarFile);
        } catch {
          // Avatar upload failed, group still created
        }
      }
      toast.success(t('createGroup.created'));
      router.push(`/groups/${group.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('createGroup.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!isMax) {
    return (
      <div className="min-h-dvh bg-dark-bg flex flex-col items-center justify-center gap-4 px-6">
        <FaCrown size={48} className="text-yellow-400" />
        <h2 className="text-white font-bold text-xl text-center">{t('createGroup.onlyPremium')}</h2>
        <p className="text-gray-400 text-sm text-center max-w-xs">{t('createGroup.premiumDescription')}</p>
        <button onClick={() => router.push('/premium')} className="btn-accent px-6 py-3">{t('createGroup.buyPremium')}</button>
        <button onClick={() => router.back()} className="text-gray-500 text-sm">{t('createGroup.back')}</button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-dark-bg pb-safe-bottom">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-primary-900/30 to-transparent" />
      </div>
      <div className="relative px-4 pt-14 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('createGroup.back')}
        </button>

        <h1 className="text-2xl font-black text-white font-display mb-8">{t('createGroup.title')}</h1>

        <div className="card p-6 space-y-6">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div onClick={() => fileInputRef.current?.click()}
              className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center text-white text-3xl font-bold cursor-pointer hover:opacity-80 transition-all overflow-hidden">
              {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : <FaImage size={28} />}
            </div>
            <button onClick={() => fileInputRef.current?.click()} className="text-xs text-primary-400 hover:text-primary-300">
              {t('createGroup.uploadPhoto')}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
          </div>

          {/* Name */}
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">{t('createGroup.nameLabel')}</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="input-field text-sm" placeholder={t('createGroup.namePlaceholder')} maxLength={50} />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">{t('createGroup.descriptionLabel')}</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              className="input-field text-sm resize-none" placeholder={t('createGroup.descriptionPlaceholder')} rows={3} maxLength={200} />
          </div>

          {/* City */}
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">{t('createGroup.cityLabel')}</label>
            <input value={city} onChange={e => setCity(e.target.value)}
              className="input-field text-sm" placeholder={t('createGroup.cityPlaceholder')} />
          </div>

          {/* Public toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={() => setIsPublic(!isPublic)}
              className={`w-10 h-6 rounded-full transition-all flex items-center px-0.5 ${isPublic ? 'bg-primary-600 justify-end' : 'bg-white/10 justify-start'}`}>
              <div className="w-5 h-5 rounded-full bg-white" />
            </div>
            <div>
              <p className="text-sm text-white font-medium">{t('createGroup.publicLabel')}</p>
              <p className="text-xs text-gray-500">{t('createGroup.publicDescription')}</p>
            </div>
          </label>

          {/* Submit */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-primary-600 to-accent-600 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <><FaCheck size={14} /> {t('createGroup.submit')}</>
            )}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
