'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { socialApi } from '@/lib/api';
import { useSocket, getSocket } from '@/hooks/useSocket';
import { Group, GroupMessage } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { FaArrowLeft, FaUsers, FaEdit, FaTrash, FaTimes, FaSave, FaPaperPlane } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

export default function GroupChatPage() {
  const router = useRouter();
  const params = useParams();
  const groupId = params.id as string;
  const { user } = useAuthStore();
  const { socket } = useSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { t, i18n } = useTranslation();

  const [group, setGroup] = useState<Group | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '', city: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const joinedRef = useRef(false);

  // Track socket connection state and re-join on reconnect
  useEffect(() => {
    const ws = getSocket();
    if (!ws) return;
    const onConnect = () => {
      setSocketReady(true);
      joinedRef.current = false;
      socialApi.getGroupMessages(groupId).then(res => {
        const msgs = res.data?.data || res.data;
        setMessages(msgs?.messages || msgs || []);
      }).catch(() => {});
    };
    const onDisconnect = () => setSocketReady(false);
    setSocketReady(ws.connected);
    ws.on('connect', onConnect);
    ws.on('disconnect', onDisconnect);
    return () => { ws.off('connect', onConnect); ws.off('disconnect', onDisconnect); };
  }, [groupId]);

  // Join group room when socket is ready
  useEffect(() => {
    const ws = getSocket();
    if (!ws) return;
    if (!ws.connected) {
      ws.once('connect', () => {
        ws.emit('join:group', { groupId });
        joinedRef.current = true;
      });
      return;
    }
    ws.emit('join:group', { groupId });
    joinedRef.current = true;
  }, [socketReady, groupId]);

  useEffect(() => {
    if (!user || !groupId) return;
    const ws = getSocket();

    // Listen for messages
    const MAX_MESSAGES = 200;
    const onMessage = (msg: GroupMessage) => {
      setMessages(prev => {
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
      });
    };
    ws?.on('group:message', onMessage);

    // Fetch group data
    Promise.all([
      socialApi.getGroup(groupId),
      socialApi.getGroupMessages(groupId),
    ]).then(([gRes, mRes]) => {
      setGroup(gRes.data?.data || gRes.data);
      const msgs = mRes.data?.data || mRes.data;
      setMessages(msgs?.messages || msgs || []);
    }).catch(() => {
      toast.error(t('groupDetails.notFound'));
      router.push('/groups');
    }).finally(() => setLoading(false));

    // Listen for group updates
    const onUpdated = (data: any) => {
      setGroup(prev => prev ? { ...prev, ...data } : prev);
    };
    ws?.on('group:updated', onUpdated);

    return () => {
      ws?.off('group:message', onMessage);
      ws?.off('group:updated', onUpdated);
      ws?.emit('leave:group', { groupId });
      joinedRef.current = false;
    };
  }, [user, groupId, router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const ws = getSocket();
    if (!ws?.connected) {
      toast.error(t('groupDetails.noConnection'));
      return;
    }
    ws.emit('group:message', {
      groupId,
      content: input.trim(),
    });
    setInput('');
  };

  const handleEditGroup = async () => {
    if (!editForm.name.trim()) { toast.error(t('groupDetails.nameRequired')); return; }
    setEditLoading(true);
    try {
      const res = await socialApi.updateGroup(groupId, editForm);
      setGroup(res.data?.data || res.data);
      setEditing(false);
      toast.success(t('groupDetails.updated'));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('groupDetails.error'));
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!confirm(t('groupDetails.deleteConfirm'))) return;
    try {
      await socialApi.deleteGroup(groupId);
      toast.success(t('groupDetails.deleted'));
      router.push('/groups');
    } catch { toast.error(t('groupDetails.deleteError')); }
  };

  const leaveGroup = async () => {
    try {
      await socialApi.leaveGroup(groupId);
      toast.success(t('groupDetails.left'));
      router.push('/groups');
    } catch { toast.error(t('groupDetails.error')); }
  };

  if (!user) return null;

  if (loading) {
    return (
      <div className="min-h-dvh bg-dark-bg flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!group) return null;

  const isAdmin = group.members?.find(m => m.userId === user.id)?.isAdmin || user.id === group.ownerId;
  const isOwner = user.id === group.ownerId;

  return (
    <div className="min-h-dvh bg-dark-bg flex flex-col pb-safe-bottom">
      {/* Header */}
      <div className="relative px-4 pt-4 pb-3 flex items-center gap-3 border-b border-dark-border">
        <Link href="/groups" className="text-gray-400 hover:text-dark-text transition-all flex items-center">
          <FaArrowLeft size={16} />
        </Link>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center text-white font-bold text-sm">
          {group.avatar ? <img src={group.avatar} className="w-full h-full object-cover rounded-xl" /> : <FaUsers size={16} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-dark-text font-semibold truncate">{group.name}</p>
          <p className="text-xs text-gray-500">{group.memberCount} {t('groupDetails.members')}</p>
        </div>
        <button onClick={() => setShowMembers(!showMembers)}
          className="px-3 py-1.5 rounded-lg bg-dark-surface text-gray-400 text-xs hover:bg-dark-border">
          {showMembers ? t('groupDetails.chat') : t('groupDetails.members')}
        </button>
        {isOwner && (
          <div className="flex gap-1">
            <button onClick={() => { setEditing(!editing); setEditForm({ name: group.name, description: group.description || '', city: group.city || '' }); }}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-dark-surface text-gray-400 hover:bg-dark-border">
              <FaEdit size={12} />
            </button>
            <button onClick={handleDeleteGroup}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20">
              <FaTrash size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Members panel */}
      <AnimatePresence>
        {showMembers && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-dark-border"
          >
            <div className="p-4 space-y-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{t('groupDetails.members')} ({group.members?.length})</p>
              {group.members?.map(m => (
                <div key={m.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white text-xs font-bold">
                    {m.user?.displayName?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <span className="text-sm text-dark-text">{m.user.displayName}</span>
                  {m.isAdmin && <span className="text-[10px] text-primary-400 bg-primary-600/20 px-1.5 py-0.5 rounded">{t('groupDetails.admin')}</span>}
                </div>
              ))}
              {!isOwner && (
                <button onClick={leaveGroup} className="mt-3 text-xs text-red-400 hover:text-red-300">
                  {t('groupDetails.leave')}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit panel */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-dark-border"
          >
            <div className="p-4 space-y-2">
              <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                className="input-field text-sm" placeholder={t('groupDetails.nameLabel')} />
              <input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                className="input-field text-sm" placeholder={t('groupDetails.descriptionLabel')} />
              <input value={editForm.city} onChange={e => setEditForm(p => ({ ...p, city: e.target.value }))}
                className="input-field text-sm" placeholder={t('groupDetails.cityLabel')} />
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)}
                  className="flex-1 py-2 rounded-xl text-sm bg-dark-surface text-gray-400 hover:bg-dark-border">
                  {t('groupDetails.cancel')}
                </button>
                <button onClick={handleEditGroup} disabled={editLoading}
                  className="flex-1 py-2 rounded-xl text-sm bg-primary-600 text-white hover:bg-primary-500 flex items-center justify-center gap-1">
                  {editLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><FaSave size={12} /> {t('groupDetails.save')}</>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.senderId === user.id ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl ${
              msg.senderId === user.id
                ? 'bg-primary-600 text-white rounded-br-md'
                : 'bg-dark-surface text-dark-text rounded-bl-md'
            }`}>
              {msg.senderId !== user.id && (
                <p className="text-[10px] text-primary-300 font-medium mb-1">{msg.sender?.displayName || msg.senderId}</p>
              )}
              <p className="text-sm leading-relaxed">{msg.content}</p>
              <p className="text-[10px] opacity-50 text-right mt-1">
                {new Date(msg.createdAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-dark-border">
        <div className="flex items-center gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            className="input-field flex-1 text-sm" placeholder={t('groupDetails.messagePlaceholder')} />
          <button onClick={sendMessage} disabled={!input.trim()}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary-600 text-white hover:bg-primary-500 transition-all disabled:opacity-50">
            <FaPaperPlane size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
