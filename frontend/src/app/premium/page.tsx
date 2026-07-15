'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { premiumApi } from '@/lib/api';
import { PremiumTier, PremiumSubscription } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { FaCrown, FaCheck, FaArrowLeft, FaTimes } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DirectPaymentModal from '@/components/premium/DirectPaymentModal';

const TIER_COLORS = ['text-gray-400', 'text-blue-400', 'text-purple-400', 'text-yellow-400'];
const TIER_BG = [
  'bg-white/5',
  'bg-gradient-to-br from-blue-900/20 to-blue-950/10 backdrop-blur-md',
  'bg-gradient-to-br from-purple-900/30 to-purple-950/10 backdrop-blur-md',
  'bg-gradient-to-br from-amber-900/30 to-yellow-950/10 backdrop-blur-md'
];
const TIER_BORDER = [
  'border-white/10',
  'border-blue-500/40 shadow-[0_0_15px_rgba(59,130,246,0.15)]',
  'border-purple-500/50 shadow-[0_0_20px_rgba(168,85,247,0.2)]',
  'border-yellow-500/60 shadow-[0_0_25px_rgba(234,179,8,0.25)] animate-pulse-slow'
];

function PremiumIcon({ tier, size = 24 }: { tier: number; size?: number }) {
  const colors: Record<number, string> = {
    0: 'text-gray-500',
    1: 'text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]',
    2: 'text-purple-400 drop-shadow-[0_0_10px_rgba(168,85,247,0.6)]',
    3: 'text-yellow-400 drop-shadow-[0_0_12px_rgba(234,179,8,0.7)]'
  };
  return <FaCrown size={size} className={colors[tier] || 'text-primary-400'} />;
}

export default function PremiumPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center items-center min-h-dvh bg-dark-bg"><div className="w-8 h-8 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <PremiumPage />
    </Suspense>
  );
}

function PremiumPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const setUser = useAuthStore(s => s.setUser);
  const [tiers, setTiers] = useState<PremiumTier[]>([]);
  const [mySub, setMySub] = useState<PremiumSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribeLoading, setSubscribeLoading] = useState<string | null>(null);
  const [paymentTier, setPaymentTier] = useState<PremiumTier | null>(null);

  useEffect(() => {
    const success = searchParams.get('success');
    if (success) {
      toast.success(t('premium.paymentSuccess') || 'Оплата прошла успешно!');
    }
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = async () => {
    try {
      const [tiersRes, subRes] = await Promise.allSettled([
        premiumApi.getTiers(i18n.language),
        premiumApi.getMy(),
      ]);
      if (tiersRes.status === 'fulfilled') {
        setTiers(tiersRes.value.data?.data || tiersRes.value.data);
      }
      if (subRes.status === 'fulfilled') {
        setMySub(subRes.value.data?.data || subRes.value.data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async (tier: PremiumTier) => {
    setPaymentTier(tier);
  };

  const handleCancel = async () => {
    try {
      await premiumApi.cancel();
      setMySub(prev => prev ? { ...prev, active: false } : null);
      if (user) {
        setUser({ ...user, subscription: 'FREE' });
      }
      toast.success(t('premium.cancelled'));
    } catch {
      toast.error(t('premium.cancelError'));
    }
  };

  const getTierPrice = (tier: PremiumTier) => {
    const lang = i18n.language;
    if (lang === 'ru' && (tier as any).priceRub) return `${(tier as any).priceRub} ₽`;
    if (lang === 'uz' && (tier as any).priceUzs) return `${(tier as any).priceUzs} сўм`;
    return `$${tier.price}`;
  };

  return (
    <div className="min-h-dvh bg-dark-bg pb-safe-bottom relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-20%] w-[80vw] h-[80vw] rounded-full bg-blue-900/10 blur-[120px] pointer-events-none" />
      <div className="absolute top-[20%] right-[-20%] w-[60vw] h-[60vw] rounded-full bg-purple-900/10 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[10%] w-[50vw] h-[50vw] rounded-full bg-yellow-900/5 blur-[80px] pointer-events-none" />

      <div className="relative px-3 sm:px-4 md:px-6 pt-12 sm:pt-14 md:pt-16 max-w-5xl mx-auto z-10">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-all">
          <FaArrowLeft size={14} /> {t('common.back')}
        </button>

        <div className="text-center mb-8">
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
            className="inline-block"
          >
            <PremiumIcon tier={mySub?.tier || 0} size={56} />
          </motion.div>
          <h1 className="text-3xl font-black text-white font-display mt-4 tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-200 to-gray-400">
            {t('premium.title')}
          </h1>
          <p className="text-gray-400 text-sm mt-1 max-w-xs mx-auto">
            {t('premium.subtitle')}
          </p>
          {mySub?.active && (
            <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/30">
              <FaCheck className="text-green-400 animate-pulse" size={12} />
              <span className="text-green-400 text-xs font-semibold uppercase tracking-wider">
                {mySub.label} {t('premium.activeUntil')} {mySub.endDate ? new Date(mySub.endDate).toLocaleDateString(i18n.language) : ''}
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
            {tiers.filter((tier: PremiumTier) => tier.tier > 0).map((tier: PremiumTier, idx: number) => {
              const isActive = mySub?.name === tier.name && mySub?.active;
              const isCurrent = mySub?.name === tier.name;
              const isPopular = tier.tier === 2;
              const isBest = tier.tier === 3;

              return (
                <motion.div key={tier.name}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1, type: "spring", stiffness: 100 }}
                  whileHover={{ scale: 1.02, y: -2 }}
                  className={`relative card p-6 border-2 transition-all duration-300 overflow-hidden ${
                    isActive ? TIER_BORDER[tier.tier] : 'border-white/5 hover:border-white/20'
                  } ${TIER_BG[tier.tier]}`}
                >
                  <div className={`absolute -right-16 -top-16 w-32 h-32 rounded-full opacity-20 blur-2xl ${
                    tier.tier === 1 ? 'bg-blue-500' : tier.tier === 2 ? 'bg-purple-500' : 'bg-yellow-500'
                  }`} />

                  {isPopular && (
                    <div className="absolute top-3 right-3 bg-purple-600 text-white text-[9px] font-black uppercase px-2.5 py-1 rounded-full tracking-wider shadow-[0_0_10px_rgba(168,85,247,0.4)]">
                      {t('premium.popular')}
                    </div>
                  )}
                  {isBest && (
                    <div className="absolute top-3 right-3 bg-yellow-600 text-black text-[9px] font-black uppercase px-2.5 py-1 rounded-full tracking-wider shadow-[0_0_10px_rgba(234,179,8,0.4)]">
                      {t('premium.bestValue')}
                    </div>
                  )}

                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <PremiumIcon tier={tier.tier} size={20} />
                        <h3 className={`text-xl font-black font-display tracking-wide ${TIER_COLORS[tier.tier]}`}>{tier.label}</h3>
                      </div>
                      <p className="text-3xl font-black text-white mt-2">
                        {getTierPrice(tier)}<span className="text-xs text-gray-400 font-normal tracking-normal"> / {t('premium.perMonth')}</span>
                      </p>
                      {tier.tier === 2 && (
                        <p className="text-[10px] text-purple-300 mt-0.5">🔥 {t('premium.mostPopular')}</p>
                      )}
                      {tier.tier === 3 && (
                        <p className="text-[10px] text-yellow-300 mt-0.5">👑 {t('premium.allIncluded')}</p>
                      )}
                      {tier.tier === 1 && (
                        <p className="text-[10px] text-blue-300 mt-0.5">💡 {t('premium.greatStart')}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5 sm:space-y-2.5 text-xs">
                    {tier.tier >= 1 && (
                      <>
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.allRouteTypes')} />
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.voiceNav')} />
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.instantReports')} />
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.noAds')} />
                      </>
                    )}
                    {tier.tier >= 2 && (
                      <>
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.aiAssistant')} />
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.camerasOnline')} />
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.weatherTraffic')} />
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.groups')} />
                      </>
                    )}
                    {tier.tier >= 3 && (
                      <>
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.unlimitedAI')} />
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features._3dMaps')} />
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.convoys')} />
                        <Feature icon={<FaCheck size={8} />} text={t('premium.features.support247')} />
                      </>
                    )}
                  </div>

                  <button
                    onClick={() => isActive ? handleCancel() : handleSubscribe(tier)}
                    disabled={subscribeLoading === tier.name}
                    className={`w-full mt-5 py-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-300 flex items-center justify-center gap-2 ${
                      isActive
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
                        : tier.tier === 3
                        ? 'bg-gradient-to-r from-yellow-500 to-amber-500 text-black hover:opacity-90 hover:shadow-[0_0_15px_rgba(234,179,8,0.4)]'
                        : tier.tier === 2
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:opacity-90 hover:shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                        : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    {subscribeLoading === tier.name ? (
                      <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : isActive ? (
                      <><FaTimes size={12} /> {t('premium.cancelSubscription')}</>
                    ) : isCurrent ? (
                      t('premium.currentPlan')
                    ) : (
                      <><FaCrown size={12} /> {t('premium.subscribe')}</>
                    )}
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {paymentTier && (
          <DirectPaymentModal
            tierName={paymentTier.name}
            tierLabel={paymentTier.label}
            price={getTierPrice(paymentTier)}
            onClose={() => setPaymentTier(null)}
          />
        )}
      </AnimatePresence>

      <style jsx global>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 5px rgba(234, 179, 8, 0.25)); }
          50% { opacity: 0.8; filter: drop-shadow(0 0 15px rgba(234, 179, 8, 0.45)); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 3s infinite ease-in-out;
        }
      `}</style>
    </div>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2.5">
      <div className="w-4 h-4 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <span className="text-gray-300">{text}</span>
    </div>
  );
}
