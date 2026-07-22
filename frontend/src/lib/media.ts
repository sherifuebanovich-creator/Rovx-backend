const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, '');

// Avatars/group photos uploaded via multer are saved to local disk on the
// backend and stored as a bare "/uploads/..." path (see users.controller.ts
// uploadAvatar). Rendered as-is on the frontend, that path resolves against
// the Vercel origin (which has no such route) instead of the Render backend
// that actually serves it — hence broken images. Absolute URLs (Google/OAuth
// avatars, future cloud storage) are passed through untouched.
export function mediaUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) return path;
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}
