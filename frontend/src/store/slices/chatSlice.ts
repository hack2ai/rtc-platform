import { createSlice, PayloadAction } from '@reduxjs/toolkit';
interface Message { id: string; meetingId: string; senderId: string; senderName: string; content: string; type: string; reactions: Record<string,string[]>; readBy: string[]; createdAt: string; editedAt?: string; deletedAt?: string; fileURL?: string; fileName?: string; }
interface ChatState { messages: Message[]; typingUsers: Record<string,string>; unreadCount: number; searchQuery: string; }
const chatSlice = createSlice({ name: 'chat', initialState: { messages: [], typingUsers: {}, unreadCount: 0, searchQuery: '' } as ChatState, reducers: {
  setMessages: (s, a: PayloadAction<Message[]>) => { s.messages = a.payload; },
  addMessage: (s, a: PayloadAction<Message>) => { if (!s.messages.some((m) => m.id === a.payload.id)) { s.messages.push(a.payload); s.unreadCount += 1; } },
  updateMessage: (s, a: PayloadAction<Message>) => { const i = s.messages.findIndex((m) => m.id === a.payload.id); if (i !== -1) s.messages[i] = a.payload; },
  removeMessage: (s, a: PayloadAction<string>) => { s.messages = s.messages.filter((m) => m.id !== a.payload); },
  setTypingUser: (s, a: PayloadAction<{uid:string;name:string}|null>) => { if (!a.payload) s.typingUsers = {}; else s.typingUsers[a.payload.uid] = a.payload.name; },
  removeTypingUser: (s, a: PayloadAction<string>) => { delete s.typingUsers[a.payload]; },
  resetUnreadCount: (s) => { s.unreadCount = 0; },
  setSearchQuery: (s, a: PayloadAction<string>) => { s.searchQuery = a.payload; },
  clearChat: (s) => { s.messages = []; s.typingUsers = {}; s.unreadCount = 0; s.searchQuery = ''; },
}});
export const { setMessages, addMessage, updateMessage, removeMessage, setTypingUser, removeTypingUser, resetUnreadCount, setSearchQuery, clearChat } = chatSlice.actions;
export default chatSlice.reducer;
