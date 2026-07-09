'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaExclamationTriangle, FaCommentDots } from 'react-icons/fa';
import { useMapStore } from '@/store/map.store';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Tab = 'report' | 'chats';

export function BottomBar() {
  const router = useRouter();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('report');
  const toggleReportPanel = useMapStore(s => s.toggleReportPanel);

  const tabs: { id: Tab; icon: React.ReactNode; label: string; action?: () => void; href?: string }[] = [
    { id: 'report', icon: <FaExclamationTriangle size={20} />, label: t('bottombar.report'), action: toggleReportPanel },
    { id: 'chats', icon: <FaCommentDots size={20} />, label: t('bottombar.social'), href: '/chats' },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute bottom-0 left-0 right-0 z-40 safe-bottom flex justify-center">
      <div className="mx-2 sm:mx-4 mb-2 sm:mb-4 w-full max-w-lg">
        <div className="glass-dark rounded-xl sm:rounded-2xl px-1 sm:px-2 py-1.5 sm:py-2 flex items-center justify-around">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const classes = `flex flex-col items-center gap-0.5 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl transition-all relative ${
              isActive ? 'bg-primary-600/30 text-primary-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`;
            const content = (
              <>
                {tab.icon}
                <span className="text-[10px] sm:text-[11px] font-medium leading-none">{tab.label}</span>
                {isActive && (
                  <motion.div layoutId="tab-indicator" className="absolute bottom-0.5 sm:bottom-1 w-1 h-1 rounded-full bg-primary-400" />
                )}
              </>
            );
            if (tab.href) {
              return <Link key={tab.id} href={tab.href} onClick={() => setActiveTab(tab.id)} className={classes}>{content}</Link>;
            }
            return (
              <button key={tab.id} onClick={() => { setActiveTab(tab.id); tab.action?.(); }} className={classes}>
                {content}
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}