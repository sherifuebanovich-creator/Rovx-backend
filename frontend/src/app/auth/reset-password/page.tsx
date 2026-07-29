'use client';
import { Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { FaLock, FaArrowLeft, FaEye, FaEyeSlash } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/lib/api';
import toast from 'react-hot-toast';

const CODE_LENGTH = 6;
const COOLDOWN = 60;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [step, setStep] = useState<'email' | 'code'>(searchParams.get('email') ? 'code' : 'email');
  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSendCode = useCallback(async (targetEmail: string) => {
    if (!targetEmail || isSending || cooldown > 0) return;
    setIsSending(true);
    setError('');
    try {
      await authApi.forgotPassword(targetEmail);
      setStep('code');
      setCooldown(COOLDOWN);
      toast.success(t('auth.resetPassword.codeSent', { email: targetEmail }));
    } catch (err: any) {
      setError(err?.response?.data?.message || t('auth.resetPassword.sendFailed'));
    } finally {
      setIsSending(false);
    }
  }, [isSending, cooldown, t]);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendCode(email);
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullCode = code.join('');
    if (fullCode.length !== CODE_LENGTH) return;
    if (newPassword.length < 8) {
      setError(t('auth.resetPassword.passwordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('auth.resetPassword.passwordMismatch'));
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await authApi.resetPassword(email, fullCode, newPassword);
      toast.success(t('auth.resetPassword.success'));
      router.push('/auth/login');
    } catch (err: any) {
      setError(err?.response?.data?.message || t('auth.resetPassword.failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);
    setError('');
    if (digit && index < CODE_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) inputRefs.current[index - 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!paste) return;
    const next = Array(CODE_LENGTH).fill('');
    for (let i = 0; i < paste.length; i++) next[i] = paste[i];
    setCode(next);
    inputRefs.current[Math.min(paste.length, CODE_LENGTH - 1)]?.focus();
  };

  return (
    <div className="min-h-dvh bg-dark-bg flex flex-col overflow-y-auto safe-bottom safe-top">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-[50vw] h-[50vw] max-w-80 max-h-80 bg-primary-900/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-[40vw] h-[40vw] max-w-64 max-h-64 bg-accent-900/10 rounded-full blur-3xl" />
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
                <FaLock size={18} className="text-primary-400" />
              </div>
              <div>
                <h2 className="font-display font-bold text-xl text-white">{t('auth.resetPassword.title')}</h2>
                <p className="text-sm text-gray-400">
                  {step === 'email' ? t('auth.resetPassword.emailStepSubtitle') : t('auth.resetPassword.codeStepSubtitle')}
                </p>
              </div>
            </div>

            {error && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2 mt-4 mb-2 text-center">
                {error}
              </motion.p>
            )}

            {step === 'email' ? (
              <form onSubmit={handleEmailSubmit} className="mt-4">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auth.resetPassword.emailPlaceholder')}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none focus:border-primary-500/60 mb-4"
                />
                <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={isSending}
                  className="w-full btn-primary py-3.5 flex items-center justify-center gap-2 font-semibold text-base disabled:opacity-50">
                  {isSending ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t('auth.resetPassword.sendCode')}
                </motion.button>
              </form>
            ) : (
              <form onSubmit={handleResetSubmit} className="mt-4">
                <p className="text-sm font-medium text-white mb-4 text-center bg-white/5 rounded-xl py-2.5 px-4 border border-white/10">
                  {email}
                </p>

                <div className="flex items-center justify-center gap-1.5 sm:gap-2.5 mb-4" onPaste={handlePaste}>
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
                      className={`w-9 sm:w-11 h-10 sm:h-12 text-center text-base sm:text-lg font-bold rounded-xl border outline-none transition-all
                        ${digit ? 'border-primary-500/60 bg-primary-600/15 text-white' : 'border-white/10 bg-white/5 text-white'}
                        focus:border-primary-400 focus:bg-primary-600/10 focus:ring-1 focus:ring-primary-400/50`}
                    />
                  ))}
                </div>

                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.resetPassword.newPasswordLabel')}</label>
                <div className="relative mb-3">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('auth.resetPassword.newPasswordPlaceholder')}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-10 text-sm text-white placeholder-gray-600 outline-none focus:border-primary-500/60"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showPassword ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
                  </button>
                </div>

                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.resetPassword.confirmPasswordLabel')}</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 outline-none focus:border-primary-500/60 mb-4"
                />

                <motion.button whileTap={{ scale: 0.97 }} type="submit" disabled={isSubmitting || code.join('').length !== CODE_LENGTH}
                  className="w-full btn-primary py-3.5 flex items-center justify-center gap-2 font-semibold text-base disabled:opacity-50 mb-3">
                  {isSubmitting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t('auth.resetPassword.submit')}
                </motion.button>

                <button
                  type="button"
                  onClick={() => handleSendCode(email)}
                  disabled={isSending || cooldown > 0}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium
                             border border-white/10 bg-white/5 text-gray-300
                             hover:bg-white/10 hover:text-white transition-all
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSending ? (
                    <div className="w-4 h-4 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin" />
                  ) : cooldown > 0 ? (
                    t('auth.resetPassword.resendIn', { s: cooldown })
                  ) : (
                    t('auth.resetPassword.sendCode')
                  )}
                </button>
              </form>
            )}

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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-dark-bg flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
