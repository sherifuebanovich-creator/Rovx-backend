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
    signIn: '/auth/login',
    error: '/auth/login',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        try {
          let lang = 'en';
          try {
            if (typeof window !== 'undefined') {
              lang = localStorage.getItem('pending_lang') || 'en';
              localStorage.removeItem('pending_lang');
            }
          } catch {}

          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
          const res = await fetch(`${apiUrl}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: user.email,
              displayName: user.name,
              avatar: user.image,
              googleId: account.providerAccountId,
              lang,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.data?.accessToken) {
              (user as any).accessToken = data.data.accessToken;
              (user as any).refreshToken = data.data.refreshToken;
            } else {
              console.warn('[Auth] Backend returned OK but no accessToken — proceeding without backend sync');
            }
          } else {
            const errBody = await res.text().catch(() => '');
            console.warn(`[Auth] Backend rejected Google sign-in [${res.status}]: ${errBody.slice(0, 200)} — proceeding without backend sync`);
          }
        } catch (err) {
          console.warn('[Auth] Backend unreachable — proceeding without backend sync:', (err as Error).message);
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as any).accessToken ?? token.accessToken;
        token.refreshToken = (user as any).refreshToken ?? token.refreshToken;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
