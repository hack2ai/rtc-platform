import { createSlice, PayloadAction } from '@reduxjs/toolkit';
interface Meeting { id: string; code: string; title: string; hostId: string; hostName: string; status: string; settings: any; participants: string[]; waitingRoom: string[]; bannedUsers: string[]; isLocked: boolean; maxParticipants: number; createdAt: string; [key: string]: any; }
interface MeetingState { currentMeeting: Meeting|null; meetings: Meeting[]; loading: boolean; error: string|null; isHost: boolean; waitingRoomCount: number; }
const meetingSlice = createSlice({ name: 'meeting', initialState: { currentMeeting: null, meetings: [], loading: false, error: null, isHost: false, waitingRoomCount: 0 } as MeetingState, reducers: {
  setCurrentMeeting: (s, a: PayloadAction<Meeting|null>) => { s.currentMeeting = a.payload; },
  setIsHost: (s, a: PayloadAction<boolean>) => { s.isHost = a.payload; },
  setMeetings: (s, a: PayloadAction<Meeting[]>) => { s.meetings = a.payload; },
  updateMeeting: (s, a: PayloadAction<Partial<Meeting>>) => { if (s.currentMeeting) s.currentMeeting = { ...s.currentMeeting, ...a.payload }; },
  setLoading: (s, a: PayloadAction<boolean>) => { s.loading = a.payload; },
  setError: (s, a: PayloadAction<string|null>) => { s.error = a.payload; s.loading = false; },
  setWaitingRoomCount: (s, a: PayloadAction<number>) => { s.waitingRoomCount = a.payload; },
  clearMeeting: (s) => { s.currentMeeting = null; s.isHost = false; s.error = null; },
}});
export const { setCurrentMeeting, setIsHost, setMeetings, updateMeeting, setLoading, setError, setWaitingRoomCount, clearMeeting } = meetingSlice.actions;
export default meetingSlice.reducer;
