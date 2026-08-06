'use client';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FaCreditCard, FaCheckCircle, FaCopy, FaArrowLeft } from 'react-icons/fa';
import { premiumApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface PaymentDetails {
  cardNumber: string;
  cardHolder: string;
  cardBank: string;
  amount: string;
  currency: string;
}

interface Props {
  tierName: string;
  tierLabel: string;
  price: string;
  onClose: () => void;
}

export default function DirectPaymentModal({ tierName, tierLabel, price, onClose }: Props) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [last4, setLast4] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'details' | 'proof' | 'done'>('details');
  const [detailsError, setDetailsError] = useState(false);

  useEffect(() => {
    // Was called with no tier at all, so the "transfer to card" amount
    // shown below always came back as one fixed global figure regardless of
    // which tier this modal was actually opened for — visibly disagreeing
    // with the correct per-tier `price` prop shown right above it.
    premiumApi.getPaymentDetails(tierName).then(res => {
      setDetails(res.data?.data || res.data);
    }).catch(() => {
      setDetailsError(true);
      toast.error(t('premium.directPayment.loadFailed'));
    });
  }, [t, tierName]);

  // This modal had no keyboard dismissal at all — only a backdrop click —
  // and closing never returned focus to whatever button opened it, so
  // keyboard/screen-reader users lost their place in the page afterward.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const copyCard = () => {
    if (details?.cardNumber) {
      navigator.clipboard.writeText(details.cardNumber.replace(/\s/g, ''));
      toast.success(t('premium.directPayment.cardCopied'));
    }
  };

  const handleSubmit = async () => {
    if (last4.length !== 4) {
      toast.error(t('premium.directPayment.enterLast4Error'));
      return;
    }
    setLoading(true);
    try {
      await premiumApi.directPay(tierName, last4);
      setStep('done');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('premium.directPayment.genericError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-dark-card border border-dark-border rounded-2xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto"
      >
        {step === 'done' ? (
          <div className="text-center py-8">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}>
              <FaCheckCircle size={64} className="text-green-400 mx-auto mb-4" />
            </motion.div>
            <h3 className="text-xl font-bold text-white mb-2">{t('premium.directPayment.submittedTitle')}</h3>
            <p className="text-gray-400 text-sm mb-4">
              {t('premium.directPayment.awaitConfirmation')}<br />
              {t('premium.directPayment.usuallyWithin')}
            </p>
            <button onClick={onClose} className="px-6 py-2 bg-white/10 text-white rounded-xl text-sm hover:bg-white/20 transition-all">
              {t('premium.directPayment.close')}
            </button>
          </div>
        ) : step === 'details' ? (
          <div>
            <button onClick={onClose} className="flex items-center gap-2 text-gray-400 hover:text-white mb-4 text-sm transition-all">
              <FaArrowLeft size={12} /> {t('premium.directPayment.back')}
            </button>

            <div className="text-center mb-6">
              <FaCreditCard size={40} className="text-blue-400 mx-auto mb-3" />
              <h3 className="text-xl font-bold text-white mb-1">{t('premium.directPayment.payTitle', { tier: tierLabel })}</h3>
              <p className="text-2xl font-black text-white">{price}</p>
            </div>

            {details && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
                <p className="text-xs text-gray-400 mb-2 uppercase tracking-wider">{t('premium.directPayment.transferToCard')}</p>
                <div className="flex items-center justify-between bg-white/5 rounded-lg p-3 mb-3">
                  <span className="text-lg font-mono text-white tracking-wider">{details.cardNumber}</span>
                  <button onClick={copyCard} className="text-blue-400 hover:text-blue-300 transition-all">
                    <FaCopy size={16} />
                  </button>
                </div>
                <div className="space-y-1 text-sm">
                  <p className="text-gray-400">{t('premium.directPayment.bank')} <span className="text-white">{details.cardBank}</span></p>
                  <p className="text-gray-400">{t('premium.directPayment.recipient')} <span className="text-white">{details.cardHolder}</span></p>
                  <p className="text-gray-400">{t('premium.directPayment.amount')} <span className="text-white font-bold">{details.amount} {details.currency}</span></p>
                </div>
              </div>
            )}

            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 mb-4">
              <p className="text-yellow-400 text-xs">
                {t('premium.directPayment.exactAmountWarning')}
              </p>
            </div>

            {detailsError && (
              <p className="text-red-400 text-xs text-center mb-3">
                {t('premium.directPayment.detailsLoadFailedInline')}
              </p>
            )}

            <button
              onClick={() => setStep('proof')}
              disabled={!details}
              className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('premium.directPayment.paidNext')}
            </button>
          </div>
        ) : (
          <div>
            <button onClick={() => setStep('details')} className="flex items-center gap-2 text-gray-400 hover:text-white mb-4 text-sm transition-all">
              <FaArrowLeft size={12} /> {t('premium.directPayment.back')}
            </button>

            <div className="text-center mb-6">
              <FaCreditCard size={40} className="text-green-400 mx-auto mb-3" />
              <h3 className="text-xl font-bold text-white mb-1">{t('premium.directPayment.confirmPaymentTitle')}</h3>
              <p className="text-gray-400 text-sm">{t('premium.directPayment.enterLast4Sub')}</p>
            </div>

            <div className="mb-4">
              <label htmlFor="directpayment-last4" className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">{t('premium.directPayment.last4Label')}</label>
              <input
                id="directpayment-last4"
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={last4}
                onChange={e => setLast4(e.target.value.replace(/\D/g, ''))}
                placeholder="0000"
                className="w-full text-center text-3xl font-mono tracking-[0.5em] bg-white/5 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-green-500 transition-all"
                autoFocus
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={last4.length !== 4 || loading}
              className="w-full py-3.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                t('premium.directPayment.submitRequest')
              )}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
