'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { FaArrowLeft, FaTrash, FaRegBookmark, FaStar } from 'react-icons/fa';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { mapApi } from '@/lib/api';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';

interface BookmarkItem {
  id: string;
  mapObjectId?: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  category?: string;
  rating?: number;
}

export default function BookmarksPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // A guest's 401 here used to fall through to the same empty
    // `bookmarks: []` state as "you genuinely have none" — the loadFailed
    // toast fired but disappeared in a few seconds, leaving a permanently
    // misleading "no bookmarks yet" screen with no indication signing in
    // would actually show something. Skip the fetch and show a proper
    // sign-in prompt instead, matching Friends/Groups/Routes.
    if (!user) { setIsLoading(false); return; }
    mapApi.getBookmarks()
      .then((res) => setBookmarks(res.data.data || res.data || []))
      .catch(() => toast.error(t('bookmarks.loadFailed')))
      .finally(() => setIsLoading(false));
  }, [user, t]);

  const handleDelete = async (id: string) => {
    try {
      await mapApi.deleteBookmark(id);
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
      toast.success(t('bookmarks.removed'));
    } catch {
      toast.error(t('bookmarks.removeFailed'));
    }
  };

  const CATEGORY_EMOJI: Record<string, string> = {
    SHOP: '🛒', SUPERMARKET: '🏪', GAS_STATION: '⛽', EV_CHARGER: '🔌',
    PARKING: '🅿️', CAFE: '☕', RESTAURANT: '🍽️', HOTEL: '🏨',
    CAR_SERVICE: '🔩', TIRE_SERVICE: '🔧', CAR_WASH: '🧽', HOME: '🏠', WORK: '💼',
  };

  const getEmoji = (cat?: string) => CATEGORY_EMOJI[cat || ''] || '📍';

  if (!user) {
    return (
      <div className="min-h-dvh bg-dark-bg flex flex-col items-center justify-center gap-4 px-6">
        <FaRegBookmark size={48} className="text-gray-600" />
        <h2 className="text-white font-bold text-xl text-center">{t('bookmarks.loginRequired')}</h2>
        <button onClick={() => router.push('/auth/login')} className="btn-primary px-6 py-3">{t('bookmarks.signIn')}</button>
        <button onClick={() => router.back()} className="text-gray-400 text-sm">{t('bookmarks.back')}</button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-dark-bg">
      <div className="relative px-4 sm:px-6 pt-14 pb-safe-bottom pb-12 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('bookmarks.back')}
        </button>
        <h1 className="text-2xl font-black text-white font-display mb-6">{t('bookmarks.title')}</h1>

        {isLoading ? (
          <div className="flex flex-col items-center py-20 gap-4">
            <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            <p className="text-gray-400 text-center">{t('bookmarks.loading')}</p>
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="flex flex-col items-center py-20 gap-4">
            <FaRegBookmark size={48} className="text-gray-600" />
            <p className="text-gray-400 text-center">{t('bookmarks.empty')}</p>
            <p className="text-gray-600 text-xs text-center">{t('bookmarks.hint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookmarks.map((b, i) => (
              <motion.div key={b.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
                className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-600/20 flex items-center justify-center flex-shrink-0 text-xl">
                  {getEmoji(b.category)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{b.name}</p>
                  {b.address && <p className="text-gray-400 text-xs truncate">{b.address}</p>}
                  {b.rating && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <FaStar size={9} className="text-yellow-400" />
                      <span className="text-[10px] text-yellow-400">{b.rating.toFixed(1)}</span>
                    </div>
                  )}
                </div>
                <button onClick={() => handleDelete(b.id)}
                  className="text-gray-600 hover:text-red-400 transition-all p-1">
                  <FaTrash size={13} />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
