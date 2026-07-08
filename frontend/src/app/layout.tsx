import type { Metadata, Viewport } from 'next';
import { Inter, Syne, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/ui/Providers';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://rovx-app-livid.vercel.app'),
  title: {
    default: 'ROVX — Навигация для дальнобойщиков | AI маршруты, радары, стоянки',
    template: '%s | ROVX',
  },
  description: 'Бесплатная AI-навигация для дальнобойщиков и водителей грузовиков. Камеры скорости, цены на топливо, весовые рамки, стоянки для фур, умные маршруты с учётом параметров ТС.',
  keywords: [
    'навигация для дальнобойщиков', 'грузоперевозки', 'AI навигация', 'камеры скорости',
    'радары', 'цены на топливо', 'весовые рамки', 'стоянки для фур', 'truck navigation',
    'GPS для грузовиков', 'маршруты для фур', 'дальнобой', 'truck routes', 'weigh stations',
    'truck stops', 'fuel prices', 'speed cameras', 'caravan mode', 'ROVX'
  ],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ROVX',
  },
  icons: {
    icon: [{ url: '/logo.png', sizes: '192x192' }, { url: '/logo.png', sizes: '512x512' }],
    apple: '/logo.png',
  },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: 'ROVX',
    title: 'ROVX — AI навигация для дальнобойщиков',
    description: 'Бесплатная AI-навигация для дальнобойщиков: камеры скорости, цены на топливо, стоянки для фур, весовые рамки и умная прокладка маршрутов с учётом параметров грузовика.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ROVX — Навигация для дальнобойщиков',
    description: 'Бесплатная AI-навигация для дальнобойщиков: камеры скорости, цены на топливо, стоянки для фур и маршруты для грузовиков.',
    images: ['/opengraph-image'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  // verification: {
  //   google: 'ВАШ_КОД_ПРОВЕРКИ_SEARCH_CONSOLE',
  // },
  alternates: {
    canonical: 'https://rovx-app-livid.vercel.app',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#0a0e1a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `
            try {
              var lang = localStorage.getItem('preferred_lang');
              if (lang) document.documentElement.lang = lang;
              var dark = localStorage.getItem('darkMode');
              if (dark === 'false') document.documentElement.classList.remove('dark');
              else document.documentElement.classList.add('dark');
            } catch(e) {}
          `,
        }} />
      </head>
      <body className={`${inter.variable} ${syne.variable} ${jetbrains.variable} font-sans antialiased`} style={{ backgroundColor: 'rgb(var(--dark-bg))', color: 'rgb(var(--dark-text))' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
