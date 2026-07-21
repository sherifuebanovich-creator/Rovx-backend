'use client';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FaArrowLeft, FaBell, FaRoute, FaExclamationTriangle } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { socialApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { getSocket } from '@/hooks/useSocket';

export default function NotificationsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [notifs, setNotifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchNotifs = useCallback(() => {
    if (!user) return;
    socialApi.getNotifications(1)
      .then(res => {
        const data = res.data.data || res.data;
        setNotifs(data.notifications || data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    fetchNotifs();
    if (user) {
      socialApi.markNotificationsRead().catch(() => {});
    }
  }, [fetchNotifs, user]);

  useEffect(() => {
    if (!user) return;
    const onNewNotification = () => {
      fetchNotifs();
    };
    // The global socket may not exist yet at mount — poll briefly instead
    // of giving up, otherwise this page never receives live updates.
    let socket = getSocket();
    let interval: ReturnType<typeof setInterval> | null = null;
    if (socket) {
      socket.on('notification:new', onNewNotification);
    } else {
      interval = setInterval(() => {
        socket = getSocket();
        if (socket) {
          socket.on('notification:new', onNewNotification);
          if (interval) clearInterval(interval);
        }
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
      socket?.off('notification:new', onNewNotification);
    };
  }, [user, fetchNotifs]);

  const unread = notifs.filter(n => !n.isRead).length;

  const getIcon = (type: string) => {
    switch (type) {
      case 'report': return <FaExclamationTriangle size={14} />;
      case 'route': return <FaRoute size={14} />;
      default: return <FaBell size={14} />;
    }
  };

  const colorMap: Record<string, string> = {
    report: 'text-orange-400 bg-orange-600/20',
    route: 'text-primary-400 bg-primary-600/20',
    info: 'text-gray-400 bg-white/10',
  };

  const handleDeleteAll = async () => {
    if (!window.confirm(t('notifications.deleteAllConfirm'))) return;
    setIsDeleting(true);
    try {
      await socialApi.deleteAllNotifications();
      setNotifs([]);
      toast.success(t('notifications.deleted'));
    } catch {
      toast.error(t('notifications.deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  };

  const formatTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.max(0, Math.floor(diff / 60000));
    if (mins < 60) return t('notifications.minAgo', { mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('notifications.hoursAgo', { hours });
    const days = Math.floor(hours / 24);
    return t('notifications.daysAgo', { days });
  };

  if (!user) {
    return (
      <div className="min-h-dvh bg-dark-bg flex flex-col items-center justify-center gap-4 px-6">
        <FaBell size={48} className="text-gray-600" />
        <p className="text-gray-400">{t('notifications.empty')}</p>
        <button onClick={() => router.push('/auth/register')} className="btn-primary px-6 py-3">{t('notifications.signIn')}</button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-dark-bg">
      <div className="relative px-4 sm:px-6 pt-14 pb-safe-bottom pb-12 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('notifications.back')}
        </button>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black text-white font-display">{t('notifications.title')}</h1>
          <div className="flex items-center gap-2">
            {notifs.length > 0 && (
              <button
                onClick={handleDeleteAll}
                disabled={isDeleting}
                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-all"
              >
                {isDeleting ? '...' : t('notifications.deleteAll')}
              </button>
            )}
            {unread > 0 && <span className="text-xs bg-accent-500 text-white px-2 py-0.5 rounded-full font-bold">{unread} {t('notifications.new')}</span>}
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notifs.length === 0 ? (
          <div className="flex flex-col items-center py-20 gap-4">
            <FaBell size={48} className="text-gray-600" />
            <p className="text-gray-400">{t('notifications.empty')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifs.map((n, i) => (
              <motion.div key={n.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                className={`card p-4 flex items-start gap-3 ${!n.isRead ? 'border-primary-500/20' : ''}`}>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[n.type] || colorMap.info}`}>
                  {getIcon(n.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white font-semibold text-sm">{n.title}</p>
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary-400 flex-shrink-0" />}
                  </div>
                  <p className="text-gray-400 text-xs mt-0.5">{n.body}</p>
                  <p className="text-gray-600 text-[11px] mt-1">{formatTime(n.createdAt)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
