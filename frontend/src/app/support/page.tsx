'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { FaArrowLeft, FaHeadset } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { supportApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export default function SupportPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  const handleSend = async () => {
    const message = text.trim();
    if (!message) return;
    setSending(true);
    try {
      const res = await supportApi.send(message);
      const data = res.data?.data || res.data;
      setRemaining(typeof data?.remaining === 'number' ? data.remaining : null);
      toast.success(t('settings.supportSent'));
      setText('');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('settings.supportFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-dvh bg-dark-bg">
      <div className="relative px-4 sm:px-6 pt-14 pb-safe-bottom pb-12 max-w-lg mx-auto">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('settings.back')}
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-accent-600/20 flex items-center justify-center text-accent-400 flex-shrink-0">
            <FaHeadset size={18} />
          </div>
          <h1 className="text-2xl font-black text-white font-display">{t('settings.support')}</h1>
        </div>
        <p className="text-xs text-gray-400 mb-5">{t('settings.supportHint')}</p>

        {!user ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-gray-400 mb-3">{t('notifications.signIn')}</p>
            <button onClick={() => router.push('/auth/register')} className="btn-primary px-6 py-3">
              {t('notifications.signIn')}
            </button>
          </div>
        ) : (
          <div className="card p-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('settings.supportPlaceholder')}
              maxLength={2000}
              rows={6}
              className="w-full bg-dark-surface border border-dark-border rounded-xl p-3 text-sm text-white placeholder-gray-500 outline-none focus:border-primary-500 transition-all resize-none"
              autoFocus
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className="w-full mt-3 py-3 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {sending ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                t('settings.supportSend')
              )}
            </button>
            {remaining !== null && (
              <p className="text-center text-[11px] text-gray-500 mt-3">
                {t('settings.supportRemaining', { count: remaining })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
