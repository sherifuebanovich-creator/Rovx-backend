'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { friendsApi } from '@/lib/api';
import { Friend, FriendRequest } from '@/types';
import { useTranslation } from 'react-i18next';

import { FaArrowLeft, FaUserPlus, FaUser, FaUserCheck, FaUserTimes, FaSearch, FaCircle, FaTimes } from 'react-icons/fa';
import toast from 'react-hot-toast';

export default function FriendsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [tab, setTab] = useState<'friends' | 'requests' | 'search'>('friends');
  const searchFetchId = useRef(0);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      friendsApi.getFriends(),
      friendsApi.getRequests(),
    ]).then(([fRes, rRes]) => {
      setFriends(fRes.data?.data || fRes.data || []);
      setRequests(rRes.data?.data || rRes.data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    const thisFetch = ++searchFetchId.current;
    setSearchLoading(true);
    try {
      const res = await friendsApi.searchUsers(q);
      if (thisFetch !== searchFetchId.current) return;
      setSearchResults(res.data?.data || res.data || []);
    } catch {
      if (thisFetch === searchFetchId.current) setSearchResults([]);
      toast.error(t('friends.searchError'));
    }
    finally { if (thisFetch === searchFetchId.current) setSearchLoading(false); }
  };

  const sendRequest = async (userId: string) => {
    try {
      await friendsApi.sendRequest(userId);
      toast.success(t('friends.requestSent'));
      setSearchResults(prev => prev.map(u => u.id === userId ? { ...u, requestSent: true } : u));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('friends.error'));
    }
  };

  const acceptRequest = async (userId: string) => {
    try {
      await friendsApi.acceptRequest(userId);
      toast.success(t('friends.requestAccepted'));
      setRequests(prev => prev.filter(r => r.user.id !== userId));
    } catch { toast.error(t('friends.error')); }
  };

  const rejectRequest = async (userId: string) => {
    try {
      await friendsApi.rejectRequest(userId);
      setRequests(prev => prev.filter(r => r.user.id !== userId));
    } catch { toast.error(t('friends.error')); }
  };

  const removeFriend = async (userId: string) => {
    try {
      await friendsApi.removeFriend(userId);
      setFriends(prev => prev.filter(f => f.id !== userId));
      toast.success(t('friends.friendRemoved'));
    } catch { toast.error(t('friends.error')); }
  };

  if (!user) {
    return (
      <div className="min-h-dvh bg-dark-bg flex flex-col items-center justify-center gap-4 px-6">
        <FaUser size={48} className="text-gray-600" />
        <h2 className="text-white font-bold text-xl">{t('friends.loginRequired')}</h2>
        <button onClick={() => router.push('/auth/register')} className="btn-primary px-6 py-3">{t('friends.signIn')}</button>
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
          <FaArrowLeft size={14} /> {t('friends.back')}
        </button>

        <div className="flex items-center gap-4 mb-6">
          <h1 className="text-2xl font-black text-white font-display flex-1">{t('friends.title')}</h1>
          <button onClick={() => setTab('search')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'search' ? 'bg-primary-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
            <FaSearch size={14} />
          </button>
        </div>

        <div className="flex gap-2 mb-6">
          {(['friends', 'requests'] as const).map((tabItem) => (
            <button key={tabItem} onClick={() => setTab(tabItem)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                tab === tabItem ? 'bg-primary-600/30 text-primary-400 border border-primary-500/50' : 'bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10'
              }`}
            >
              {tabItem === 'friends' ? `${t('friends.friendsTab')} (${friends.length})` : `${t('friends.requestsTab')} (${requests.length})`}
            </button>
          ))}
        </div>

        {tab === 'search' && (
          <div className="mb-6">
            <div className="relative">
              <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
              <input value={searchQuery} onChange={e => handleSearch(e.target.value)}
                className="input-field pl-10 text-sm" placeholder={t('friends.searchPlaceholder')} autoFocus />
            </div>
            <div className="mt-3 space-y-2">
              {searchLoading ? (
                <div className="flex justify-center py-6">
                  <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : searchResults.map(u => (
                <div key={u.id} className="card p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white font-bold text-sm">
                    {(u.displayName?.[0] || '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{u.displayName}</p>
                    <p className="text-xs text-gray-500">@{u.username}{u.city ? ` · ${u.city}` : ''}</p>
                  </div>
                  {u.isFriend ? (
                    <span className="text-xs text-green-400 flex items-center gap-1"><FaUserCheck size={10} /> {t('friends.friend')}</span>
                  ) : u.requestSent ? (
                    <span className="text-xs text-yellow-400">{t('friends.pending')}</span>
                  ) : (
                    <button onClick={() => sendRequest(u.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary-600/20 text-primary-400 hover:bg-primary-600/30">
                      <FaUserPlus size={12} />
                    </button>
                  )}
                </div>
              ))}
              {searchQuery && !searchLoading && searchResults.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-6">{t('friends.noUsers')}</p>
              )}
            </div>
          </div>
        )}

        {tab === 'requests' && (
          <div className="space-y-2">
            {requests.length === 0 ? (
              <div className="card p-6 text-center">
                <FaUserPlus size={24} className="text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400">{t('friends.noRequests')}</p>
              </div>
            ) : requests.map(r => (
              <div key={r.id} className="card p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white font-bold text-sm">
                  {(r.user.displayName?.[0] || '?').toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-white text-sm font-medium">{r.user.displayName}</p>
                  <p className="text-xs text-gray-500">@{r.user.username}</p>
                </div>
                <button onClick={() => acceptRequest(r.user.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30">
                  <FaUserCheck size={12} />
                </button>
                <button onClick={() => rejectRequest(r.user.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30">
                  <FaUserTimes size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'friends' && (
          <div className="space-y-2">
            {loading ? (
              <div className="flex justify-center py-6">
                <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : friends.length === 0 ? (
              <div className="card p-6 text-center">
                <FaUser size={24} className="text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400">{t('friends.noFriends')}</p>
                <button onClick={() => setTab('search')} className="mt-3 text-sm text-primary-400 hover:text-primary-300">
                  {t('friends.findFriends')}
                </button>
              </div>
            ) : friends.map(f => (
              <div key={f.id} className="card p-3 flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white font-bold text-sm">
                    {(f.displayName?.[0] || '?').toUpperCase()}
                  </div>
                  <FaCircle size={8} className={`absolute -top-0.5 -right-0.5 ${f.isOnline ? 'text-green-400' : 'text-gray-600'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{f.displayName}</p>
                  <p className="text-xs text-gray-500">{f.isOnline ? t('friends.online') : t('friends.offline')}{f.city ? ` · ${f.city}` : ''}</p>
                </div>
                <button onClick={() => removeFriend(f.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20">
                  <FaTimes size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
