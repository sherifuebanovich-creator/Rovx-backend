'use client';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaBolt, FaCompass, FaGasPump, FaMapMarkerAlt, FaMicrochip, FaMicrophone, FaMicrophoneSlash, FaTimes, FaVolumeMute, FaVolumeUp } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { useVoiceAssistant } from '@/hooks/useVoiceAssistant';
import { useMapStore } from '@/store/map.store';
import { useAuthStore } from '@/store/auth.store';
import { aiApi } from '@/lib/api';
import Image from 'next/image';

interface AiAssistantPanelProps {
  onClose: () => void;
}

interface Suggestion {
  icon: React.ReactNode;
  text: string;
  command: string;
}

export function AiAssistantPanel({ onClose }: AiAssistantPanelProps) {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const userLocation = useMapStore(s => s.userLocation);
  const isAiCoDriverEnabled = useMapStore(s => s.isAiCoDriverEnabled);
  const setAiCoDriver = useMapStore(s => s.setAiCoDriver);
  const {
    isListening, isSpeaking, transcript,
    startListening, stopListening, speak,
  } = useVoiceAssistant();

  const [messages, setMessages] = useState<{ role: 'ai' | 'user'; text: string }[]>([
    {
      role: 'ai',
      text: t('aiAssistantPanel.welcome'),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const suggestionsFetchedRef = useRef(false);

  const lang = user?.preferredLang || 'ru';

  const suggestions: Suggestion[] = [
    { icon: <FaCompass size={14} />, text: t('aiAssistantPanel.suggestions.home'), command: t('aiAssistantPanel.commands.home') },
    { icon: <FaGasPump size={14} />, text: t('aiAssistantPanel.suggestions.gas'), command: t('aiAssistantPanel.commands.gas') },
    { icon: <FaMapMarkerAlt size={14} />, text: t('aiAssistantPanel.suggestions.parking'), command: t('aiAssistantPanel.commands.parking') },
    { icon: <FaBolt size={14} />, text: t('aiAssistantPanel.suggestions.noTraffic'), command: t('aiAssistantPanel.commands.noTraffic') },
  ];

  const processCommand = async (command: string) => {
    setMessages((prev) => [...prev, { role: 'user', text: command }]);
    setIsProcessing(true);
    setInputText('');

    try {
      const res = await aiApi.voiceCommand({ command, lang });
      const result = res.data.data || res.data;

      setMessages((prev) => [...prev, { role: 'ai', text: result.response }]);
      speak(result.response, true);

      // Dispatch action to map
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('roadpilot:voice-action', { detail: result }),
        );
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'ai', text: t('aiAssistantPanel.error') }]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Listen for voice transcripts
  useEffect(() => {
    if (transcript && !isListening) {
      processCommand(transcript);
    }
  }, [transcript, isListening]);

  // Load AI suggestions when location is available (once)
  useEffect(() => {
    if (!userLocation || suggestionsFetchedRef.current) return;
    suggestionsFetchedRef.current = true;
    aiApi.getSuggestions(userLocation.lat, userLocation.lng)
      .then((res) => {
        const sugs: string[] = res.data.data || res.data || [];
        if (sugs.length > 0) {
          sugs.forEach((s) => {
            setMessages((prev) => [...prev, { role: 'ai', text: `💡 ${s}` }]);
          });
        }
      })
      .catch(() => {});
  }, [userLocation]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute inset-0 z-50 flex flex-col bg-dark-bg/98 backdrop-blur-xl"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-safe-top pt-4 pb-4 border-b border-dark-border">
        <div className="relative w-10 h-10 flex-shrink-0">
          <Image src="/logo.png" alt={t('meta.appName')} width={40} height={40} className="rounded-xl object-cover" />
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-bg
            ${isAiCoDriverEnabled ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
        </div>
        <div className="flex-1">
          <h2 className="font-display font-bold text-white">ROVX AI {t('aiAssistantPanel.coDriver')}</h2>
          <p className="text-xs text-gray-400">
            {isListening ? `🎙️ ${t('aiAssistantPanel.statusListening')}` : isSpeaking ? `🔊 ${t('aiAssistantPanel.statusSpeaking')}` : isProcessing ? `⚙️ ${t('aiAssistantPanel.statusProcessing')}` : t('aiAssistantPanel.statusReady')}
          </p>
        </div>

        {/* Co-driver toggle */}
        <button
          onClick={() => setAiCoDriver(!isAiCoDriverEnabled)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            isAiCoDriverEnabled
              ? 'bg-green-600/20 border-green-500/50 text-green-400'
              : 'bg-white/5 border-white/10 text-gray-400'
          }`}
        >
          {isAiCoDriverEnabled ? <FaVolumeUp size={12} /> : <FaVolumeMute size={12} />}
          {t('aiAssistantPanel.coDriver')}
        </button>

        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-all"
        >
          <FaTimes size={16} className="text-gray-400" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'ai' && (
                <div className="w-7 h-7 flex-shrink-0 rounded-full bg-primary-600/30 flex items-center justify-center">
                  <FaMicrochip size={12} className="text-primary-400" />
                </div>
              )}
              <div
                className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                  msg.role === 'ai'
                    ? 'bg-dark-card border border-dark-border text-white rounded-tl-none'
                    : 'bg-primary-600 text-white rounded-tr-none'
                }`}
              >
                {msg.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-2 justify-start"
          >
            <div className="w-7 h-7 flex-shrink-0 rounded-full bg-primary-600/30 flex items-center justify-center">
              <FaMicrochip size={12} className="text-primary-400" />
            </div>
            <div className="bg-dark-card border border-dark-border px-4 py-3 rounded-2xl rounded-tl-none flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Quick suggestions */}
      <div className="px-4 pb-3">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
          {suggestions.map((s) => (
            <button
              key={s.command}
              onClick={() => processCommand(s.command)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10
                         border border-white/10 rounded-full text-xs text-gray-300 transition-all"
            >
              <span className="text-primary-400">{s.icon}</span>
              {s.text}
            </button>
          ))}
        </div>
      </div>

      {/* Input bar */}
      <div className="px-4 pb-safe-bottom pb-6 border-t border-dark-border pt-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && inputText.trim() && processCommand(inputText.trim())}
            placeholder={t('aiAssistantPanel.placeholder')}
            className="input-field flex-1 py-2.5"
          />

          {/* Mic button */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={isListening ? stopListening : startListening}
            className={`w-12 h-12 flex-shrink-0 rounded-xl flex items-center justify-center transition-all ${
              isListening
                ? 'bg-red-600 shadow-[0_0_20px_rgba(220,38,38,0.5)]'
                : 'bg-primary-600 shadow-glow-primary'
            }`}
          >
            {isListening ? (
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
              >
                <FaMicrophoneSlash size={20} className="text-white" />
              </motion.div>
            ) : (
              <FaMicrophone size={20} className="text-white" />
            )}
          </motion.button>
        </div>

        {/* Waveform when listening */}
        <AnimatePresence>
          {isListening && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 flex items-center justify-center gap-1 h-8"
            >
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1 bg-primary-400 rounded-full"
                  animate={{
                    height: [4, Math.random() * 28 + 4, 4],
                  }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    delay: i * 0.05,
                  }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
