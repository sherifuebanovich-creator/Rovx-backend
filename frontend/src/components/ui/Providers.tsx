'use client';
import { Component, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect, useState, lazy, Suspense } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useAuthStore } from '@/store/auth.store';
import { I18nInitializer } from '@/i18n/I18nProvider';
import { OfflineScreen } from '@/components/ui/OfflineScreen';
import dynamic from 'next/dynamic';

const SessionSyncLazy = dynamic(() => import('@/components/auth/SessionSync').then(m => ({ default: m.SessionSync })), { ssr: false });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1, refetchOnWindowFocus: false },
  },
});

function SocketInitializer() {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const { connect, disconnect } = useSocket();

  useEffect(() => {
    if (isAuthenticated) {
      connect();
    } else {
      disconnect();
    }
  }, [isAuthenticated, connect, disconnect]);

  return null;
}

class SessionProviderErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.warn('[Providers] SessionProvider failed to load, proceeding without NextAuth:', error.message);
  }
  render() {
    if (this.state.hasError) return <>{this.props.children}</>;
    return this.props.children;
  }
}

const SessionProviderLazy = lazy(() => import('next-auth/react').then(m => ({ default: m.SessionProvider })));

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{children}</>;
  return (
    <SessionProviderErrorBoundary>
      <Suspense fallback={<>{children}</>}>
        <SessionProviderLazy>
          {children}
        </SessionProviderLazy>
      </Suspense>
    </SessionProviderErrorBoundary>
  );
}

function AuthInit() {
  const initAuth = useAuthStore(s => s.initAuth);
  const isInitDone = useAuthStore(s => s.isInitDone);
  useEffect(() => { if (!isInitDone) initAuth(); }, [initAuth, isInitDone]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => queryClient);

  useEffect(() => {
    // A service worker (public/sw.js, now deleted from the build) shipped
    // with the very first commit and was never wired up again after — but
    // any browser that installed it while it was live keeps intercepting
    // requests indefinitely and serving its frozen precache, since SW
    // installs persist across sessions until explicitly removed. That
    // silently pins affected browsers to a stale build (old JS, old
    // strings, missing bug fixes) with zero visible error. Unregistering
    // alone stops NEW installs but leaves the already-cached responses in
    // Cache Storage; clear those too so an affected browser fully recovers
    // on its next load instead of continuing to read from the old cache.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.unregister());
      }).catch(() => {});
    }
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(key => caches.delete(key));
      }).catch(() => {});
    }
  }, []);

  return (
    <AuthProvider>
      <QueryClientProvider client={client}>
        <AuthInit />
        <SessionSyncLazy />
        <I18nInitializer />
        <SocketInitializer />
        <OfflineScreen />
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            style: { background: '#111827', color: '#fff', border: '1px solid #1f2937', borderRadius: '12px' },
            success: { iconTheme: { primary: '#0ea5e9', secondary: '#fff' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          }}
        />
      </QueryClientProvider>
    </AuthProvider>
  );
}
