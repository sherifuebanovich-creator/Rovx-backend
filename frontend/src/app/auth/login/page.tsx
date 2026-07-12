'use client';
import { useState, useEffect, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { FaGoogle, FaEye, FaEyeSlash, FaLock, FaUser } from 'react-icons/fa';
import { FiNavigation } from 'react-icons/fi';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { authApi } from '@/lib/api';
import LanguagePicker from '@/components/auth/LanguagePicker';
import toast from 'react-hot-toast';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, i18n } = useTranslation();
  const { setUser, setTokens } = useAuthStore();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [googleLang, setGoogleLang] = useState('en');

  useEffect(() => {
    const errorParam = searchParams?.get('error');
    if (errorParam) {
      const errorMap: Record<string, string> = {
        AccessDenied: 'auth.login.errorDefault',
        OAuthAccountNotLinked: 'auth.login.errorOAuthAccountNotLinked',
        OAuthCallback: 'auth.login.errorOAuthCallback',
        Default: 'auth.login.errorDefault',
      };
      const key = errorMap[errorParam] || errorMap.Default;
      toast.error(t(key));
    }
  }, [searchParams, t]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier || !password) return;
    setIsLoading(true);
    try {
      const res = await authApi.login({ identifier, password });
      const raw = res.data;
      const payload = raw?.data ?? raw;
      const data = payload?.data ?? payload;

      if (data?.needsVerification) {
        const email = data.email || identifier;
        toast.success(t('auth.verify.codeSent'));
        router.push(`/auth/verify?email=${encodeURIComponent(email)}`);
        return;
      }

      const user = data?.user;
      const accessToken = data?.accessToken || data?.access_token;
      const refreshToken = data?.refreshToken;

      if (!accessToken || !user) {
        toast.error(t('auth.login.failed'));
        return;
      }

      setTokens(accessToken, refreshToken);
      setUser(user);
      toast.success(t('auth.login.welcomeBack') + `, ${user.displayName || user.username}!`);
      router.push('/');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('auth.login.failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    try {
      localStorage.setItem('pending_lang', googleLang);
      localStorage.setItem('preferred_lang', googleLang);
      await signIn('google', { callbackUrl: '/' });
    } catch {
      toast.error(t('auth.login.googleFailed'));
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-dark-bg flex flex-col overflow-y-auto safe-bottom safe-top">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[60vw] h-[60vw] max-w-96 max-h-96 bg-primary-900/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] max-w-64 max-h-64 bg-accent-900/10 rounded-full blur-3xl" />
      </div>

      <div className="relative flex-1 flex flex-col items-center px-4 sm:px-6 py-8 sm:py-12">
        <motion.div
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex flex-col items-center gap-4 mb-10"
        >
          <Image src="/logo.png" alt={t('auth.login.brand')} width={80} height={80} className="rounded-2xl shadow-glow-primary object-cover" />
          <div className="text-center">
            <h1 className="font-display text-4xl font-black text-white tracking-tight">{t('auth.login.brand')}</h1>
            <p className="text-primary-400 text-sm font-medium mt-1">{t('auth.login.subtitle')}</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="w-full max-w-sm"
        >
          <div className="card p-6">
            <h2 className="font-display font-bold text-xl text-white mb-1">{t('auth.login.signIn')}</h2>
            <p className="text-sm text-gray-400 mb-6">{t('auth.login.welcomeBack')}</p>

            {/* Language selector for Google sign-in */}
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.login.language')}</label>
              <LanguagePicker value={googleLang} onChange={(code) => { setGoogleLang(code); i18n.changeLanguage(code); }} />
            </div>

            {/* Google OAuth Button */}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleGoogleLogin}
              disabled={isGoogleLoading}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl
                         bg-white hover:bg-gray-100 text-gray-800 font-semibold text-sm
                         transition-all disabled:opacity-60 mb-4 shadow-sm"
            >
              {isGoogleLoading ? (
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
              ) : (
                <FaGoogle size={18} className="text-red-500" />
              )}
              {t('auth.login.continueWithGoogle')}
            </motion.button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-dark-border" />
              <span className="text-xs text-gray-500">{t('auth.login.orPassword')}</span>
              <div className="flex-1 h-px bg-dark-border" />
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.login.emailLabel')}</label>
                <div className="relative">
                  <FaUser size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="input-field pl-9"
                    placeholder={t('auth.login.emailPlaceholder')}
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">{t('auth.login.passwordLabel')}</label>
                <div className="relative">
                  <FaLock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pl-9 pr-10"
                    placeholder={t('auth.login.passwordPlaceholder')}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showPass ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
                  </button>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={isLoading}
                className="w-full btn-primary py-3.5 flex items-center justify-center gap-2 font-semibold text-base disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <FiNavigation size={18} />
                    {t('auth.login.submit')}
                  </>
                )}
              </motion.button>
            </form>

            <p className="text-center text-sm text-gray-400 mt-6">
              {t('auth.login.noAccount')}{' '}
              <Link href="/auth/register" className="text-primary-400 hover:text-primary-300 font-medium">
                {t('auth.login.createOne')}
              </Link>
            </p>
          </div>

          <button
            onClick={() => router.push('/')}
            className="w-full mt-3 py-3 text-sm text-gray-500 hover:text-gray-300 transition-all"
          >
            {t('auth.login.continueWithout')}
          </button>
        </motion.div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-dark-bg flex items-center justify-center"><div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <LoginPageContent />
    </Suspense>
  );
}
