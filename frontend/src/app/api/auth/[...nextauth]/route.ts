import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';

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
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
        try {
          const res = await fetch(`${apiUrl}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: user.email,
              displayName: user.name,
              avatar: user.image,
              googleId: account.providerAccountId,
              lang: 'en',
            }),
          });
          if (res.ok) {
            const raw = await res.json();
            const payload = raw?.data ?? raw;
            const inner = payload?.data ?? payload;
            const accessToken = payload?.accessToken || payload?.access_token || inner?.accessToken || inner?.access_token;
            if (accessToken) {
              token.accessToken = accessToken;
            }
          }
        } catch (err) {
          console.error('[NextAuth] Failed to sync with ROVX backend:', err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
