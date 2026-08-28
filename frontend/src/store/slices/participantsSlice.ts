import { createSlice, PayloadAction } from '@reduxjs/toolkit';
interface Participant { uid: string; meetingId: string; displayName: string; photoURL?: string; role: string; status: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean; handRaised: boolean; joinedAt: string; connectionQuality: string; }
interface ParticipantsState { participants: Record<string, Participant>; waitingRoom: Participant[]; }
const participantsSlice = createSlice({ name: 'participants', initialState: { participants: {}, waitingRoom: [] } as ParticipantsState, reducers: {
  setParticipants: (s, a: PayloadAction<Participant[]>) => { s.participants = {}; a.payload.forEach((p) => { s.participants[p.uid] = p; }); },
  upsertParticipant: (s, a: PayloadAction<Participant>) => { s.participants[a.payload.uid] = a.payload; },
  removeParticipant: (s, a: PayloadAction<string>) => { delete s.participants[a.payload]; },
  updateParticipant: (s, a: PayloadAction<{ uid: string; updates: Partial<Participant> }>) => { const p = s.participants[a.payload.uid]; if (p) s.participants[a.payload.uid] = { ...p, ...a.payload.updates }; },
  setWaitingRoom: (s, a: PayloadAction<Participant[]>) => { s.waitingRoom = a.payload; },
  clearParticipants: (s) => { s.participants = {}; s.waitingRoom = []; },
}});
export const { setParticipants, upsertParticipant, removeParticipant, updateParticipant, setWaitingRoom, clearParticipants } = participantsSlice.actions;
export default participantsSlice.reducer;
