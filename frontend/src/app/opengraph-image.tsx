import { ImageResponse } from '@vercel/og';

export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };
export const runtime = 'edge';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0a0e1a 0%, #1a1040 50%, #0a0e1a 100%)',
          color: '#ffffff',
          fontFamily: 'Inter, sans-serif',
          padding: 60,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            marginBottom: 20,
          }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
          <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: 2 }}>ROVX</span>
        </div>
        <div
          style={{
            fontSize: 28,
            color: '#a78bfa',
            marginBottom: 12,
            letterSpacing: 1,
          }}
        >
          AI-Powered Navigation
        </div>
        <div
          style={{
            fontSize: 18,
            color: '#94a3b8',
            textAlign: 'center',
            maxWidth: 600,
          }}
        >
          Real-time traffic, fuel prices, speed cameras & smart route planning
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
