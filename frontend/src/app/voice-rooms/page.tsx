'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { voiceRoomsApi } from '@/lib/api';
import { mediaUrl } from '@/lib/media';
import { VoiceRoom } from '@/types';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { FaArrowLeft, FaWalkieTalkie, FaPlus, FaUsers, FaRightToBracket } from 'react-icons/fa6';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function VoiceRoomsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);

  const fetchRooms = () => {
    voiceRoomsApi.list()
      .then((res) => setRooms(res.data?.data || res.data || []))
      .catch(() => toast.error(t('voiceRooms.loadFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    fetchRooms();
    // Live participant counts drift the moment anyone joins/leaves a room
    // elsewhere — a lightweight poll is enough for a browse list (the room
    // screen itself gets real-time updates over the voice socket).
    const interval = setInterval(fetchRooms, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleCreate = async () => {
    if (creatingRef.current) return;
    if (!newName.trim()) { toast.error(t('voiceRooms.enterName')); return; }
    creatingRef.current = true;
    setCreating(true);
    try {
      const res = await voiceRoomsApi.create(newName.trim());
      const room = res.data?.data || res.data;
      setShowCreate(false);
      setNewName('');
      router.push(`/voice-rooms/${room.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('voiceRooms.createFailed'));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-dvh bg-dark-bg flex flex-col items-center justify-center gap-4 px-4">
        <h2 className="text-lg font-bold text-white">{t('voiceRooms.loginRequired')}</h2>
        <Link href="/auth/login" className="btn-primary px-6 py-3">{t('voiceRooms.login')}</Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-dark-bg pb-safe-bottom">
      <div className="px-4 pt-12 sm:pt-16 max-w-2xl mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('voiceRooms.back')}
        </button>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black text-white font-display flex items-center gap-2">
            <FaWalkieTalkie className="text-primary-400" /> {t('voiceRooms.title')}
          </h1>
          <button onClick={() => setShowCreate(true)} className="btn-primary px-4 py-2 flex items-center gap-2 text-sm">
            <FaPlus size={12} /> {t('voiceRooms.create')}
          </button>
        </div>

        {showCreate && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="card p-4 mb-4 flex flex-col gap-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder={t('voiceRooms.namePlaceholder')}
              maxLength={50}
              className="input-field"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={creating} className="btn-primary flex-1 py-2.5 disabled:opacity-60">
                {creating ? t('voiceRooms.creating') : t('voiceRooms.create')}
              </button>
              <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1 py-2.5">
                {t('voiceRooms.cancel')}
              </button>
            </div>
          </motion.div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <FaWalkieTalkie size={40} className="mx-auto mb-3 opacity-40" />
            <p>{t('voiceRooms.empty')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rooms.map((room) => (
              <button
                key={room.id}
                onClick={() => router.push(`/voice-rooms/${room.id}`)}
                className="w-full card p-4 flex items-center gap-3 hover:bg-white/5 transition-all text-left"
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {room.owner?.avatar ? (
                    <img src={mediaUrl(room.owner.avatar)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <FaWalkieTalkie className="text-white" size={18} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate">{room.name}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    <FaUsers size={10} /> {room.participantCount}/{room.maxParticipants}
                    {' · '}{room.owner?.displayName}
                  </p>
                </div>
                <FaRightToBracket className="text-primary-400 flex-shrink-0" size={16} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
