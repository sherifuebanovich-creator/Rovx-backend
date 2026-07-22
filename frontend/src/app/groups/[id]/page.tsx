'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { socialApi } from '@/lib/api';
import { mediaUrl } from '@/lib/media';
import { useSocket, getSocket } from '@/hooks/useSocket';
import { Group, GroupMessage, GroupMember, GroupRequest } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FaArrowLeft, FaUsers, FaEdit, FaTrash, FaTimes, FaSave, FaPaperPlane,
  FaImage, FaSmile, FaInfoCircle, FaMapMarkerAlt, FaCrown, FaShieldAlt,
  FaSignOutAlt, FaCalendarAlt, FaGlobe, FaLock, FaChevronRight, FaHeart,
  FaStar, FaSignInAlt, FaLink, FaCopy, FaUserShield, FaUserMinus, FaUserSlash,
  FaUserCheck, FaRegCommentDots, FaBullhorn,
} from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import Cookies from 'js-cookie';
import AudioRecorderButton from '@/components/chat/AudioRecorderButton';
import AudioMessagePlayer from '@/components/chat/AudioMessagePlayer';
import VideoMessageRecorder from '@/components/chat/VideoMessageRecorder';
import VideoMessagePlayer from '@/components/chat/VideoMessagePlayer';
import VoiceChat from '@/components/chat/VoiceChat';

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1').replace('/api/v1', '');

const STICKER_PACKS = [
  { id: 'road', name: '🚗', stickers: [
    '🚗','🚕','🚌','🏎','🚓','🚑','🚒','🚐','🛻','🚚',
    '🚜','🛵','🏍','🚲','🛴','🛹','🚧','🚦','🛑','⛽',
    '🅿','🛣','🛤','🛞','🚨','🏁','🏆','🗺','🧭','✈️',
  ]},
  { id: 'emoji', name: '😀', stickers: [
    '😀','😂','🤣','😊','😍','🥰','😎','🤩','🥳','😏',
    '👍','👎','👏','🙏','💪','❤️','🔥','⭐','💯','🎉',
    '😱','😤','🤔','😴','🤯','🤮','🥶','💀','👀','🫡',
  ]},
  { id: 'weather', name: '🌤', stickers: [
    '☀️','🌤','⛅','🌥','☁️','🌧','⛈','🌩','🌨','❄️',
    '🌫','💨','🌪','🌈','🌊','💧','🔥','⚡','🌡','☃️',
  ]},
  { id: 'nature', name: '🌿', stickers: [
    '🌲','🌳','🌴','🌵','🍁','🍂','🌸','🌺','🌻','🌹',
    '🐾','🐦','🦅','🐋','🐬','🐠','🦋','🐛','🐜','🐝',
  ]},
  { id: 'food', name: '🍕', stickers: [
    '🍕','🍔','🍟','🌭','🍿','🧀','🥩','🍗','🍖','🥚',
    '☕','🍵','🥤','🍺','🍷','🥃','🍸','🍹','🧃','🥛',
  ]},
];

