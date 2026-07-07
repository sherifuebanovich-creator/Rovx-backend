'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { socialApi } from '@/lib/api';
import { Group } from '@/types';
import { motion } from 'framer-motion';
import { FaArrowLeft, FaUsers, FaSearch, FaPlus } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';

export default function ChatsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();

  return (
    <div className="min-h-dvh bg-dark-bg pb-safe-bottom">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-primary-900/30 to-transparent" />
      </div>
      <div className="relative px-4 pt-14 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-white transition-all">
            <FaArrowLeft size={16} />
          </button>
          <h1 className="text-2xl font-black text-white font-display flex-1">{t('chats.title')}</h1>
          <button onClick={() => router.push('/chats/create-group')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-500 transition-all">
            <FaPlus size={12} /> {t('chats.create')}
          </button>
        </div>

        <GroupsListSection />
      </div>
    </div>
  );
}

function GroupsListSection() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<Group[]>([]);
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const searchFetchId = useRef(0);

  useEffect(() => {
    Promise.all([
      socialApi.getGroups(1, undefined, undefined, ''),
      socialApi.getMyGroups(),
    ]).then(([gRes, mRes]) => {
      const gData = gRes.data?.data || gRes.data;
      const mData = mRes.data?.data || mRes.data;
      const loaded: Group[] = gData?.groups || gData || [];
      setAllGroups(loaded);
      setGroups(loaded);
      setMyGroups(mData || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setGroups(allGroups);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const thisId = ++searchFetchId.current;
    socialApi.searchGroups(searchQuery).then(res => {
      if (thisId !== searchFetchId.current) return;
      const data = res.data?.data || res.data;
      setGroups(data || []);
    }).catch(() => {
      if (thisId === searchFetchId.current) setGroups(allGroups);
    }).finally(() => {
      if (thisId === searchFetchId.current) setSearchLoading(false);
    });
  }, [searchQuery, allGroups]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative mb-4">
        <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          className="input-field pl-10 text-sm" placeholder={t('chats.searchGroups')} />
        {searchLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {searchLoading ? (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : groups.map((group, idx) => (
        <Link key={group.id} href={`/groups/${group.id}`}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.03 }}
            className="card p-4 flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-all"
          >
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center text-white font-bold flex-shrink-0">
              {group.avatar ? <img src={group.avatar} className="w-full h-full object-cover rounded-2xl" /> : <FaUsers size={18} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold truncate">{group.name}</p>
              <p className="text-xs text-gray-500 truncate">
                {t('chats.members', { count: group.memberCount })}{group.city ? ` · ${group.city}` : ''}
                {group.owner && ` · ${group.owner.displayName}`}
              </p>
            </div>
            {myGroups.some(mg => mg.id === group.id) && (
              <span className="text-[10px] font-medium text-primary-400 bg-primary-600/20 px-2 py-1 rounded-lg">{t('chats.joined')}</span>
            )}
          </motion.div>
        </Link>
      ))}
      {!searchLoading && groups.length === 0 && (
        <div className="card p-6 text-center">
          <FaUsers size={24} className="text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-400">{searchQuery ? t('chats.groupsNotFound') : t('chats.noGroups')}</p>
        </div>
      )}
    </div>
  );
}
