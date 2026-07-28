import axios, { AxiosError } from 'axios';
import Cookies from 'js-cookie';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
  withCredentials: true,
});

// Request interceptor - attach access token + language
api.interceptors.request.use((config) => {
  const token = Cookies.get('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (typeof window !== 'undefined') {
    const lang = document.documentElement.lang || localStorage.getItem('i18nextLng') || 'ru';
    config.headers['Accept-Language'] = lang;
  }
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

// Response interceptor - handle token refresh
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any;

    // Render's free tier spins the backend down after idle and takes 30-60s+
    // to wake back up, so the very first request after a while either times
    // out with no response at all or bounces off the gateway with a 502/503/504
    // before the app has finished booting. That's exactly what surfaced as
    // "Не удалось загрузить ТС" / "Не удалось отправить сообщение" — a plain
    // timeout, not a real backend error. Retry once after a short delay
    // instead of failing immediately, mirroring the same tolerance already
    // applied to the /auth/refresh call below.
    // Only retry safe/idempotent methods — this used to retry ANY method
    // including POST, so a cold-start timeout on e.g. startTrip/createReport
    // whose write actually landed server-side but whose response didn't make
    // it back in time got blindly replayed, creating a duplicate trip/report.
    const method = (originalRequest?.method || 'get').toLowerCase();
    // PUT/DELETE are idempotent by HTTP definition — replaying an identical
    // update or delete after a cold-start timeout lands in the same end
    // state, so they're as safe to retry as GET. This is what was behind
    // "Failed to update profile": PUT /users/me got excluded from the retry
    // above (only GET/HEAD/OPTIONS qualified), so a cold-start timeout on
    // profile save surfaced as a hard failure instead of a silent retry,
    // even though the save itself is perfectly safe to replay.
    // POST stays excluded by default (a blind replay could double-create),
    // but an individual POST call that's proven safe server-side (e.g.
    // createGroup's unique-name advisory lock, which turns a duplicate
    // replay into a clean 409 instead of a second group) can opt in
    // per-request via `retryOnColdStart: true` in its axios config.
    const isSafeToRetry = ['get', 'head', 'options', 'put', 'delete'].includes(method)
      || originalRequest?.retryOnColdStart === true;
    // A single retry after a flat 3s wait was nowhere near enough: Render's
    // free tier can take up to 30-60s to finish booting from cold, and one
    // 3s-delayed attempt just re-hits the still-booting instance and fails
    // again — visibly *slower* than failing immediately, for the same
    // end result. Retry up to 5 times with increasing backoff (covers
    // ~45s of deliberate waiting, on top of however long each attempt
    // itself took) before finally giving up.
    const MAX_COLD_START_RETRIES = 5;
    const COLD_START_DELAYS_MS = [2000, 4000, 6000, 9000, 12000];
    const retryCount = originalRequest?._coldStartRetryCount || 0;
    if (
      originalRequest &&
      isSafeToRetry &&
      retryCount < MAX_COLD_START_RETRIES &&
      (!error.response || [502, 503, 504].includes(error.response.status))
    ) {
      originalRequest._coldStartRetryCount = retryCount + 1;
      await new Promise((r) => setTimeout(r, COLD_START_DELAYS_MS[retryCount]));
      return api(originalRequest);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (originalRequest._skipAuthRedirect) {
        return Promise.reject(error);
      }

      // Don't let interceptor handle 401 on refresh endpoint itself — initAuth handles it directly
      const reqUrl = (originalRequest.url || '').toString();
      if (reqUrl.includes('/auth/refresh')) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Re-read on every attempt, not just once — if a concurrent refresh
        // (from another request racing on the same expired token) wins and
        // rotates the token first, localStorage/cookies will already carry
        // the new value by the time we retry, and reusing a captured stale
        // value here would make the retry fail again with the same token.
        const getRefreshHeaders = () => {
          const storedRefresh = (() => { try { return JSON.parse(localStorage.getItem('rovx-auth') || '{}')?.state?.refreshToken; } catch { return null; } })();
          return {
            'Content-Type': 'application/json',
            ...(storedRefresh ? { 'x-refresh-token': storedRefresh } : {}),
          };
        };

        // This call bypasses the `api` instance (and its cold-start retry
        // logic above) on purpose — it's the one request that must never be
        // queued behind the 401-refresh flow it IS. But that meant it only
        // ever got a single retry after a flat 1.5s, nowhere near enough for
        // Render's 30-60s cold-start window — every OTHER request already
        // got a generous multi-attempt retry, but the most critical one
        // (every subsequent authenticated call depends on this succeeding)
        // gave up almost immediately. A cold backend during this specific
        // call is also what surfaced in the browser as a misleading CORS
        // error (Access-Control-Allow-Origin missing) — Render's proxy
        // returns a bare failure with no headers at all while the app is
        // still booting, which Chrome reports as a CORS block instead of
        // "no response" even though the backend's actual CORS config
        // (verified directly) is fine once it's up.
        const REFRESH_RETRY_DELAYS_MS = [1500, 3000, 5000, 8000, 12000];
        let res;
        for (let attempt = 0; ; attempt++) {
          try {
            res = await axios.post(`${BASE_URL}/auth/refresh`, null, {
              withCredentials: true,
              headers: getRefreshHeaders(),
            });
            break;
          } catch (err: any) {
            // A real auth rejection (400/401/403 with a response) means the
            // refresh token itself is invalid — retrying won't fix that.
            const isRetryable = err?.response?.status >= 500 || err?.response?.status === 409 || !err?.response;
            if (!isRetryable || attempt >= REFRESH_RETRY_DELAYS_MS.length) throw err;
            await new Promise((r) => setTimeout(r, REFRESH_RETRY_DELAYS_MS[attempt]));
          }
        }

        const raw = res.data;
        const payload = raw?.data ?? raw;
        const inner = payload?.data ?? payload;
        const accessToken = payload?.accessToken || payload?.access_token || inner?.accessToken || inner?.access_token;
        const newRefresh = payload?.refreshToken || inner?.refreshToken;
        if (!accessToken) throw new Error('Invalid refresh response');

        Cookies.set('access_token', accessToken, {
          expires: 1 / 96, // 15min
          path: '/',
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        });
        if (newRefresh) {
          try {
            const stored = JSON.parse(localStorage.getItem('rovx-auth') || '{}');
            stored.state = { ...stored.state, refreshToken: newRefresh };
            localStorage.setItem('rovx-auth', JSON.stringify(stored));
          } catch {}
        }

        api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;

        processQueue(null, accessToken);
        return api(originalRequest);
      } catch (refreshError: any) {
        processQueue(refreshError, null);
        // Only a REAL auth failure (refresh token itself rejected) should
        // wipe the session. This used to strip the cookie unconditionally,
        // including for network errors / 5xx / 409 (a Render cold start or
        // a concurrent refresh's Redis lock) — the same transient failures
        // auth.store.ts's doRefresh() deliberately does NOT log out for,
        // making this interceptor contradict that logic and force-logout
        // a user who actually still had a valid session.
        const status = refreshError?.response?.status;
        const isRealAuthFailure = status === 400 || status === 401 || status === 403;
        if (isRealAuthFailure) {
          Cookies.remove('access_token', { path: '/' });
          // Also drop the shared axios default — otherwise a request fired
          // before the page navigates to login would silently go out with
          // this now-revoked token even though the cookie is gone.
          delete api.defaults.headers.common.Authorization;
        }
        // Don't remove localStorage here — initAuth/logout handles cleanup.
        // No forced navigation: let the calling page decide how to handle the unauthenticated state.
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

function getDeviceInfo(): string {
  if (typeof window === 'undefined') return '';
  const ua = navigator.userAgent;
  const platform = navigator.platform || '';
  const languages = navigator.languages?.join(',') || '';
  return `${platform}|${ua?.slice(0, 100)}|${languages}`;
}

// Auth endpoints
export const authApi = {
  register: (data: any) => api.post('/auth/register', { ...data, deviceInfo: getDeviceInfo() }),
  login: (data: any) => api.post('/auth/login', { ...data, deviceInfo: getDeviceInfo() }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  sendVerification: (email: string) => api.post('/auth/send-verification', { email }),
  verifyEmail: (email: string, code: string) => api.post('/auth/verify-email', { email, code }),
};

// User endpoints
export const usersApi = {
  getProfile: () => api.get('/users/me'),
  updateProfile: (data: any) => api.put('/users/me', data),
  updatePreferences: (data: any) => api.put('/users/me/preferences', data),
  getPublicProfile: (username: string) => api.get(`/users/profile/${username}`),
  getLeaderboard: () => api.get('/users/leaderboard'),
  getAchievements: () => api.get('/users/me/achievements'),
  addVehicle: (data: any) => api.post('/users/me/vehicles', data),
  getVehicles: () => api.get('/users/me/vehicles'),
  deleteVehicle: (id: string) => api.delete(`/users/me/vehicles/${id}`),
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post('/users/me/avatar', formData, {
      timeout: 30000,
      // Re-uploading the same file is idempotent (backend just overwrites
      // `avatar` with the same base64 data URI, no accumulation) — unlike a
      // blind POST retry that could double-create, this one is as safe to
      // replay as the PUT/DELETE calls that already retry on cold start by
      // default. Without this, saving a profile edit that included a new
      // avatar while the backend was cold/asleep (Render free tier) failed
      // this step outright with no retry, surfacing as "Failed to update
      // profile" even though the actual PUT /users/me that follows it would
      // have gone through fine — see the cold-start retry comment above in
      // the response interceptor.
      retryOnColdStart: true,
    } as any);
  },
};

// Routes endpoints
export const routesApi = {
  calculate: (data: any) => api.post('/routes/calculate', data),
  save: (data: any) => api.post('/routes/save', data),
  getSaved: () => api.get('/routes/saved'),
  deleteSaved: (id: string) => api.delete(`/routes/saved/${id}`),
  getTrips: (page = 1) => api.get(`/routes/trips?page=${page}`),
  startTrip: (data: any) => api.post('/routes/trips/start', data),
  endTrip: (tripId: string, stats: any) => api.post(`/routes/trips/${tripId}/end`, stats),
};

// Map endpoints
export const mapApi = {
  getObjects: (params: any) => api.get('/map/objects', { params }),
  getNearby: (lat: number, lng: number, radius = 5, category?: string) =>
    api.get('/map/nearby', { params: { lat, lng, radius, category } }),
  getObject: (id: string) => api.get(`/map/objects/${id}`),
  getTraffic: (params: any) => api.get('/map/traffic', { params }),
  getSpeedCameras: (lat: number, lng: number, radius = 10) =>
    api.get('/map/speed-cameras', { params: { lat, lng, radius } }),
  getGovernmentSpeedCameras: (lat: number, lng: number, radius = 10) =>
    api.get('/map/government-speed-cameras', { params: { lat, lng, radius } }),
  getTrafficSignals: (lat: number, lng: number, radius = 2) =>
    api.get('/map/traffic-signals', { params: { lat, lng, radius } }),
  getGovernmentTrafficSignals: (lat: number, lng: number, radius = 2) =>
    api.get('/map/government-traffic-signals', { params: { lat, lng, radius } }),
  getFeatures: (bbox: string, types?: string) =>
    api.get('/map-features', { params: { bbox, types } }),
  search: (q: string, lat?: number, lng?: number, radius?: number) =>
    api.get('/map/search', { params: { q, lat, lng, radius } }),
  suggest: (q: string, lat?: number, lng?: number) =>
    api.get('/map/suggest', { params: { q, lat, lng } }),
  reverseGeocode: (lat: number, lng: number) =>
    api.get('/map/reverse-geocode', { params: { lat, lng } }),
  addBookmark: (data: any) => api.post('/map/bookmarks', data),
  getBookmarks: () => api.get('/map/bookmarks'),
  deleteBookmark: (id: string) => api.delete(`/map/bookmarks/${id}`),
};

// Reports endpoints
export const reportsApi = {
  create: (data: any, photos?: File[]) => {
    if (photos && photos.length > 0) {
      const formData = new FormData();
      formData.append('type', data.type);
      formData.append('lat', String(data.lat));
      formData.append('lng', String(data.lng));
      if (data.description) formData.append('description', data.description);
      if (data.severity) formData.append('severity', String(data.severity));
      for (const photo of photos) {
        formData.append('photos', photo);
      }
      return api.post('/reports', formData, {
        timeout: 60000,
      });
    }
    return api.post('/reports', data);
  },
  getInArea: (params: any) => api.get('/reports', { params }),
  vote: (id: string, confirm: boolean) => api.post(`/reports/${id}/vote`, { confirm }),
  delete: (id: string) => api.delete(`/reports/${id}`),
  getMy: (page = 1) => api.get(`/reports/my?page=${page}`),
  validatePhoto: (imageUrl: string, reportType?: string, description?: string) => api.post('/reports/validate-photo', { imageUrl, reportType, description }),
  getLimit: () => api.get('/reports/limit'),
  getForCity: (city: string, page = 1) => api.get(`/reports/city/${encodeURIComponent(city)}?page=${page}`),
};

// AI endpoints
export const aiApi = {
  analyzeRoute: (ctx: any) => api.post('/ai/analyze-route', ctx),
  voiceCommand: (data: any) => api.post('/ai/voice-command', data),
  getSuggestions: (lat: number, lng: number) =>
    api.get('/ai/suggestions', { params: { lat, lng } }),
};

// Social endpoints
export const socialApi = {
  follow: (userId: string) => api.post(`/social/follow/${userId}`),
  unfollow: (userId: string) => api.delete(`/social/follow/${userId}`),
  getFollowers: (page = 1) => api.get(`/social/followers?page=${page}`),
  getFollowing: (page = 1) => api.get(`/social/following?page=${page}`),
  getConversations: () => api.get('/social/messages'),
  getMessages: (partnerId: string, page = 1) =>
    api.get(`/social/messages/${partnerId}?page=${page}`),
  // retryOnColdStart is safe here specifically: createGroup is guarded
  // server-side by an advisory lock on the lowercased name (social.service.ts),
  // so a replayed request either creates the group once or gets a clean 409
  // "already exists" — never a second group.
  createGroup: (data: any) => api.post('/social/groups', data, { retryOnColdStart: true } as any),
  updateGroup: (groupId: string, data: any) => api.put(`/social/groups/${groupId}`, data),
  deleteGroup: (groupId: string) => api.delete(`/social/groups/${groupId}`),
  uploadGroupAvatar: (groupId: string, file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post(`/social/groups/${groupId}/avatar`, formData, {
      timeout: 30000,
    });
  },
  getGroups: (page = 1, region?: string, city?: string, search?: string) =>
    api.get('/social/groups', { params: { page, region, city, search } }),
  getMyGroups: () => api.get('/social/groups/my'),
  searchGroups: (q: string, city?: string) =>
    api.get('/social/groups/search', { params: { q, city } }),
  getGroup: (groupId: string) => api.get(`/social/groups/${groupId}`),
  getGroupMessages: (groupId: string, page = 1) =>
    api.get(`/social/groups/${groupId}/messages?page=${page}`),
  joinGroup: (groupId: string) => api.post(`/social/groups/${groupId}/join`),
  joinGroupByName: (name: string) => api.post('/social/groups/join-by-name', { name }),
  leaveGroup: (groupId: string) => api.post(`/social/groups/${groupId}/leave`),
  joinByToken: (token: string) => api.post(`/social/groups/join/${token}`),
  getInviteLink: (groupId: string) => api.get(`/social/groups/${groupId}/invite-link`),
  regenerateInviteLink: (groupId: string) => api.post(`/social/groups/${groupId}/invite-link`),
  deleteMessage: (groupId: string, messageId: string) => api.delete(`/social/groups/${groupId}/messages/${messageId}`),
  banMember: (groupId: string, targetUserId: string) => api.post(`/social/groups/${groupId}/ban/${targetUserId}`),
  unbanMember: (groupId: string, targetUserId: string) => api.post(`/social/groups/${groupId}/unban/${targetUserId}`),
  kickMember: (groupId: string, targetUserId: string) => api.post(`/social/groups/${groupId}/kick/${targetUserId}`),
  promoteMember: (groupId: string, targetUserId: string) => api.post(`/social/groups/${groupId}/promote/${targetUserId}`),
  demoteMember: (groupId: string, targetUserId: string) => api.post(`/social/groups/${groupId}/demote/${targetUserId}`),
  getPendingRequests: (groupId: string) => api.get(`/social/groups/${groupId}/requests`),
  approveRequest: (groupId: string, requestId: string) => api.post(`/social/groups/${groupId}/requests/${requestId}/approve`),
  rejectRequest: (groupId: string, requestId: string) => api.post(`/social/groups/${groupId}/requests/${requestId}/reject`),
  getRequestStatus: (groupId: string) => api.get(`/social/groups/${groupId}/request-status`),
  toggleFavorite: (groupId: string) => api.post(`/social/groups/${groupId}/favorite`),
  getMyFavorites: () => api.get('/social/groups/favorites'),
  uploadGroupMedia: (groupId: string, files: File[]) => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    return api.post(`/social/groups/${groupId}/messages/upload`, formData, {
      timeout: 60000,
    });
  },
  uploadGroupAudio: (groupId: string, audio: File) => {
    const formData = new FormData();
    formData.append('audio', audio);
    return api.post(`/social/groups/${groupId}/messages/upload-audio`, formData, {
      timeout: 30000,
    });
  },
  uploadGroupVideoMsg: (groupId: string, video: File) => {
    const formData = new FormData();
    formData.append('video', video);
    return api.post(`/social/groups/${groupId}/messages/upload-video-msg`, formData, {
      timeout: 120000,
    });
  },
  getNotifications: (page = 1) => api.get(`/social/notifications?page=${page}`),
  markNotificationsRead: () => api.post('/social/notifications/read'),
  deleteAllNotifications: () => api.delete('/social/notifications'),
};

// Premium endpoints
export const premiumApi = {
  getTiers: (lang = 'en') => api.get('/premium/tiers', { params: { lang } }),
  getMy: () => api.get('/premium/my'),
  createCheckout: (tierName: string, months = 1) => api.post('/premium/create-checkout', { tierName, months }),
  stripeCheckout: (tierName: string) => api.post('/premium/stripe-checkout', { tierName }),
  getPaymentDetails: () => api.get('/premium/payment-details'),
  directPay: (tierName: string, proof: string) => api.post('/premium/direct-pay', { tierName, proof }),
  cancel: () => api.post('/premium/cancel'),
  canCreateGroup: () => api.get('/premium/can-create-group'),
};

export const voiceRoomsApi = {
  list: () => api.get('/voice-rooms'),
  get: (roomId: string) => api.get(`/voice-rooms/${roomId}`),
  create: (name: string, maxParticipants?: number) => api.post('/voice-rooms', { name, maxParticipants }),
  close: (roomId: string) => api.delete(`/voice-rooms/${roomId}`),
  getIceServers: () => api.get('/voice-rooms/ice-servers'),
};

export const supportApi = {
  send: (message: string) => api.post('/support', { message }),
};

// Friends endpoints
export const friendsApi = {
  getFriends: () => api.get('/friends'),
  getRequests: () => api.get('/friends/requests'),
  sendRequest: (userId: string) => api.post(`/friends/request/${userId}`),
  acceptRequest: (userId: string) => api.post(`/friends/accept/${userId}`),
  rejectRequest: (userId: string) => api.delete(`/friends/reject/${userId}`),
  removeFriend: (userId: string) => api.delete(`/friends/${userId}`),
  getOnline: () => api.get('/friends/online'),
  getLocations: () => api.get('/friends/locations'),
  searchUsers: (q: string) => api.get('/friends/search', { params: { q } }),
};

// Chat endpoints
export const chatApi = {
  getCityMessages: (city: string, page = 1) =>
    api.get(`/social/chat/city/${encodeURIComponent(city)}?page=${page}`),
  sendCityMessage: (city: string, content: string) =>
    api.post(`/social/chat/city/${encodeURIComponent(city)}`, { content }),
};

export default api;
