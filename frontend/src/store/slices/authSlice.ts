import { createSlice, PayloadAction } from '@reduxjs/toolkit';
interface User { uid: string; email: string; displayName: string; photoURL?: string; role: 'admin'|'moderator'|'user'; isOnline: boolean; lastSeen: string; settings: any; createdAt: string; }
interface AuthState { user: User | null; loading: boolean; initialized: boolean; error: string | null; }
const authSlice = createSlice({ name: 'auth', initialState: { user: null, loading: true, initialized: false, error: null } as AuthState, reducers: {
  setUser: (s, a: PayloadAction<User|null>) => { s.user = a.payload; s.loading = false; s.initialized = true; s.error = null; },
  setLoading: (s, a: PayloadAction<boolean>) => { s.loading = a.payload; },
  setInitialized: (s) => { s.initialized = true; s.loading = false; },
  setError: (s, a: PayloadAction<string|null>) => { s.error = a.payload; s.loading = false; },
  updateUserSettings: (s, a: PayloadAction<any>) => { if (s.user) s.user = { ...s.user, ...a.payload }; },
  clearAuth: (s) => { s.user = null; s.loading = false; s.error = null; s.initialized = true; },
}});
export const { setUser, setLoading, setInitialized, setError, updateUserSettings, clearAuth } = authSlice.actions;
export default authSlice.reducer;
