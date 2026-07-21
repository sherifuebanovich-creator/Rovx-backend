import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';

// Render's free-tier backend can take 30-60s to wake from a cold start.
// A single attempt at the default fetch timeout used to fail silently and
// leave the user on the map with a Google session but no app token. Retry
// across a budget that fits Vercel's function limit instead of giving up
// after one try.
export const maxDuration = 60;

async function syncWithBackend(idToken: string | undefined, displayName: string | null | undefined, avatar: string | null | undefined) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${apiUrl}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, displayName, avatar, lang: 'en' }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const raw = await res.json();
        const payload = raw?.data ?? raw;
        const inner = payload?.data ?? payload;
        const accessToken = payload?.accessToken || payload?.access_token || inner?.accessToken || inner?.access_token;
        if (accessToken) return { accessToken };
      }
      // Non-2xx that isn't going to fix itself on retry (e.g. bad token) —
      // stop instead of burning the remaining attempts.
      if (res.status >= 400 && res.status < 500) return { error: `BackendSyncFailed:${res.status}` };
    } catch (err) {
      clearTimeout(timeout);
      console.error(`[NextAuth] Backend sync attempt ${attempt}/${attempts} failed:`, err);
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 3000));
  }
  return { error: 'BackendSyncFailed' };
}

const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  cookies: {
    sessionToken: {
      name: 'rovx-session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  pages: {
    signIn: '/auth/register',
    error: '/auth/register',
  },
  callbacks: {
    async signIn({ account }) {
      if (account?.provider === 'google') return true;
      return true;
    },
    async jwt({ token, user, account }) {
      if (account && user) {
        const result = await syncWithBackend(account.id_token, user.name, user.image);
        if (result.accessToken) {
          token.accessToken = result.accessToken;
          delete token.error;
        } else {
          token.error = result.error;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error as string | undefined;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
