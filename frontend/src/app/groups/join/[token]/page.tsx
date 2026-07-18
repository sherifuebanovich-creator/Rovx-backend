'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { socialApi } from '@/lib/api';
import { motion } from 'framer-motion';
import { FaUsers, FaSignInAlt, FaCheck, FaTimes } from 'react-icons/fa';
import toast from 'react-hot-toast';

export default function JoinGroupPage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;
  const { user, isInitDone } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'joined' | 'error'>('loading');
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    if (!isInitDone) return;
    if (!user) {
      router.push('/auth/register');
    }
  }, [isInitDone, user, router]);

  useEffect(() => {
    if (!user || !token) return;
    socialApi.joinByToken(token).then(res => {
      const data = res.data?.data || res.data;
      setGroupName(data.group?.name || '');
      setStatus('joined');
      toast.success('Вы вступили в группу!');
      setTimeout(() => {
        router.push(`/groups/${data.group?.id || ''}`);
      }, 1500);
    }).catch(err => {
      setStatus('error');
      toast.error(err?.response?.data?.message || 'Ошибка вступления');
    });
  }, [user, token, router]);

  if (!isInitDone || !user) {
    return null;
  }

  return (
    <div className="min-h-dvh bg-dark-bg flex items-center justify-center px-6">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-dark-card rounded-2xl p-8 text-center max-w-sm w-full border border-dark-border">
        {status === 'loading' && (
          <>
            <div className="w-16 h-16 rounded-2xl bg-primary-600/20 flex items-center justify-center mx-auto mb-4">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-dark-text font-semibold">Вступление в группу...</p>
          </>
        )}
        {status === 'joined' && (
          <>
            <div className="w-16 h-16 rounded-2xl bg-green-600/20 flex items-center justify-center mx-auto mb-4">
              <FaCheck size={24} className="text-green-400" />
            </div>
            <p className="text-dark-text font-semibold mb-1">Вы вступили!</p>
            <p className="text-sm text-gray-400">{groupName}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-16 h-16 rounded-2xl bg-red-600/20 flex items-center justify-center mx-auto mb-4">
              <FaTimes size={24} className="text-red-400" />
            </div>
            <p className="text-dark-text font-semibold mb-1">Не удалось вступить</p>
            <p className="text-sm text-gray-400">Ссылка недействительна или вы заблокированы</p>
            <button onClick={() => router.push('/groups')}
              className="mt-4 px-6 py-2 rounded-xl bg-primary-600 text-white text-sm hover:bg-primary-500">
              К группам
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
