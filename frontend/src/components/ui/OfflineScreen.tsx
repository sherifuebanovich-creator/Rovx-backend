'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaWifi } from 'react-icons/fa';

export function OfflineScreen() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    setIsOffline(typeof navigator !== 'undefined' && !navigator.onLine);

    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] bg-dark-bg flex items-center justify-center px-6"
        >
          <div className="bg-dark-card rounded-2xl p-8 text-center max-w-sm w-full border border-dark-border">
            <div className="w-16 h-16 rounded-2xl bg-red-600/20 flex items-center justify-center mx-auto mb-4 relative">
              <FaWifi size={28} className="text-red-400" />
              <div className="absolute w-[calc(100%-8px)] h-0.5 bg-red-400 rotate-45" />
            </div>
            <p className="text-dark-text font-semibold mb-1">Нет подключения к интернету</p>
            <p className="text-sm text-gray-400">Проверьте соединение — приложение восстановится автоматически</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
