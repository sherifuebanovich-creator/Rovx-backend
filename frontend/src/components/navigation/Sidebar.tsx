'use client';
import { motion } from 'framer-motion';
import { FaTimes, FaUser, FaRoute, FaBookmark, FaTrophy, FaCog, FaSignOutAlt,
         FaStar, FaMap, FaCar, FaTruck, FaCrown, FaChevronRight, FaBell } from 'react-icons/fa';
import { signOut } from 'next-auth/react';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import Image from 'next/image';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

export function Sidebar() {
  const { t } = useTranslation();
  const toggleSidebar = useMapStore(s => s.toggleSidebar);
  const vehicleMode = useMapStore(s => s.vehicleMode);
  const setVehicleMode = useMapStore(s => s.setVehicleMode);
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    await signOut({ redirect: false });
    logout();
    toggleSidebar();
    toast.success(t('sidebar.loggedOut'));
  };

  const stats = [
    { label: t('sidebar.trips'), value: user?.totalTrips ?? 0, icon: <FaRoute size={11} /> },
    { label: t('sidebar.km'), value: Math.round(user?.totalDistance ?? 0), icon: <FaMap size={11} /> },
    { label: t('sidebar.score'), value: user?.driverScore?.toFixed(1) ?? '5.0', icon: <FaStar size={11} /> },
    { label: t('sidebar.rep'), value: user?.reputation ?? 0, icon: <FaTrophy size={11} /> },
  ];

  const menuItems = [
    { icon: <FaUser size={16} />, label: t('sidebar.profile'), href: '/profile' },
    { icon: <FaRoute size={16} />, label: t('sidebar.savedRoutes'), href: '/routes' },
    { icon: <FaBookmark size={16} />, label: t('sidebar.bookmarks'), href: '/bookmarks' },
    { icon: <FaTrophy size={16} />, label: t('sidebar.achievements'), href: '/achievements' },
    { icon: <FaBell size={16} />, label: t('sidebar.notifications'), href: '/notifications' },
    { icon: <FaCog size={16} />, label: t('sidebar.settings'), href: '/settings' },
  ];

  const tierColors: Record<string, string> = {
    FREE: 'text-gray-400', PREMIUM_BASIC: 'text-primary-400',
    PREMIUM_STANDARD: 'text-accent-400', PREMIUM_MAX: 'text-yellow-400',
  };
  const tierLabels: Record<string, string> = {
    FREE: t('sidebar.free'), PREMIUM_BASIC: t('sidebar.premiumBasic'), PREMIUM_STANDARD: t('sidebar.premiumStandard'), PREMIUM_MAX: t('sidebar.premiumMax'),
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={toggleSidebar} className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm" />

      <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="absolute left-0 top-0 bottom-0 w-72 sm:w-80 z-50 bg-dark-card border-r border-dark-border flex flex-col safe-top">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-dark-border">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt={t('sidebar.brand')} width={32} height={32} className="rounded-lg object-cover" />
            <div>
              <span className="font-display font-bold text-white text-lg">{t('sidebar.brand')}</span>
              <p className="text-[10px] text-primary-400 font-medium -mt-0.5">{t('sidebar.brandSubtitle')}</p>
            </div>
          </div>
          <button onClick={toggleSidebar} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all">
            <FaTimes size={14} className="text-gray-400" />
          </button>
        </div>

        {/* User info */}
        {user ? (
          <div className="px-4 py-4 border-b border-dark-border">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-xl font-bold text-white flex-shrink-0">
                {user.avatar
                  ? <Image src={user.avatar} alt={user.displayName} width={48} height={48} className="rounded-2xl object-cover" />
                  : (user.displayName ?? '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{user.displayName}</p>
                <p className="text-xs text-gray-400 truncate">@{user.username}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <FaCrown size={9} className={tierColors[user.subscription]} />
                  <span className={`text-[10px] font-medium ${tierColors[user.subscription]}`}>{tierLabels[user.subscription] || user.subscription}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              {stats.map((s) => (
                <div key={s.label} className="bg-white/5 rounded-xl p-2 text-center">
                  <p className="text-sm font-bold text-white">{s.value}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5 flex items-center justify-center gap-0.5">
                    <span className="text-primary-400">{s.icon}</span>{s.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="px-4 py-4 border-b border-dark-border">
            <Link href="/auth/login" onClick={toggleSidebar} className="btn-primary w-full flex items-center justify-center gap-2">
              <FaUser size={14} /> {t('sidebar.signIn')}
            </Link>
          </div>
        )}

        {/* Menu items */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {menuItems.map((item) => (
            <Link key={item.label} href={item.href} onClick={toggleSidebar}
              className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 text-gray-300 hover:text-white transition-all group">
              <span className="text-gray-500 group-hover:text-primary-400 transition-colors">{item.icon}</span>
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              <FaChevronRight size={11} className="text-gray-600 group-hover:text-gray-400" />
            </Link>
          ))}
        </div>

        {/* Vehicle mode */}
        <div className="px-4 py-3 border-t border-dark-border">
          <p className="text-xs text-gray-400 mb-2">{t('sidebar.vehicleMode')}</p>
          <div className="flex gap-2">
            <button onClick={() => setVehicleMode('CAR')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                vehicleMode === 'CAR' ? 'bg-primary-600/30 border-primary-500/60 text-white' : 'bg-white/5 border-white/10 text-gray-400'}`}>
              <FaCar size={14} /> {t('sidebar.car')}
            </button>
            <button onClick={() => setVehicleMode('TRUCK')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                vehicleMode === 'TRUCK' ? 'bg-accent-500/30 border-accent-500/60 text-white' : 'bg-white/5 border-white/10 text-gray-400'}`}>
              <FaTruck size={14} /> {t('sidebar.truck')}
            </button>
          </div>
        </div>

        {/* Logout */}
        {user && (
          <div className="px-4 pb-6 pt-3 border-t border-dark-border">
            <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3 py-3 rounded-xl hover:bg-red-600/10 text-gray-400 hover:text-red-400 transition-all">
              <FaSignOutAlt size={16} />
              <span className="text-sm font-medium">{t('sidebar.signOut')}</span>
            </button>
          </div>
        )}
      </motion.div>
    </>
  );
}
