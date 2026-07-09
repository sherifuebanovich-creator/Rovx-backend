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
    { id: 'report', icon: <FaExclamationTriangle size={16} />, label: t('bottombar.report'), action: toggleReportPanel },
    { id: 'chats', icon: <FaCommentDots size={16} />, label: t('bottombar.social'), href: '/chats' },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute bottom-0 left-0 right-0 z-40 safe-bottom flex justify-center">
      <div className="mx-6 mb-3 w-auto">
        <div className="glass-dark rounded-full px-1 py-1 flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const classes = `flex items-center gap-1.5 px-3 py-2 rounded-full transition-all text-xs font-medium ${
              isActive ? 'bg-primary-600/30 text-primary-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`;
            const content = (
              <>
                {tab.icon}
                <span>{tab.label}</span>
                {isActive && (
                  <motion.div layoutId="tab-indicator" className="w-1 h-1 rounded-full bg-primary-400" />
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