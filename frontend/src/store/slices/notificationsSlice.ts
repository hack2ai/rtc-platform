import { createSlice, PayloadAction } from '@reduxjs/toolkit';
interface Notification { id: string; userId: string; type: string; title: string; body: string; read: boolean; createdAt: string; }
interface State { notifications: Notification[]; unreadCount: number; }
const notificationsSlice = createSlice({ name: 'notifications', initialState: { notifications: [], unreadCount: 0 } as State, reducers: {
  setNotifications: (s, a: PayloadAction<{notifications:Notification[];unreadCount:number}>) => { s.notifications = a.payload.notifications; s.unreadCount = a.payload.unreadCount; },
  addNotification: (s, a: PayloadAction<Notification>) => { s.notifications.unshift(a.payload); if (!a.payload.read) s.unreadCount += 1; },
  markRead: (s, a: PayloadAction<string>) => { const n = s.notifications.find((n) => n.id === a.payload); if (n && !n.read) { n.read = true; s.unreadCount = Math.max(0, s.unreadCount-1); } },
  markAllRead: (s) => { s.notifications.forEach((n) => (n.read = true)); s.unreadCount = 0; },
}});
export const { setNotifications, addNotification, markRead, markAllRead } = notificationsSlice.actions;
export default notificationsSlice.reducer;
