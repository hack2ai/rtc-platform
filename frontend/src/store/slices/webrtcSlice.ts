import { createSlice, PayloadAction } from '@reduxjs/toolkit';
interface WebRTCState { isAudioEnabled: boolean; isVideoEnabled: boolean; isScreenSharing: boolean; isRecording: boolean; peerConnections: Record<string,string>; connectionQuality: string; selectedAudioInput: string; selectedVideoInput: string; selectedAudioOutput: string; availableDevices: any[]; recordingId: string|null; handRaised: boolean; }
const webrtcSlice = createSlice({ name: 'webrtc', initialState: { isAudioEnabled: true, isVideoEnabled: true, isScreenSharing: false, isRecording: false, peerConnections: {}, connectionQuality: 'excellent', selectedAudioInput: '', selectedVideoInput: '', selectedAudioOutput: '', availableDevices: [], recordingId: null, handRaised: false } as WebRTCState, reducers: {
  setAudioEnabled: (s, a: PayloadAction<boolean>) => { s.isAudioEnabled = a.payload; },
  setVideoEnabled: (s, a: PayloadAction<boolean>) => { s.isVideoEnabled = a.payload; },
  setScreenSharing: (s, a: PayloadAction<boolean>) => { s.isScreenSharing = a.payload; },
  setRecording: (s, a: PayloadAction<boolean>) => { s.isRecording = a.payload; },
  setRecordingId: (s, a: PayloadAction<string|null>) => { s.recordingId = a.payload; },
  setPeerConnectionState: (s, a: PayloadAction<{uid:string;state:string}>) => { s.peerConnections[a.payload.uid] = a.payload.state; },
  removePeerConnection: (s, a: PayloadAction<string>) => { delete s.peerConnections[a.payload]; },
  setConnectionQuality: (s, a: PayloadAction<string>) => { s.connectionQuality = a.payload; },
  setSelectedDevices: (s, a: PayloadAction<{audioInput?:string;videoInput?:string;audioOutput?:string}>) => { if (a.payload.audioInput !== undefined) s.selectedAudioInput = a.payload.audioInput; if (a.payload.videoInput !== undefined) s.selectedVideoInput = a.payload.videoInput; if (a.payload.audioOutput !== undefined) s.selectedAudioOutput = a.payload.audioOutput; },
  setAvailableDevices: (s, a: PayloadAction<any[]>) => { s.availableDevices = a.payload; },
  setHandRaised: (s, a: PayloadAction<boolean>) => { s.handRaised = a.payload; },
  resetWebRTC: () => ({ isAudioEnabled: true, isVideoEnabled: true, isScreenSharing: false, isRecording: false, peerConnections: {}, connectionQuality: 'excellent', selectedAudioInput: '', selectedVideoInput: '', selectedAudioOutput: '', availableDevices: [], recordingId: null, handRaised: false }),
}});
export const { setAudioEnabled, setVideoEnabled, setScreenSharing, setRecording, setRecordingId, setPeerConnectionState, removePeerConnection, setConnectionQuality, setSelectedDevices, setAvailableDevices, setHandRaised, resetWebRTC } = webrtcSlice.actions;
export default webrtcSlice.reducer;