export default function GroupChatPage() {
  const router = useRouter();
  const params = useParams();
  const groupId = params.id as string;
  const { user } = useAuthStore();
  const { socket } = useSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t, i18n } = useTranslation();

  const [group, setGroup] = useState<Group | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '', city: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [activeStickerPack, setActiveStickerPack] = useState(0);
  const [isMember, setIsMember] = useState(false);
  const [joining, setJoining] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ messageId: string; senderId: string; x: number; y: number } | null>(null);
  const [memberAction, setMemberAction] = useState<{ userId: string; username: string; isAdmin: boolean } | null>(null);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [showReadBy, setShowReadBy] = useState<string | null>(null);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const joinedRef = useRef(false);
  const readSentRef = useRef<Set<string>>(new Set());
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🙏'];

  // Socket connection
  useEffect(() => {
    const ws = getSocket();
    if (!ws) return;
    const onConnect = () => {
      setSocketReady(true);
      joinedRef.current = false;
    };
    const onDisconnect = () => setSocketReady(false);
    setSocketReady(ws.connected);
    ws.on('connect', onConnect);
    ws.on('disconnect', onDisconnect);
    return () => { ws.off('connect', onConnect); ws.off('disconnect', onDisconnect); };
  }, [groupId]);

  // Join group room when member
  useEffect(() => {
    if (!isMember) return;
    const ws = getSocket();
    if (!ws) return;
    if (!ws.connected) {
      const onConnect = () => {
        ws.emit('join:group', { groupId });
        joinedRef.current = true;
      };
      ws.once('connect', onConnect);
      // If groupId/socketReady changes again before 'connect' fires (e.g. a
      // brief reconnect), this removes the pending listener for the stale
      // groupId instead of letting it stack and double-join later.
      return () => { ws.off('connect', onConnect); };
    }
    ws.emit('join:group', { groupId });
    joinedRef.current = true;
  }, [socketReady, groupId, isMember]);

  // Listen for messages + fetch group data
  useEffect(() => {
    if (!user || !groupId) return;
    const ws = getSocket();

    const MAX_MESSAGES = 200;
    const onMessage = (msg: GroupMessage) => {
      setMessages(prev => {
        const next = [...prev, msg];
        return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
      });
    };
    ws?.on('group:message', onMessage);

    // Re-fetch messages on socket reconnect, but only while the user is a
    // member — resolved once the group/member fetch below completes.
    const isMemberForConnectRef = { current: false };
    const onConnect = () => {
      if (!isMemberForConnectRef.current) return;
      socialApi.getGroupMessages(groupId).then(res => {
        const m = res.data?.data || res.data;
        setMessages(m?.messages || m || []);
      }).catch(() => {});
    };
    ws?.on('connect', onConnect);

    Promise.all([
      socialApi.getGroup(groupId),
      socialApi.getGroupMessages(groupId),
    ]).then(([gRes, mRes]) => {
      const gData = gRes.data?.data || gRes.data;
      setGroup(gData);
      setIsMember(gData?.isMember ?? false);
      const msgs = mRes.data?.data || mRes.data;
      setMessages(msgs?.messages || msgs || []);

      // Check request status for non-members
      if (!gData?.isMember) {
        socialApi.getRequestStatus(groupId).then(res => {
          setRequestStatus(res.data?.status || null);
        }).catch(() => {});
      }

      // Fetch pending requests for admins
      if (gData?.isMember && (gData?.ownerId === user?.id || gData?.members?.some((m: any) => m.userId === user?.id && m.isAdmin))) {
        socialApi.getPendingRequests(groupId).then(res => {
          const data = res.data?.data || res.data;
          setPendingRequests(Array.isArray(data) ? data : []);
        }).catch(() => {});
      }

      // If member, fetch messages on socket connect too
      isMemberForConnectRef.current = !!gData?.isMember;
    }).catch(() => {
      toast.error(t('groupDetails.notFound'));
      router.push('/groups');
    }).finally(() => setLoading(false));

    const onUpdated = (data: any) => {
      setGroup(prev => prev ? { ...prev, ...data } : prev);
    };
    const onMessageDeleted = (data: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m.id !== data.messageId));
    };
    const onMemberBanned = (data: { userId: string }) => {
      setGroup(prev => {
        if (!prev?.members) return prev;
        return { ...prev, members: prev.members.filter(m => m.userId !== data.userId) };
      });
      if (data.userId === user?.id) {
        toast.error('Вы заблокированы в этой группе');
        router.push('/groups');
      }
    };
    const onMemberKicked = (data: { userId: string }) => {
      setGroup(prev => {
        if (!prev?.members) return prev;
        return { ...prev, members: prev.members.filter(m => m.userId !== data.userId) };
      });
      if (data.userId === user?.id) {
        toast.error('Вы исключены из группы');
        router.push('/groups');
      }
    };
    const onMemberPromoted = () => { toast('Пользователь повышен до админа'); };
    const onMemberDemoted = () => { toast('Пользователь понижен'); };

    const onMessageRead = (data: { messageId: string; readBy: string[]; readByUser: string }) => {
      setMessages(prev => prev.map(m => m.id === data.messageId ? { ...m, readBy: data.readBy } : m));
    };
    const onReaction = (data: { messageId: string; reactions: Record<string, string[]> }) => {
      setMessages(prev => prev.map(m => m.id === data.messageId ? { ...m, reactions: data.reactions } : m));
    };

    const onRequestNew = (data: { groupId: string; userId: string; groupName: string }) => {
      if (data.groupId !== groupId) return;
      toast(`Новая заявка на вступление в группу`, { icon: '📩' });
      // Refresh pending requests for admins
      socialApi.getPendingRequests(groupId).then(res => {
        const reqs = res.data?.data || res.data;
        setPendingRequests(Array.isArray(reqs) ? reqs : []);
      }).catch(() => {});
    };

    const onRequestApproved = (data: { groupId: string; groupName: string }) => {
      if (data.groupId !== groupId) return;
      toast.success(`Заявка одобрена! Вы теперь в группе "${data.groupName}"`);
      setIsMember(true);
      setRequestStatus('APPROVED');
      // Reload messages
      socialApi.getGroupMessages(groupId).then(res => {
        const m = res.data?.data || res.data;
        setMessages(m?.messages || m || []);
      }).catch(() => {});
      socialApi.getGroup(groupId).then(res => {
        const g = res.data?.data || res.data;
        setGroup(g);
      }).catch(() => {});
    };

    const onRequestRejected = (data: { groupId: string; groupName: string }) => {
      if (data.groupId !== groupId) return;
      toast.error(`Заявка отклонена в группе "${data.groupName}"`);
      setRequestStatus('REJECTED');
    };

    const onMemberJoined = (data: { userId: string }) => {
      // Refresh group data when someone joins
      socialApi.getGroup(groupId).then(res => {
        const g = res.data?.data || res.data;
        setGroup(g);
      }).catch(() => {});
    };

    ws?.on('group:updated', onUpdated);
    ws?.on('group:message_deleted', onMessageDeleted);
    ws?.on('group:member_banned', onMemberBanned);
    ws?.on('group:member_kicked', onMemberKicked);
    ws?.on('group:member_promoted', onMemberPromoted);
    ws?.on('group:member_demoted', onMemberDemoted);
    ws?.on('group:message_read', onMessageRead);
    ws?.on('group:reaction', onReaction);
    ws?.on('group:request_new', onRequestNew);
    ws?.on('group:request_approved', onRequestApproved);
    ws?.on('group:request_rejected', onRequestRejected);
    ws?.on('group:member_joined', onMemberJoined);

    return () => {
      ws?.off('group:message', onMessage);
      ws?.off('connect', onConnect);
      ws?.off('group:updated', onUpdated);
      ws?.off('group:message_deleted', onMessageDeleted);
      ws?.off('group:member_banned', onMemberBanned);
      ws?.off('group:member_kicked', onMemberKicked);
      ws?.off('group:member_promoted', onMemberPromoted);
      ws?.off('group:member_demoted', onMemberDemoted);
      ws?.off('group:message_read', onMessageRead);
      ws?.off('group:reaction', onReaction);
      ws?.off('group:request_new', onRequestNew);
      ws?.off('group:request_approved', onRequestApproved);
      ws?.off('group:request_rejected', onRequestRejected);
      ws?.off('group:member_joined', onMemberJoined);
      ws?.emit('leave:group', { groupId });
      joinedRef.current = false;
    };
  }, [user, groupId, router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const isAdmin = group?.members?.find(m => m.userId === user?.id)?.isAdmin || user?.id === group?.ownerId || false;
  const isOwner = user?.id === group?.ownerId || false;

  // Auto-fetch invite link when admin opens info panel
  useEffect(() => {
    if (showInfo && isAdmin && isMember && !inviteLink) {
      fetchInviteLink();
    }
  }, [showInfo, isAdmin, isMember]);

  // Join group
  const handleJoin = async () => {
    setJoining(true);
    try {
      const res = await socialApi.joinGroup(groupId);
      const data = res.data?.data || res.data;
      if (data?.requested) {
        toast.success('Заявка отправлена! Ожидайте одобрения владельца.');
        setIsMember(false);
      } else {
        setIsMember(true);
        toast.success('Вы вступили в группу!');
        const mRes = await socialApi.getGroupMessages(groupId);
        const msgs = mRes.data?.data || mRes.data;
        setMessages(msgs?.messages || msgs || []);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Ошибка');
    } finally {
      setJoining(false);
    }
  };

  // Toggle favorite
  const handleToggleFavorite = async () => {
    try {
      const res = await socialApi.toggleFavorite(groupId);
      const data = res.data?.data || res.data;
      setGroup(prev => prev ? { ...prev, isFavorited: data.favorited } : prev);
      toast.success(data.favorited ? 'Добавлено в избранное' : 'Удалено из избранного');
    } catch {
      toast.error('Ошибка');
    }
  };

  // Send reaction
  const toggleReaction = useCallback((messageId: string, emoji: string) => {
    const ws = getSocket();
    if (!ws) return;
    ws.emit('group:reaction', { groupId, messageId, emoji });
    setReactionPickerMsgId(null);
  }, [groupId]);

  // Mark message as read
  const markAsRead = useCallback((messageId: string) => {
    if (!user?.id || readSentRef.current.has(messageId)) return;
    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.senderId === user.id) return;
    if (msg.readBy?.includes(user.id)) return;
    readSentRef.current.add(messageId);
    const ws = getSocket();
    ws?.emit('group:message_read', { groupId, messageId });
  }, [groupId, user, messages]);

  // Auto-read visible messages on scroll
  useEffect(() => {
    const container = document.querySelector('.overflow-y-auto');
    if (!container || !user?.id) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const msgId = entry.target.getAttribute('data-msg-id');
          if (msgId) markAsRead(msgId);
        }
      });
    }, { root: container, threshold: 0.8 });
    container.querySelectorAll('[data-msg-id]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [messages, user?.id, markAsRead]);

  // Upload media
  const handleFileUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const res = await socialApi.uploadGroupMedia(groupId, Array.from(files));
      const urls = res.data?.urls || res.data?.data?.urls || [];
      setPendingImages(prev => [...prev, ...urls]);
    } catch {
      toast.error('Ошибка загрузки файлов');
    } finally {
      setUploading(false);
    }
  };

  // Send message
  const sendMessage = useCallback(() => {
    const hasContent = input.trim().length > 0;
    const hasImages = pendingImages.length > 0;
    if (!hasContent && !hasImages) return;

    const ws = getSocket();
    if (!ws?.connected) {
      toast.error(t('groupDetails.noConnection'));
      return;
    }
    const trimmed = input.trim();
    const images = pendingImages.length > 0 ? pendingImages : undefined;
    setInput('');
    setPendingImages([]);
    ws.emit('group:message', { groupId, content: trimmed, images }, (ack: any) => {
      if (ack?.error) {
        toast.error('Не удалось отправить сообщение');
        // Only restore the failed text/images if the box is still empty —
        // if the user already typed something new while the ack was
        // in flight, don't clobber it with the stale failed draft.
        setInput(prev => prev || trimmed);
        setPendingImages(prev => prev.length > 0 ? prev : (images || []));
      }
    });
  }, [input, pendingImages, groupId, t]);

  // Insert an emoji into the compose field instead of sending it as a
  // standalone oversized "sticker" message — these packs are just emoji.
  const insertEmoji = (emoji: string) => {
    setInput(prev => prev + emoji);
  };

  const removePendingImage = (idx: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== idx));
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
      // The REST call removes membership server-side, but the socket stays
      // subscribed to the group's room until it explicitly leaves — without
      // this it keeps receiving group:message/group:updated events for a
      // group the user is no longer part of.
      getSocket()?.emit('leave:group', { groupId });
      setIsMember(false);
      setMessages([]);
      toast.success(t('groupDetails.left'));
    } catch { toast.error(t('groupDetails.error')); }
  };

  // Invite link
  const fetchInviteLink = async () => {
    try {
      const res = await socialApi.getInviteLink(groupId);
      const data = res.data?.data || res.data;
      setInviteLink(data.inviteToken);
    } catch {}
  };

  const copyInviteLink = () => {
    if (!inviteLink) return;
    const url = `${window.location.origin}/groups/join/${inviteLink}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Ссылка скопирована'));
  };

  const shareInviteLink = () => {
    if (!inviteLink) return;
    const url = `${window.location.origin}/groups/join/${inviteLink}`;
    if (navigator.share) {
      navigator.share({ title: group?.name, url }).catch(() => {});
    } else {
      copyInviteLink();
    }
  };

  const regenerateInviteLink = async () => {
    try {
      const res = await socialApi.regenerateInviteLink(groupId);
      const data = res.data?.data || res.data;
      setInviteLink(data.inviteToken);
      toast.success('Ссылка обновлена');
    } catch { toast.error('Ошибка'); }
  };

  // Message moderation
  const handleDeleteMessage = async (messageId: string) => {
    try {
      await socialApi.deleteMessage(groupId, messageId);
      setMessages(prev => prev.filter(m => m.id !== messageId));
      setContextMenu(null);
      toast.success('Сообщение удалено');
    } catch { toast.error('Ошибка удаления'); }
  };

  // Member moderation
  const handleBanMember = async (targetUserId: string) => {
    try {
      await socialApi.banMember(groupId, targetUserId);
      setMemberAction(null);
      toast.success('Пользователь заблокирован');
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Ошибка'); }
  };

  const handleKickMember = async (targetUserId: string) => {
    try {
      await socialApi.kickMember(groupId, targetUserId);
      setMemberAction(null);
      toast.success('Пользователь исключён');
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Ошибка'); }
  };

  const handlePromoteMember = async (targetUserId: string) => {
    try {
      await socialApi.promoteMember(groupId, targetUserId);
      setMemberAction(null);
      toast.success('Пользователь назначен админом');
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Ошибка'); }
  };

  const handleDemoteMember = async (targetUserId: string) => {
    try {
      await socialApi.demoteMember(groupId, targetUserId);
      setMemberAction(null);
      toast.success('Пользователь снят с админа');
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Ошибка'); }
  };

  const handleApproveRequest = async (requestId: string) => {
    try {
      await socialApi.approveRequest(groupId, requestId);
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
      toast.success('Заявка одобрена');
      // Refresh group data
      const res = await socialApi.getGroup(groupId);
      setGroup(res.data?.data || res.data);
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Ошибка'); }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      await socialApi.rejectRequest(groupId, requestId);
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
      toast.success('Заявка отклонена');
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Ошибка'); }
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


  return (
    <div className="min-h-dvh bg-dark-bg flex flex-col pb-safe-bottom">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-dark-bg/95 backdrop-blur-md px-4 pt-4 pb-3 flex items-center gap-3 border-b border-dark-border">
        <Link href="/groups" className="text-gray-400 hover:text-dark-text transition-all flex items-center">
          <FaArrowLeft size={16} />
        </Link>
        <button onClick={() => setShowInfo(true)} className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center text-white font-bold text-sm overflow-hidden flex-shrink-0">
            {group.avatar ? <img src={mediaUrl(group.avatar)} alt="" className="w-full h-full object-cover" /> : <FaUsers size={16} />}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-dark-text font-semibold truncate">{group.name}</p>
            <p className="text-xs text-gray-500">{group.memberCount} {t('groupDetails.members')}</p>
          </div>
          <FaChevronRight size={12} className="text-gray-500 flex-shrink-0" />
        </button>
        <button onClick={handleToggleFavorite}
          className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all ${
            group.isFavorited ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'
          }`}>
          <FaStar size={16} fill={group.isFavorited ? 'currentColor' : 'none'} />
        </button>
        {isMember && (
          <button onClick={() => setShowMembers(!showMembers)}
            className="px-3 py-1.5 rounded-lg bg-dark-surface text-gray-400 text-xs hover:bg-dark-border">
            {showMembers ? t('groupDetails.chat') : t('groupDetails.members')}
          </button>
        )}
        {isMember && (
          <VoiceChat groupId={groupId} />
        )}
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
        {showMembers && isMember && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-dark-border">
            <div className="p-4 space-y-2">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{t('groupDetails.members')} ({group.members?.length})</p>
              {group.members?.map(m => (
                <div key={m.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                    {m.user?.avatar ? <img src={mediaUrl(m.user.avatar)} alt="" className="w-full h-full object-cover" /> : m.user?.displayName?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <span className="text-sm text-dark-text">{m.user.displayName}</span>
                  {m.isAdmin && <span className="text-[10px] text-primary-400 bg-primary-600/20 px-1.5 py-0.5 rounded">{t('groupDetails.admin')}</span>}
                </div>
              ))}
              {isMember && !isOwner && (
                <button onClick={leaveGroup} className="mt-3 text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                  <FaSignOutAlt size={10} /> {t('groupDetails.leave')}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit panel */}
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-dark-border">
            <div className="p-4 space-y-2">
              <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                className="input-field text-sm" placeholder={t('groupDetails.nameLabel')} />
              <input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                className="input-field text-sm" placeholder={t('groupDetails.descriptionLabel')} />
              <input value={editForm.city} onChange={e => setEditForm(p => ({ ...p, city: e.target.value }))}
                className="input-field text-sm" placeholder={t('groupDetails.cityLabel')} />
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)}
                  className="flex-1 py-2 rounded-xl text-sm bg-dark-surface text-gray-400 hover:bg-dark-border">{t('groupDetails.cancel')}</button>
                <button onClick={handleEditGroup} disabled={editLoading}
                  className="flex-1 py-2 rounded-xl text-sm bg-primary-600 text-white hover:bg-primary-500 flex items-center justify-center gap-1">
                  {editLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><FaSave size={12} /> {t('groupDetails.save')}</>}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* NOT A MEMBER — show join screen */}
      {!isMember ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center text-white text-3xl font-bold overflow-hidden">
            {group.avatar ? <img src={mediaUrl(group.avatar)} alt="" className="w-full h-full object-cover" /> : group.name[0]?.toUpperCase()}
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-dark-text mb-1">{group.name}</h2>
            {group.description && <p className="text-sm text-gray-400 mb-2">{group.description}</p>}
            <p className="text-xs text-gray-500">{group.memberCount} {t('groupDetails.members')}</p>
          </div>
          {requestStatus === 'PENDING' ? (
            <div className="px-8 py-3 rounded-xl bg-yellow-600/20 text-yellow-400 text-sm font-semibold flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
              Запрос отправлен
            </div>
          ) : requestStatus === 'REJECTED' ? (
            <div className="text-center space-y-2">
              <p className="text-xs text-red-400">Заявка отклонена</p>
              <button onClick={handleJoin} disabled={joining}
                className="btn-primary px-8 py-3 flex items-center gap-2 text-sm font-semibold disabled:opacity-50">
                {joining ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><FaSignInAlt size={14} /> Подать заново</>}
              </button>
            </div>
          ) : (
            <button onClick={handleJoin} disabled={joining}
              className="btn-primary px-8 py-3 flex items-center gap-2 text-sm font-semibold disabled:opacity-50">
              {joining ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><FaSignInAlt size={14} /> Подать заявку</>}
            </button>
          )}
          <button onClick={() => setShowInfo(true)}
            className="text-xs text-gray-500 hover:text-primary-400 flex items-center gap-1">
            <FaInfoCircle size={12} /> Подробнее о группе
          </button>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" onClick={() => { setContextMenu(null); setReactionPickerMsgId(null); setShowReadBy(null); }}>
            {messages.filter(m => !m.isDeleted).map(msg => {
              const showDelete = isAdmin || msg.senderId === user.id;
              const isOwn = msg.senderId === user.id;
              const readByArr = msg.readBy || [];
              const reactions = msg.reactions || {};
              const reactionEntries = Object.entries(reactions).filter(([, users]) => users.length > 0);
              const memberCount = group?.members?.length || 0;
              const allRead = readByArr.length >= 1;
              const readByNames = readByArr.map(uid => {
                const m = group?.members?.find((mem: GroupMember) => mem.userId === uid);
                return m?.user?.displayName || uid.slice(0, 8);
              });
              return (
              <div key={msg.id} data-msg-id={msg.id}
                className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                onContextMenu={(e) => {
                  if (!showDelete) return;
                  e.preventDefault();
                  setContextMenu({ messageId: msg.id, senderId: msg.senderId, x: e.clientX, y: e.clientY });
                }}
                onDoubleClick={() => {
                  if (!showDelete) return;
                  if (!confirm('Удалить сообщение?')) return;
                  handleDeleteMessage(msg.id);
                }}
                onClick={(e) => { e.stopPropagation(); setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id); }}
              >
                <div className={`max-w-[80%] relative group ${
                  msg.sticker ? 'text-6xl py-1' : `px-4 py-2.5 rounded-2xl ${
                    isOwn
                      ? 'bg-primary-600 text-white rounded-br-md'
                      : 'bg-dark-surface text-dark-text rounded-bl-md'
                  }`
                }`}>
                  {!isOwn && !msg.sticker && (
                    <p className="text-[10px] text-primary-300 font-medium mb-1">{msg.sender?.displayName || msg.senderId}</p>
                  )}
                  {msg.sticker && <span className="block">{msg.sticker}</span>}
                  {msg.images && msg.images.length > 0 && (
                    <div className={`flex gap-1 flex-wrap ${msg.images.length === 1 ? '' : 'mb-1'}`}>
                      {msg.images.map((img, i) => (
                        <div key={i} className="rounded-lg overflow-hidden max-w-[240px]">
                          {img.match(/\.(mp4|webm|mov)$/i) ? (
                            <video src={BASE_URL + img} controls className="w-full max-h-[300px] object-cover" preload="metadata" />
                          ) : (
                            <img src={BASE_URL + img} alt="" className="w-full max-h-[300px] object-cover cursor-pointer"
                              onClick={() => window.open(BASE_URL + img, '_blank')} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.audioUrl && (
                    <div className={`py-1`}>
                      <AudioMessagePlayer
                        src={BASE_URL + msg.audioUrl}
                        isOwn={isOwn}
                      />
                    </div>
                  )}
                  {msg.videoUrl && (
                    <div className="py-1">
                      <VideoMessagePlayer
                        src={BASE_URL + msg.videoUrl}
                        isOwn={isOwn}
                      />
                    </div>
                  )}
                  {msg.content && !msg.sticker && (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {!msg.sticker && (
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <p className="text-[10px] opacity-50">
                        {new Date(msg.createdAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {isOwn && (
                        readByArr.length > 0
                          ? <span className="text-[10px] text-blue-300">✓✓</span>
                          : <span className="text-[10px] opacity-50">✓</span>
                      )}
                    </div>
                  )}

                  {/* Read by indicator for own messages (tap to expand) */}
                  {isOwn && readByArr.length > 0 && !msg.sticker && (
                    <button onClick={(e) => { e.stopPropagation(); setShowReadBy(showReadBy === msg.id ? null : msg.id); }}
                      className="text-[10px] text-blue-300/70 hover:text-blue-300 text-left">
                      {readByArr.length > 0 && (
                        showReadBy === msg.id
                          ? `✓✓ ${readByNames.join(', ')}`
                          : `✓✓ ${readByNames.length}`
                      )}
                    </button>
                  )}

                  {/* Reactions display */}
                  {reactionEntries.length > 0 && !msg.sticker && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {reactionEntries.map(([emoji, users]) => {
                        const reacted = users.includes(user?.id || '');
                        return (
                          <button key={emoji} onClick={(e) => { e.stopPropagation(); toggleReaction(msg.id, emoji); }}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs transition-all ${
                              reacted ? 'bg-primary-600/30 border border-primary-500/50' : 'bg-white/10 border border-white/5 hover:bg-white/15'
                            }`}>
                            <span>{emoji}</span>
                            <span className={`text-[10px] ${isOwn ? 'text-white/70' : 'text-gray-400'}`}>{users.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Reaction picker popup */}
                  {reactionPickerMsgId === msg.id && (
                    <div className={`absolute ${isOwn ? 'right-0' : 'left-0'} -top-10 z-20 flex gap-1 bg-dark-card/95 backdrop-blur-xl rounded-xl px-2 py-1.5 border border-white/10 shadow-xl`}
                      onClick={(e) => e.stopPropagation()}>
                      {QUICK_REACTIONS.map(emoji => (
                        <button key={emoji} onClick={() => toggleReaction(msg.id, emoji)}
                          className="w-8 h-8 flex items-center justify-center text-lg hover:bg-white/10 rounded-lg transition-all active:scale-125">
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Pending images */}
          <AnimatePresence>
            {pendingImages.length > 0 && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="px-4 py-2 border-t border-dark-border overflow-hidden">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {pendingImages.map((img, i) => (
                    <div key={i} className="relative flex-shrink-0">
                      <img src={BASE_URL + img} alt="" className="w-16 h-16 rounded-lg object-cover" />
                      <button onClick={() => removePendingImage(i)}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center">
                        <FaTimes size={8} />
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Emoji picker */}
          <AnimatePresence>
            {showStickers && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="border-t border-dark-border overflow-hidden bg-dark-surface">
                <div className="p-3">
                  <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
                    {STICKER_PACKS.map((pack, i) => (
                      <button key={pack.id} onClick={() => setActiveStickerPack(i)}
                        className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all ${
                          activeStickerPack === i ? 'bg-primary-600 text-white' : 'bg-dark-bg text-gray-400'
                        }`}>
                        {pack.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-8 gap-0.5">
                    {STICKER_PACKS[activeStickerPack].stickers.map((s, i) => (
                      <button key={i} onClick={() => insertEmoji(s)}
                        className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-dark-bg rounded-lg transition-all active:scale-90">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input */}
          <div className="px-4 py-3 border-t border-dark-border">
            {uploading && (
              <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
                <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                Загрузка файлов...
              </div>
            )}
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden"
                onChange={e => handleFileUpload(e.target.files)} />

              <button onClick={() => fileInputRef.current?.click()}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-dark-surface text-gray-400 hover:text-primary-400 hover:bg-dark-border transition-all">
                <FaImage size={16} />
              </button>

              <button onClick={() => setShowStickers(!showStickers)}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                  showStickers ? 'bg-primary-600 text-white' : 'bg-dark-surface text-gray-400 hover:text-primary-400 hover:bg-dark-border'
                }`}>
                <FaSmile size={16} />
              </button>

              <AudioRecorderButton groupId={groupId} />

              <VideoMessageRecorder groupId={groupId} />

              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                className="input-field flex-1 text-sm" placeholder={t('groupDetails.messagePlaceholder')} />

              <button onClick={sendMessage} disabled={!input.trim() && pendingImages.length === 0}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary-600 text-white hover:bg-primary-500 transition-all disabled:opacity-50">
                <FaPaperPlane size={14} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Context menu (message long-press / right-click) */}
      {contextMenu && (
        <div className="fixed z-[60]" style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}>
          <div className="bg-dark-card border border-dark-border rounded-xl shadow-2xl py-1 min-w-[140px] animate-in fade-in slide-in-from-top-2 duration-150">
            {(isAdmin || contextMenu.senderId === user.id) && (
              <button onClick={() => handleDeleteMessage(contextMenu.messageId)}
                className="w-full px-4 py-2.5 text-left text-sm text-red-400 hover:bg-dark-surface flex items-center gap-2 transition-colors">
                <FaTrash size={12} /> Удалить
              </button>
            )}
          </div>
        </div>
      )}

      {/* Member action modal */}
      <AnimatePresence>
        {memberAction && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center"
            onClick={() => setMemberAction(null)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="w-full max-w-lg bg-dark-card rounded-t-2xl p-4 pb-8 space-y-1"
              onClick={e => e.stopPropagation()}>
              <p className="text-dark-text font-semibold text-center mb-3">{memberAction.username}</p>
              {/* Promote/demote require group ownership on the backend —
                  only the owner can act on another admin at all. */}
              {isOwner && !memberAction.isAdmin && (
                <button onClick={() => { handlePromoteMember(memberAction.userId); }}
                  className="w-full py-3 text-left text-sm text-primary-400 hover:bg-dark-surface rounded-xl flex items-center gap-3 px-4 transition-colors">
                  <FaUserShield size={14} /> Сделать админом
                </button>
              )}
              {isOwner && memberAction.isAdmin && (
                <button onClick={() => { handleDemoteMember(memberAction.userId); }}
                  className="w-full py-3 text-left text-sm text-gray-400 hover:bg-dark-surface rounded-xl flex items-center gap-3 px-4 transition-colors">
                  <FaUserMinus size={14} /> Снять админа
                </button>
              )}
              <div className="border-t border-dark-border my-1" />
              {/* Kicking/banning a fellow admin is owner-only on the backend */}
              {(isOwner || !memberAction.isAdmin) && (
                <>
                  <button onClick={() => { handleKickMember(memberAction.userId); }}
                    className="w-full py-3 text-left text-sm text-orange-400 hover:bg-dark-surface rounded-xl flex items-center gap-3 px-4 transition-colors">
                    <FaUserMinus size={14} /> Исключить
                  </button>
                  <button onClick={() => { handleBanMember(memberAction.userId); }}
                    className="w-full py-3 text-left text-sm text-red-400 hover:bg-dark-surface rounded-xl flex items-center gap-3 px-4 transition-colors">
                    <FaUserSlash size={14} /> Заблокировать
                  </button>
                </>
              )}
              <button onClick={() => setMemberAction(null)}
                className="w-full py-3 text-center text-sm text-gray-500 hover:bg-dark-surface rounded-xl mt-2 transition-colors">
                Отмена
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Group Info Panel (Telegram-style) */}
      <AnimatePresence>
        {showInfo && (
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-50 bg-dark-bg flex flex-col">
            <div className="px-4 pt-4 pb-3 flex items-center gap-3 border-b border-dark-border">
              <button onClick={() => setShowInfo(false)} className="text-gray-400 hover:text-dark-text">
                <FaArrowLeft size={16} />
              </button>
              <h2 className="text-dark-text font-semibold">{t('groupDetails.info')}</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col items-center py-8 px-4">
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center text-white text-3xl font-bold mb-4 overflow-hidden">
                  {group.avatar ? <img src={mediaUrl(group.avatar)} alt="" className="w-full h-full object-cover" /> : group.name[0]?.toUpperCase()}
                </div>
                <h3 className="text-xl font-bold text-dark-text text-center">{group.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  {group.isPublic ? (
                    <span className="flex items-center gap-1 text-xs text-green-400"><FaGlobe size={10} /> Публичная</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-yellow-400"><FaLock size={10} /> Приватная</span>
                  )}
                </div>
              </div>
              <div className="px-4 space-y-3">
                {group.description && (
                  <div className="bg-dark-surface rounded-xl p-4">
                    <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wider">{t('groupDetails.description')}</p>
                    <p className="text-sm text-dark-text leading-relaxed">{group.description}</p>
                  </div>
                )}
                <div className="bg-dark-surface rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <FaUsers size={14} className="text-primary-400" />
                    <div>
                      <p className="text-sm text-dark-text font-medium">{group.memberCount} {t('groupDetails.members')}</p>
                      <p className="text-[10px] text-gray-500">Участников в группе</p>
                    </div>
                  </div>
                  {group.city && (
                    <div className="flex items-center gap-3">
                      <FaMapMarkerAlt size={14} className="text-primary-400" />
                      <div>
                        <p className="text-sm text-dark-text font-medium">{group.city}</p>
                        <p className="text-[10px] text-gray-500">Город</p>
                      </div>
                    </div>
                  )}
                  {group.region && (
                    <div className="flex items-center gap-3">
                      <FaMapMarkerAlt size={14} className="text-accent-400" />
                      <div>
                        <p className="text-sm text-dark-text font-medium">{group.region}</p>
                        <p className="text-[10px] text-gray-500">Регион</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <FaCalendarAlt size={14} className="text-primary-400" />
                    <div>
                      <p className="text-sm text-dark-text font-medium">
                        {new Date(group.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                      <p className="text-[10px] text-gray-500">Дата создания</p>
                    </div>
                  </div>
                  {group.owner && (
                    <div className="flex items-center gap-3">
                      <FaCrown size={14} className="text-yellow-400" />
                      <div>
                        <p className="text-sm text-dark-text font-medium">{group.owner.displayName}</p>
                        <p className="text-[10px] text-gray-500">Владелец</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Invite link (admin/owner only) */}
                {isAdmin && isMember && (
                  <div className="bg-dark-surface rounded-xl p-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <FaLink size={10} /> Инвайт-ссылка
                    </p>
                    {inviteLink ? (
                      <div className="space-y-2">
                        <div className="bg-dark-bg rounded-lg px-3 py-2 flex items-center gap-2">
                          <p className="text-xs text-gray-400 truncate flex-1 font-mono">
                            {`${typeof window !== 'undefined' ? window.location.origin : ''}/groups/join/${inviteLink}`}
                          </p>
                          <button onClick={copyInviteLink} className="text-primary-400 hover:text-primary-300 flex-shrink-0">
                            <FaCopy size={12} />
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={shareInviteLink}
                            className="flex-1 py-2 text-xs rounded-lg bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 flex items-center justify-center gap-1 transition-colors">
                            <FaLink size={10} /> Поделиться
                          </button>
                          {isOwner && (
                            <button onClick={regenerateInviteLink}
                              className="flex-1 py-2 text-xs rounded-lg bg-dark-bg text-gray-400 hover:bg-dark-border flex items-center justify-center gap-1 transition-colors">
                              <FaLink size={10} /> Обновить
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button onClick={fetchInviteLink}
                        className="w-full py-2 text-xs rounded-lg bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 flex items-center justify-center gap-1 transition-colors">
                        <FaLink size={10} /> Создать ссылку
                      </button>
                    )}
                  </div>
                )}

                {/* Pending requests (admin only) */}
                {isAdmin && isMember && pendingRequests.length > 0 && (
                  <div className="bg-dark-surface rounded-xl p-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      📩 Заявки на вступление ({pendingRequests.length})
                    </p>
                    <div className="space-y-2">
                      {pendingRequests.map(req => (
                        <div key={req.id} className="flex items-center gap-3 py-2">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white text-xs font-bold overflow-hidden flex-shrink-0">
                            {req.user?.avatar ? <img src={mediaUrl(req.user.avatar)} alt="" className="w-full h-full object-cover" /> : req.user?.displayName?.[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-dark-text font-medium truncate">{req.user.displayName}</p>
                            <p className="text-[10px] text-gray-500">{req.user.city || 'Без города'}</p>
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => handleApproveRequest(req.id)}
                              className="px-3 py-1.5 rounded-lg bg-green-600/20 text-green-400 text-xs hover:bg-green-600/30 transition-colors">
                              ✓
                            </button>
                            <button onClick={() => handleRejectRequest(req.id)}
                              className="px-3 py-1.5 rounded-lg bg-red-600/20 text-red-400 text-xs hover:bg-red-600/30 transition-colors">
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Members list */}
                <div className="bg-dark-surface rounded-xl p-4">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-3">
                    {t('groupDetails.members')} ({group.members?.length || 0})
                  </p>
                  <div className="space-y-2">
                    {group.members?.map(m => (
                      <div key={m.id}
                        className={`flex items-center gap-3 py-1 ${isAdmin && m.userId !== user.id && m.userId !== group.ownerId ? 'cursor-pointer hover:bg-dark-bg rounded-xl px-1 -mx-1 transition-colors' : ''}`}
                        onClick={() => {
                          if (isAdmin && m.userId !== user.id && m.userId !== group.ownerId) {
                            setMemberAction({ userId: m.userId, username: m.user.displayName, isAdmin: m.isAdmin });
                          }
                        }}
                      >
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white text-xs font-bold overflow-hidden flex-shrink-0">
                          {m.user?.avatar ? <img src={mediaUrl(m.user.avatar)} alt="" className="w-full h-full object-cover" /> : m.user?.displayName?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-dark-text font-medium truncate">{m.user.displayName}</p>
                          <p className="text-[10px] text-gray-500">@{m.user.username || '—'}</p>
                        </div>
                        {m.isAdmin && <FaShieldAlt size={12} className="text-primary-400 flex-shrink-0" />}
                        {m.userId === group.ownerId && <FaCrown size={12} className="text-yellow-400 flex-shrink-0" />}
                        {isAdmin && m.userId !== user.id && m.userId !== group.ownerId && (
                          <FaChevronRight size={10} className="text-gray-500 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {!isMember ? (
                  requestStatus === 'PENDING' ? (
                    <div className="w-full py-3 rounded-xl bg-yellow-600/20 text-yellow-400 text-sm font-medium flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                      Запрос отправлен
                    </div>
                  ) : requestStatus === 'REJECTED' ? (
                    <div className="space-y-2">
                      <p className="text-xs text-red-400 text-center">Заявка отклонена</p>
                      <button onClick={handleJoin} disabled={joining}
                        className="w-full py-3 rounded-xl bg-primary-600 text-white hover:bg-primary-500 text-sm font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                        {joining ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><FaSignInAlt size={14} /> Подать заново</>}
                      </button>
                    </div>
                  ) : (
                    <button onClick={handleJoin} disabled={joining}
                      className="w-full py-3 rounded-xl bg-primary-600 text-white hover:bg-primary-500 text-sm font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                      {joining ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><FaSignInAlt size={14} /> Подать заявку</>}
                    </button>
                  )
                ) : !isOwner ? (
                  <button onClick={leaveGroup}
                    className="w-full py-3 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 text-sm font-medium flex items-center justify-center gap-2 transition-all">
                    <FaSignOutAlt size={14} /> {t('groupDetails.leave')}
                  </button>
                ) : null}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
