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
        const storedRefresh = (() => { try { return JSON.parse(localStorage.getItem('rovx-auth') || '{}')?.state?.refreshToken; } catch { return null; } })();
        const refreshHeaders = {
          'Content-Type': 'application/json',
          ...(storedRefresh ? { 'x-refresh-token': storedRefresh } : {}),
        };

        let res;
        try {
          res = await axios.post(`${BASE_URL}/auth/refresh`, null, {
            withCredentials: true,
            headers: refreshHeaders,
          });
        } catch (firstErr: any) {
          // Retry once — Render cold start or transient backend error
          if (firstErr?.response?.status >= 500 || !firstErr?.response) {
            await new Promise(r => setTimeout(r, 1500));
            res = await axios.post(`${BASE_URL}/auth/refresh`, null, {
              withCredentials: true,
              headers: refreshHeaders,
            });
          } else {
            throw firstErr;
          }
        }

        const raw = res.data;
        const payload = raw?.data ?? raw;
        const inner = payload?.data ?? payload;
        const accessToken = payload?.accessToken || payload?.access_token || inner?.accessToken || inner?.access_token;
        const newRefresh = payload?.refreshToken || inner?.refreshToken;
        if (!accessToken) throw new Error('Invalid refresh response');

        Cookies.set('access_token', accessToken, { expires: 1 / 96, path: '/' }); // 15min
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
      } catch (refreshError) {
        processQueue(refreshError, null);
        Cookies.remove('access_token', { path: '/' });
        // Don't remove localStorage here — initAuth/logout handles cleanup.
        // Small delay before redirect to avoid race with concurrent state updates.
        if (typeof window !== 'undefined') {
          setTimeout(() => { window.location.href = '/auth/login'; }, 100);
        }
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
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    });
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
  search: (q: string, lat?: number, lng?: number) =>
    api.get('/map/search', { params: { q, lat, lng } }),
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
        headers: { 'Content-Type': 'multipart/form-data' },
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
  createGroup: (data: any) => api.post('/social/groups', data),
  updateGroup: (groupId: string, data: any) => api.put(`/social/groups/${groupId}`, data),
  deleteGroup: (groupId: string) => api.delete(`/social/groups/${groupId}`),
  uploadGroupAvatar: (groupId: string, file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post(`/social/groups/${groupId}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
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
  cancel: () => api.post('/premium/cancel'),
  canCreateGroup: () => api.get('/premium/can-create-group'),
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
  searchUsers: (q: string) => api.get('/friends/search', { params: { q } }),
};

// Chat endpoints
export const chatApi = {
  getCityMessages: (city: string, page = 1) =>
    api.get(`/social/chat/city/${encodeURIComponent(city)}?page=${page}`),
  sendCityMessage: (city: string, content: string) =>
    api.post(`/social/chat/city/${encodeURIComponent(city)}`, { content }),
};

// Fuel endpoints
export const fuelApi = {
  calculate: (data: any) => api.post('/fuel/calculate', data),
  estimate: (data: any) => api.post('/fuel/estimate', data),
  getHistory: () => api.get('/fuel/history'),
  getPrices: () => api.get('/fuel/prices'),
};

export default api;
