'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { socialApi, premiumApi } from '@/lib/api';
import { Group } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { FaArrowLeft, FaUsers, FaSearch, FaPlus, FaCrown, FaSignInAlt, FaCheck } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export default function GroupsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Group[]>([]);
  const searchFetchId = useRef(0);
  const [joinByName, setJoinByName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [canCreate, setCanCreate] = useState<{ allowed: boolean; currentGroups: number; maxGroups: number } | null>(null);
  const [createForm, setCreateForm] = useState({ name: '', description: '', city: '', isPublic: true });
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [tab, setTab] = useState<'all' | 'my'>('all');

  useEffect(() => {
    if (!user) return;
    Promise.all([
      socialApi.getGroups(1, undefined, undefined, ''),
      socialApi.getMyGroups(),
    ]).then(([gRes, mRes]) => {
      const gData = gRes.data?.data || gRes.data;
      const mData = mRes.data?.data || mRes.data;
      setGroups(gData?.groups || gData || []);
      setMyGroups(mData || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    const thisFetch = ++searchFetchId.current;
    try {
      const res = await socialApi.searchGroups(q);
      if (thisFetch !== searchFetchId.current) return;
      setSearchResults(res.data?.data || res.data || []);
    } catch {
      if (thisFetch === searchFetchId.current) setSearchResults([]);
      toast.error(t('groups.searchError'));
    }
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) { toast.error(t('groups.enterName')); return; }
    setCreateLoading(true);
    try {
      const res = await socialApi.createGroup(createForm);
      const group = res.data?.data || res.data;
      toast.success(t('groups.created'));
      setShowCreateForm(false);
      setCreateForm({ name: '', description: '', city: '', isPublic: true });
      setMyGroups(prev => [...prev, group]);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('groups.createFailed'));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleJoinByName = async () => {
    if (!joinByName.trim()) { toast.error(t('groups.enterName')); return; }
    setJoinLoading(true);
    try {
      const res = await socialApi.joinGroupByName(joinByName.trim());
      const data = res.data?.data || res.data;
      if (data.joined) {
        toast.success(t('groups.joinedSuccess'));
        setJoinByName('');
        router.push(`/groups/${data.group?.id || data.id}`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('groups.notFound'));
    } finally {
      setJoinLoading(false);
    }
  };

  const canCreateGroup = async () => {
    if (user?.subscription !== 'PREMIUM_MAX') {
      toast.error(t('groups.premiumRequired'));
      router.push('/premium');
      return;
    }
    try {
      const res = await premiumApi.canCreateGroup();
      const data = res.data?.data || res.data;
      setCanCreate(data);
      if (!data.allowed) {
        toast.error(t('groups.limitExceeded', { current: data.currentGroups, max: data.maxGroups }));
      } else {
        router.push('/chats/create-group');
      }
    } catch { toast.error(t('groups.limitCheckFailed')); }
  };

  if (!user) {
    return (
      <div className="min-h-dvh bg-dark-bg flex flex-col items-center justify-center gap-4 px-6">
        <FaUsers size={48} className="text-gray-600" />
        <h2 className="text-white font-bold text-xl">{t('groups.loginRequired')}</h2>
        <button onClick={() => router.push('/auth/login')} className="btn-primary px-6 py-3">{t('groups.login')}</button>
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
          <FaArrowLeft size={14} /> {t('groups.back')}
        </button>

        <div className="flex items-center gap-4 mb-6">
          <h1 className="text-2xl font-black text-white font-display flex-1">{t('groups.title')}</h1>
          <button onClick={canCreateGroup}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary-600 to-accent-600 text-white text-sm font-medium hover:opacity-90 transition-all">
            <FaPlus size={12} /> {t('groups.create')}
          </button>
        </div>

        {/* Join by name */}
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-3">
            <FaSignInAlt className="text-primary-400 flex-shrink-0" size={14} />
            <input value={joinByName} onChange={e => setJoinByName(e.target.value)}
              placeholder={t('groups.joinPlaceholder')}
              className="input-field flex-1 text-sm" onKeyDown={e => e.key === 'Enter' && handleJoinByName()} />
            <button onClick={handleJoinByName} disabled={joinLoading || !joinByName.trim()}
              className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-500 transition-all disabled:opacity-50 flex items-center gap-1">
              {joinLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><FaCheck size={12} /> {t('groups.join')}</>}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button onClick={() => setTab('all')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${tab === 'all' ? 'bg-primary-600/30 text-primary-400 border border-primary-500/50' : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'}`}>
            {t('groups.all')} ({groups.length})
          </button>
          <button onClick={() => setTab('my')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${tab === 'my' ? 'bg-primary-600/30 text-primary-400 border border-primary-500/50' : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'}`}>
            {t('groups.my')} ({myGroups.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
          <input value={searchQuery} onChange={e => handleSearch(e.target.value)}
            className="input-field pl-10 text-sm" placeholder={t('groups.search')} />
        </div>

        {/* Create Form */}
        <AnimatePresence>
          {showCreateForm && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="card p-4 mb-6 border border-primary-500/30"
            >
              <div className="flex items-center gap-2 mb-4">
                <FaCrown className="text-primary-400" size={16} />
                <h3 className="text-white font-bold text-sm">{t('groups.createGroup')}</h3>
              </div>
              <div className="space-y-3">
                <input value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                  className="input-field text-sm" placeholder={t('groups.namePlaceholder')} />
                <input value={createForm.description} onChange={e => setCreateForm(p => ({ ...p, description: e.target.value }))}
                  className="input-field text-sm" placeholder={t('groups.descriptionPlaceholder')} />
                <input value={createForm.city} onChange={e => setCreateForm(p => ({ ...p, city: e.target.value }))}
                  className="input-field text-sm" placeholder={t('groups.cityPlaceholder')} />
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input type="checkbox" checked={createForm.isPublic} onChange={e => setCreateForm(p => ({ ...p, isPublic: e.target.checked }))}
                    className="rounded border-white/20 bg-white/5" />
                  {t('groups.public')}
                </label>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setShowCreateForm(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 text-gray-400 hover:bg-white/10 transition-all">
                  {t('groups.cancel')}
                </button>
                <button onClick={handleCreate} disabled={createLoading || !createForm.name.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-primary-600 text-white hover:bg-primary-500 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {createLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t('groups.create')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Group List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-2">
            {(tab === 'all'
              ? (searchQuery ? searchResults : groups)
              : myGroups
            ).map((group, idx) => (
              <Link key={group.id} href={`/groups/${group.id}`}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="card p-4 flex items-center gap-3 cursor-pointer hover:bg-white/5 transition-all"
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center text-white font-bold">
                  {group.avatar ? <img src={group.avatar} className="w-full h-full object-cover rounded-2xl" /> : <FaUsers size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{group.name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {t('groups.members', { count: group.memberCount })}{group.city ? ` · ${group.city}` : ''}
                    {group.owner && ` · ${t('groups.owner')}: ${group.owner.displayName}`}
                  </p>
                </div>
                {myGroups.some(mg => mg.id === group.id) && (
                  <span className="text-[10px] font-medium text-primary-400 bg-primary-600/20 px-2 py-1 rounded-lg">{t('groups.joined')}</span>
                )}
              </motion.div>
              </Link>
            ))}
            {(tab === 'all' && !loading && groups.length === 0) && (
              <div className="card p-6 text-center">
                <FaUsers size={24} className="text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400">{t('groups.notFound')}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
