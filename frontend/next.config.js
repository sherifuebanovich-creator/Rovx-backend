/** @type {import('next').NextConfig} */
const { version } = require('./package.json');

const nextConfig = {
  reactStrictMode: true,
  output: process.env.VERCEL ? undefined : 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  // Single source of truth for the version shown in Settings' footer
  // (t('settings.footer', { version })) — was a hardcoded string in the
  // locale files with no relation to any real version, hand-edited
  // inconsistently across deploys.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

module.exports = nextConfig;
