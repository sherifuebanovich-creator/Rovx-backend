'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { FaArrowLeft } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { usersApi } from '@/lib/api';

interface Achievement {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  points: number;
  category: string;
  earned: boolean;
  earnedAt: string | null;
}

export default function AchievementsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    usersApi.getAchievements()
      .then((res) => {
        const data = res.data?.data || res.data || [];
        setAchievements(Array.isArray(data) ? data : []);
      })
      .catch(() => setAchievements([]))
      .finally(() => setLoading(false));
  }, []);

  const earned = achievements.filter((a) => a.earned).length;

  return (
    <div className="min-h-dvh bg-dark-bg">
      <div className="relative px-4 sm:px-6 pt-14 pb-safe-bottom pb-12 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('achievements.back')}
        </button>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black text-white font-display">{t('achievements.title')}</h1>
          {!loading && (
            <span className="text-sm text-gray-400 bg-white/5 px-3 py-1 rounded-full">{earned}/{achievements.length}</span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary-400/30 border-t-primary-400 rounded-full animate-spin" />
          </div>
        ) : achievements.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-12">{t('achievements.empty') || 'Нет данных'}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {achievements.map((a, i) => (
              <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className={`card p-4 flex flex-col items-center text-center gap-2 ${!a.earned ? 'opacity-40' : ''}`}>
                <span className="text-3xl">{a.earned ? a.icon : '🔒'}</span>
                <p className={`text-sm font-bold ${a.earned ? 'text-white' : 'text-gray-400'}`}>{a.name}</p>
                <p className="text-[11px] text-gray-500">{a.description}</p>
                {a.earned && <span className="text-[10px] bg-primary-600/30 text-primary-400 px-2 py-0.5 rounded-full font-semibold">{t('achievements.earned')}</span>}
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
