import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import authReducer from './slices/authSlice';
import meetingReducer from './slices/meetingSlice';
import chatReducer from './slices/chatSlice';
import participantsReducer from './slices/participantsSlice';
import uiReducer from './slices/uiSlice';
import webrtcReducer from './slices/webrtcSlice';
import notificationsReducer from './slices/notificationsSlice';

export const store = configureStore({
  reducer: { auth: authReducer, meeting: meetingReducer, chat: chatReducer, participants: participantsReducer, ui: uiReducer, webrtc: webrtcReducer, notifications: notificationsReducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: { ignoredPaths: ['webrtc.localStream','webrtc.screenStream'] } }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
