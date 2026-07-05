'use client';
import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { FaEnvelope, FaArrowLeft } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/lib/api';
import toast from 'react-hot-toast';

const CODE_LENGTH = 6;
const COOLDOWN = 60;

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const email = searchParams.get('email') || '';

  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!email) router.replace('/auth/login');
  }, [email, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSendCode = useCallback(async () => {
    if (!email || isSending || cooldown > 0) return;
    setIsSending(true);
    setError('');
    try {
      await authApi.sendVerification(email);
      setCooldown(COOLDOWN);
      toast.success(t('auth.verify.codeSent'));
    } catch (err: any) {
      setError(err?.response?.data?.message || t('auth.verify.sendFailed'));
    } finally {
      setIsSending(false);
    }
  }, [email, isSending, cooldown, t]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullCode = code.join('');
    if (fullCode.length !== CODE_LENGTH) return;
    setIsVerifying(true);
    setError('');
    try {
      await authApi.verifyEmail(email, fullCode);
      toast.success(t('auth.verify.success'));
      router.push('/auth/login');
    } catch (err: any) {
      setError(err?.response?.data?.message || t('auth.verify.failed'));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);
    setError('');

    if (digit && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!paste) return;
    const newCode = Array(CODE_LENGTH).fill('');
    for (let i = 0; i < paste.length; i++) {
      newCode[i] = paste[i];
    }
    setCode(newCode);
    const nextIdx = Math.min(paste.length, CODE_LENGTH - 1);
    inputRefs.current[nextIdx]?.focus();
  };

  if (!email) return null;

  return (
    <div className="min-h-dvh bg-dark-bg flex flex-col overflow-y-auto safe-bottom safe-top">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-80 h-80 bg-primary-900/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-64 h-64 bg-accent-900/10 rounded-full blur-3xl" />
      </div>

      <div className="relative flex-1 flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12">
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex items-center gap-3 mb-8">
          <Image src="/logo.png" alt={t('meta.appName')} width={48} height={48} className="rounded-xl object-cover" />
          <div>
            <h1 className="font-display text-2xl font-black text-white">{t('meta.appName')}</h1>
            <p className="text-primary-400 text-xs">{t('meta.tagline')}</p>
          </div>
        </motion.div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="w-full max-w-sm">
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
                <FaEnvelope size={18} className="text-primary-400" />
              </div>
              <div>
                <h2 className="font-display font-bold text-xl text-white">{t('auth.verify.title')}</h2>
                <p className="text-sm text-gray-400">{t('auth.verify.subtitle')}</p>
              </div>
            </div>

            <p className="text-sm font-medium text-white mt-4 mb-6 text-center bg-white/5 rounded-xl py-2.5 px-4 border border-white/10">
              {email}
            </p>

            {error && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 mb-4 text-center">
                {error}
              </motion.p>
            )}

            <form onSubmit={handleVerify}>
              <div className="flex items-center justify-center gap-2.5 mb-6" onPaste={handlePaste}>
                {code.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleCodeChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onFocus={(e) => e.target.select()}
                    className={`w-11 h-12 text-center text-lg font-bold rounded-xl border outline-none transition-all
                      ${digit ? 'border-primary-500/60 bg-primary-600/15 text-white' : 'border-white/10 bg-white/5 text-white'}
                      focus:border-primary-400 focus:bg-primary-600/10 focus:ring-1 focus:ring-primary-400/50
                      ${code.length === CODE_LENGTH && code.every(Boolean) ? 'ring-1 ring-primary-400/40' : ''}
                    `}
                  />
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={isVerifying || code.join('').length !== CODE_LENGTH}
                className="w-full btn-primary py-3.5 flex items-center justify-center gap-2 font-semibold text-base disabled:opacity-50 mb-3"
              >
                {isVerifying ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  t('auth.verify.verify')
                )}
              </motion.button>
            </form>

            <button
              type="button"
              onClick={handleSendCode}
              disabled={isSending || cooldown > 0}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium
                         border border-white/10 bg-white/5 text-gray-300
                         hover:bg-white/10 hover:text-white transition-all
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSending ? (
                <div className="w-4 h-4 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin" />
              ) : cooldown > 0 ? (
                t('auth.verify.resendIn', { s: cooldown })
              ) : (
                t('auth.verify.sendCode')
              )}
            </button>

            <p className="text-center text-sm text-gray-400 mt-6">
              <Link href="/auth/login" className="inline-flex items-center gap-1.5 text-primary-400 hover:text-primary-300 font-medium">
                <FaArrowLeft size={12} />
                {t('common.back')}
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-dark-bg flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <VerifyForm />
    </Suspense>
  );
}
