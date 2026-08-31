'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { useParams, useRouter } from 'next/navigation';
import { Copy, MessageSquare, Mic, MicOff, MonitorUp, PhoneOff, Send, Share2, Shield, Users, Video, VideoOff, X } from 'lucide-react';
import { api } from '../../../config/api';
import { firebaseAuth, firestore } from '../../../config/firebase';
import toast from 'react-hot-toast';

type Message = { id: string; senderId: string; senderName?: string; content: string; deletedAt?: unknown };
type Participant = { uid: string; displayName?: string; role?: string; status?: string };
type SignalType = 'hello' | 'offer' | 'answer' | 'candidate';
type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
  remoteStream: MediaStream | null;
  remoteSessionId: string | null;
  offerStarted: boolean;
};

const fallbackIce: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function normalizeCode(input: string) {
  const value = input.trim();
  try {
    const url = new URL(value);
    const marker = '/meeting/';
    const index = url.pathname.indexOf(marker);
    return decodeURIComponent(index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname.replace(/^\/+/, ''))
      .split(/[?#]/)[0].replace(/^\/|\/$/g, '');
  } catch {
    const marker = '/meeting/';
    const index = value.indexOf(marker);
    return decodeURIComponent(index >= 0 ? value.slice(index + marker.length) : value)
      .split(/[?#]/)[0].replace(/^\/|\/$/g, '');
  }
}

function makeSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function waitForAuth(timeoutMs = 10000): Promise<User | null> {
  return new Promise((resolve) => {
    let done = false;
    let timer: number | null = null;
    let unsubscribe: (() => void) | undefined;
    const finish = (user: User | null) => {
      if (done) return;
      done = true;
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe?.();
      resolve(user);
    };
    unsubscribe = onAuthStateChanged(firebaseAuth, finish);
    if (firebaseAuth.currentUser) finish(firebaseAuth.currentUser);
    timer = window.setTimeout(() => finish(firebaseAuth.currentUser), timeoutMs);
  });
}

export default function MeetingRoom() {
  const params = useParams<{ code: string }>();
  const code = normalizeCode(String(params.code || ''));
  const router = useRouter();
  const sessionId = useRef(makeSessionId());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const remoteStreams = useRef<Record<string, MediaStream | null>>({});
  const peers = useRef<Record<string, PeerState>>({});
  const streamRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const signalUnsub = useRef<(() => void) | null>(null);
  const participantTimer = useRef<number | null>(null);
  const participantRequestActive = useRef(false);
  const helloSent = useRef<Record<string, string>>({});

  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [chat, setChat] = useState(false);
  const [people, setPeople] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [meeting, setMeeting] = useState<any>(null);
  const [status, setStatus] = useState('Checking sign-in…');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>(fallbackIce);
  const [, forceRemoteRender] = useState(0);

  const attachRemoteStream = useCallback((uid: string) => {
    const element = remoteRefs.current[uid];
    const remote = remoteStreams.current[uid];
    if (!element || !remote) return;
    element.srcObject = remote;
    element.autoplay = true;
    element.playsInline = true;
    void element.play().catch(() => undefined);
  }, []);

  const getOutgoingVideoTrack = () =>
    screenRef.current?.getVideoTracks()[0] || streamRef.current?.getVideoTracks()[0] || null;

  const setOutgoingTrack = async (kind: 'audio' | 'video', track: MediaStreamTrack | null) => {
    await Promise.all(Object.values(peers.current).map((state) => {
      const sender = kind === 'audio' ? state.audioSender : state.videoSender;
      return sender.replaceTrack(track);
    }));
  };

  const signalPath = useCallback((meetingId: string, targetId: string) =>
    collection(firestore, `meetings/${meetingId}/signaling/${targetId}/messages`), []);

  const sendSignal = useCallback(async (meetingId: string, targetId: string, type: SignalType, payload: unknown) => {
    const senderId = firebaseAuth.currentUser?.uid;
    if (!senderId || !targetId || senderId === targetId) return;
    try {
      await addDoc(signalPath(meetingId, targetId), {
        senderId,
        targetId,
        type,
        payload,
        sessionId: sessionId.current,
        createdAt: serverTimestamp(),
      });
      console.info('[WebRTC] signaling sent', { type, targetId });
    } catch (error) {
      console.error('[WebRTC] signaling write failed', { type, targetId, error });
    }
  }, [signalPath]);

  const startOffer = useCallback(async (meetingId: string, targetId: string, state: PeerState) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || uid >= targetId || state.offerStarted || state.pc.signalingState !== 'stable') return;
    state.offerStarted = true;
    try {
      const offer = await state.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await state.pc.setLocalDescription(offer);
      const description = state.pc.localDescription;
      if (!description) throw new Error('Offer description missing');
      await sendSignal(meetingId, targetId, 'offer', { type: description.type, sdp: description.sdp });
      console.info('[WebRTC] offer sent', { targetId });
    } catch (error) {
      state.offerStarted = false;
      console.error('[WebRTC] offer failed', { targetId, error });
    }
  }, [sendSignal]);

  const createPeer = useCallback(async (meetingId: string, targetId: string) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || !targetId || uid === targetId) return null;
    const existing = peers.current[targetId];
    if (existing && !['closed', 'failed'].includes(existing.pc.connectionState)) {
      attachRemoteStream(targetId);
      if (uid < targetId) void startOffer(meetingId, targetId, existing);
      return existing;
    }
    if (existing) {
      try { existing.pc.close(); } catch { /* noop */ }
      delete peers.current[targetId];
    }

    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', iceCandidatePoolSize: 4 });
    const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    const state: PeerState = {
      pc,
      polite: uid > targetId,
      pendingCandidates: [],
      audioSender: audioTransceiver.sender,
      videoSender: videoTransceiver.sender,
      remoteStream: null,
      remoteSessionId: null,
      offerStarted: false,
    };
    peers.current[targetId] = state;
    console.info('[WebRTC] peer created', { targetId, polite: state.polite });

    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal(meetingId, targetId, 'candidate', event.candidate.toJSON());
    };
    pc.onicecandidateerror = (event) => {
      console.warn('[WebRTC] ICE candidate error', { targetId, code: event.errorCode, text: event.errorText, url: event.url });
    };
    pc.oniceconnectionstatechange = () => {
      console.info('[WebRTC] ICE state', { targetId, state: pc.iceConnectionState });
    };
    pc.onconnectionstatechange = () => {
      console.info('[WebRTC] connection state', { targetId, state: pc.connectionState });
      if (pc.connectionState === 'connected') setStatus('Connected');
      if (pc.connectionState === 'failed') {
        state.offerStarted = false;
        try { pc.restartIce(); } catch { /* noop */ }
        window.setTimeout(() => { void startOffer(meetingId, targetId, state); }, 250);
      }
      if (pc.connectionState === 'closed') {
        delete peers.current[targetId];
        remoteStreams.current[targetId] = null;
        forceRemoteRender((v) => v + 1);
      }
    };
    pc.ontrack = (event) => {
      const remote = event.streams[0] || state.remoteStream || new MediaStream();
      if (!remote.getTracks().some((track) => track.id === event.track.id)) remote.addTrack(event.track);
      state.remoteStream = remote;
      remoteStreams.current[targetId] = remote;
      console.info('[WebRTC] remote track received', { targetId, kind: event.track.kind, trackId: event.track.id });
      forceRemoteRender((v) => v + 1);
      window.setTimeout(() => attachRemoteStream(targetId), 0);
    };

    await state.audioSender.replaceTrack(streamRef.current?.getAudioTracks()[0] || null);
    await state.videoSender.replaceTrack(getOutgoingVideoTrack());
    if (uid < targetId) await startOffer(meetingId, targetId, state);
    return state;
  }, [attachRemoteStream, iceServers, sendSignal, startOffer]);

  const requestMedia = useCallback(async (wantVideo: boolean, wantAudio: boolean) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException('Media devices are unavailable in this browser.', 'NotSupportedError');
    }
    return navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: wantAudio });
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!code) {
        setStatus('Unable to join');
        toast.error('Invalid meeting link');
        return;
      }
      const user = await waitForAuth();
      if (!alive) return;
      if (!user) {
        setStatus('Unable to join');
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      try {
        setStatus('Joining meeting…');
        console.info('[Meeting] bootstrap start', { code, uid: user.uid, sessionId: sessionId.current });
        const meta = (await api.get<any>(`/meetings/code/${encodeURIComponent(code)}`)).data?.data;
        if (!meta?.id) throw new Error('Meeting not found');
        const joined = (await api.post<any>(`/meetings/${meta.id}/join`, {})).data?.data;
        if (!alive) return;
        setMeeting({ ...meta, ...joined?.meeting });
        if (joined?.status === 'waiting') {
          setStatus('Waiting for host approval');
          return;
        }

        try {
          setStatus('Preparing connection…');
          const response = await api.get<any>('/meetings/ice-servers');
          const servers = response.data?.data?.iceServers;
          if (Array.isArray(servers) && servers.length) setIceServers(servers);
        } catch (error) {
          console.warn('[WebRTC] using fallback ICE servers', error);
        }

        setStatus('Starting camera…');
        const media = await Promise.race<MediaStream | null>([
          (async () => {
            for (const [wantVideo, wantAudio] of [[true, true], [true, false], [false, true]] as Array<[boolean, boolean]>) {
              try { return await requestMedia(wantVideo, wantAudio); }
              catch (error) { console.warn('[Media] getUserMedia failed', { wantVideo, wantAudio, error }); }
            }
            return null;
          })(),
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 12000)),
        ]);
        if (!alive) {
          media?.getTracks().forEach((track) => track.stop());
          return;
        }
        if (media) {
          streamRef.current = media;
          setStream(media);
          setAudio(media.getAudioTracks().some((track) => track.enabled));
          setVideo(media.getVideoTracks().some((track) => track.enabled));
        } else {
          setAudio(false);
          setVideo(false);
          toast.error('Camera/microphone unavailable. You can still join.');
        }
        setStatus('Connected');
        console.info('[Meeting] bootstrap complete', { meetingId: meta.id, uid: user.uid });
      } catch (error: any) {
        console.error('[Meeting] bootstrap failed', error);
        if (alive) {
          setStatus('Unable to join');
          toast.error(error?.response?.data?.error || error?.message || 'Unable to join meeting');
        }
      }
    })();
    return () => { alive = false; };
  }, [code, requestMedia, router]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Waiting for host approval') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    let active = true;
    const check = async () => {
      try {
        const current = (await api.get<any>(`/meetings/${meeting.id}`)).data?.data;
        if (active && Array.isArray(current?.participants) && current.participants.includes(uid)) window.location.reload();
      } catch (error) {
        console.warn('[Meeting] approval status check failed', error);
      }
    };
    void check();
    const timer = window.setInterval(check, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [meeting?.id, status]);

  useEffect(() => {
    if (localVideoRef.current && stream) localVideoRef.current.srcObject = sharing && screenRef.current ? screenRef.current : stream;
  }, [sharing, stream]);

  useEffect(() => {
    for (const participant of participants) if (participant.uid) attachRemoteStream(participant.uid);
  }, [attachRemoteStream, participants]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Connected') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    let active = true;
    const incoming = collection(firestore, `meetings/${meeting.id}/signaling/${uid}/messages`);
    signalUnsub.current?.();
    signalUnsub.current = onSnapshot(incoming, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (!active || change.type !== 'added') continue;
        const data = change.doc.data() as any;
        const senderId = String(data.senderId || '');
        const incomingSessionId = String(data.sessionId || '');
        if (!senderId || senderId === uid || !data.type) continue;

        let state: PeerState | undefined = peers.current[senderId];
        if (data.type === 'hello' && state && state.remoteSessionId && incomingSessionId && state.remoteSessionId !== incomingSessionId) {
          try { state.pc.close(); } catch { /* noop */ }
          delete peers.current[senderId];
          state = undefined;
        }
        if (!state) state = await createPeer(meeting.id, senderId) || undefined;
        if (!state) continue;
        if (incomingSessionId && state.remoteSessionId && state.remoteSessionId !== incomingSessionId) continue;
        if (incomingSessionId) state.remoteSessionId = incomingSessionId;

        console.info('[WebRTC] signaling received', { type: data.type, senderId });
        try {
          if (data.type === 'hello') {
            if (helloSent.current[senderId] !== sessionId.current) {
              helloSent.current[senderId] = sessionId.current;
              await sendSignal(meeting.id, senderId, 'hello', { protocol: 6 });
            }
            if (uid < senderId) await startOffer(meeting.id, senderId, state);
            continue;
          }
          if (data.type === 'offer') {
            const { pc } = state;
            if (state.polite && pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' });
            if (pc.signalingState !== 'stable') continue;
            await pc.setRemoteDescription(data.payload);
            for (const candidate of state.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
            await pc.setLocalDescription(await pc.createAnswer());
            const answer = pc.localDescription;
            if (!answer) throw new Error('Answer description missing');
            await sendSignal(meeting.id, senderId, 'answer', { type: answer.type, sdp: answer.sdp });
            console.info('[WebRTC] answer sent', { targetId: senderId });
          } else if (data.type === 'answer') {
            if (state.pc.signalingState !== 'have-local-offer') continue;
            await state.pc.setRemoteDescription(data.payload);
            for (const candidate of state.pendingCandidates.splice(0)) await state.pc.addIceCandidate(candidate);
            console.info('[WebRTC] answer applied', { targetId: senderId });
          } else if (data.type === 'candidate' && data.payload) {
            if (state.pc.remoteDescription) await state.pc.addIceCandidate(data.payload);
            else state.pendingCandidates.push(data.payload);
          }
        } catch (error) {
          console.error('[WebRTC] signaling handling failed', { type: data.type, senderId, error });
        }
      }
    }, (error) => console.error('[WebRTC] signaling subscription failed', error));

    const refresh = async () => {
      if (!active || participantRequestActive.current || document.visibilityState === 'hidden') return;
      participantRequestActive.current = true;
      try {
        const result = await api.get<any>(`/meetings/${meeting.id}/participants`);
        const list: Participant[] = Array.isArray(result.data?.data) ? result.data.data : [];
        if (!active) return;
        setParticipants(list);
        const activeIds = new Set(list.filter((p) => p.status !== 'waiting').map((p) => p.uid));
        for (const participant of list) {
          if (!participant.uid || participant.uid === uid || participant.status === 'waiting') continue;
          await createPeer(meeting.id, participant.uid);
          const remoteSession = helloSent.current[participant.uid];
          if (!remoteSession || remoteSession !== sessionId.current) {
            helloSent.current[participant.uid] = sessionId.current;
            await sendSignal(meeting.id, participant.uid, 'hello', { protocol: 6 });
          }
          attachRemoteStream(participant.uid);
        }
        for (const [id, state] of Object.entries(peers.current)) {
          if (!activeIds.has(id)) {
            try { state.pc.close(); } catch { /* noop */ }
            delete peers.current[id];
            remoteStreams.current[id] = null;
          }
        }
      } catch (error) {
        console.error('[WebRTC] participant refresh failed', error);
      } finally {
        participantRequestActive.current = false;
      }
    };

    void refresh();
    participantTimer.current = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      if (participantTimer.current) window.clearInterval(participantTimer.current);
      participantTimer.current = null;
      signalUnsub.current?.();
      signalUnsub.current = null;
    };
  }, [attachRemoteStream, createPeer, meeting?.id, sendSignal, startOffer, status]);

  useEffect(() => () => {
    signalUnsub.current?.();
    Object.values(peers.current).forEach((state) => state.pc.close());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const toggle = async (kind: 'audio' | 'video') => {
    try {
      let track = streamRef.current?.getTracks().find((item) => item.kind === kind) || null;
      if (!track) {
        const requested = await requestMedia(kind === 'video', kind === 'audio');
        track = requested.getTracks().find((item) => item.kind === kind) || null;
        requested.getTracks().filter((item) => item !== track).forEach((item) => item.stop());
        if (!track) throw new Error(`No ${kind} track available`);
        if (!streamRef.current) streamRef.current = new MediaStream();
        streamRef.current.addTrack(track);
        setStream(new MediaStream(streamRef.current.getTracks()));
      }
      track.enabled = !track.enabled;
      await setOutgoingTrack(kind, track.enabled ? track : null);
      if (kind === 'audio') setAudio(track.enabled); else setVideo(track.enabled);
    } catch (error) {
      console.error('[Media] toggle failed', error);
      toast.error(`${kind === 'audio' ? 'Microphone' : 'Camera'} unavailable.`);
    }
  };

  const stopScreenShare = async () => {
    const camera = streamRef.current?.getVideoTracks()[0] || null;
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    await setOutgoingTrack('video', camera);
    if (localVideoRef.current && streamRef.current) localVideoRef.current.srcObject = streamRef.current;
    setSharing(false);
  };

  const shareScreen = async () => {
    if (sharing) { await stopScreenShare(); return; }
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported in this browser.');
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      if (!track) throw new Error('No screen track returned.');
      screenRef.current = screen;
      await setOutgoingTrack('video', track);
      if (localVideoRef.current) localVideoRef.current.srcObject = screen;
      setSharing(true);
      track.onended = () => { void stopScreenShare(); };
    } catch (error: any) {
      if (error?.name !== 'AbortError') toast.error(error?.message || 'Unable to share screen');
    }
  };

  const copyInvite = async () => {
    const invite = `${typeof window === 'undefined' ? '' : window.location.origin}/meeting/${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast.success('Invite link copied');
    } catch { toast.error('Could not copy invite link'); }
  };

  const loadMessages = async () => {
    if (!meeting?.id) return;
    try {
      const response = await api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 });
      setMessages(Array.isArray(response.data?.data?.messages) ? response.data.data.messages : []);
    } catch (error) { console.warn('[Chat] message load failed', error); }
  };

  useEffect(() => { if (chat) void loadMessages(); }, [chat, meeting?.id]);

  const sendMessage = async () => {
    const content = messageText.trim();
    if (!content || !meeting?.id) return;
    setMessageText('');
    try {
      await api.post(`/chat/meetings/${meeting.id}/messages`, { content, type: 'text' });
      await loadMessages();
    } catch (error: any) {
      setMessageText(content);
      toast.error(error?.response?.data?.error || 'Unable to send message');
    }
  };

  const moveParticipant = async (userId: string, approve: boolean) => {
    if (!meeting?.id) return;
    try {
      await api.post(`/meetings/${meeting.id}/${approve ? 'approve' : 'deny'}/${encodeURIComponent(userId)}`, {});
      setParticipants((current) => approve
        ? current.map((p) => p.uid === userId ? { ...p, status: 'active' } : p)
        : current.filter((p) => p.uid !== userId));
      toast.success(approve ? 'Participant approved' : 'Participant denied');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || `Unable to ${approve ? 'approve' : 'deny'} participant`);
    }
  };

  const leave = async () => {
    const uid = firebaseAuth.currentUser?.uid;
    try {
      if (meeting?.id) {
        if (uid && meeting.hostId === uid) await api.post(`/meetings/${meeting.id}/end`, {});
        else await api.delete(`/meetings/${meeting.id}/leave`);
      }
    } catch (error) { console.warn('[Meeting] leave failed', error); }
    Object.values(peers.current).forEach((state) => state.pc.close());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
    router.replace('/dashboard');
  };

  if (status === 'Waiting for host approval') {
    return <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl"><Shield className="mx-auto text-indigo-400" size={36}/><h1 className="mt-4 text-2xl font-semibold">Waiting for approval</h1><p className="mt-2 text-sm text-slate-400">The host has been notified. This page will enter the meeting automatically after approval.</p><button type="button" onClick={leave} className="mt-6 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">Leave waiting room</button></div></main>;
  }
  if (status === 'Unable to join') {
    return <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white"><div className="text-center"><h1 className="text-xl font-semibold">Unable to join meeting</h1><p className="mt-2 text-sm text-slate-400">Please reload and try the meeting link again.</p><button type="button" onClick={() => router.replace('/dashboard')} className="mt-4 rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold">Back to dashboard</button></div></main>;
  }
  if (status !== 'Connected') {
    return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400"/><p>{status}</p></div></main>;
  }

  const uid = firebaseAuth.currentUser?.uid;
  const isHost = meeting?.hostId === uid;
  const waitingParticipants = participants.filter((p) => p.uid !== uid && p.status === 'waiting');
  const screenShareAllowed = meeting?.settings?.screenShareEnabled !== false;

  return <main className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 text-white">
    <header className="relative z-50 flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4 sm:px-5"><div className="min-w-0"><p className="truncate font-semibold">{meeting?.title || 'RTC Meeting'}</p><button type="button" onClick={() => void copyInvite()} className="mt-0.5 flex items-center gap-1 text-xs text-slate-400 hover:text-white"><span>{code}</span><Copy size={12}/>{copied && ' Copied'}</button></div><div className="flex items-center gap-3 text-slate-400"><Shield size={16}/><span className="text-xs">{participants.length} participant{participants.length === 1 ? '' : 's'}</span></div></header>
    {isHost && waitingParticipants.length > 0 && <div className="relative z-40 flex shrink-0 items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm"><div className="min-w-0"><p className="font-medium text-amber-200">{waitingParticipants.length} participant{waitingParticipants.length === 1 ? '' : 's'} waiting for approval</p><p className="truncate text-xs text-amber-100/70">{waitingParticipants.map((p) => p.displayName || 'Participant').join(', ')}</p></div><button type="button" onClick={() => { setChat(false); setPeople(true); }} className="shrink-0 rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950">Review</button></div>}
    <section className="relative z-0 flex min-h-0 flex-1 overflow-hidden"><div className="relative min-w-0 flex-1 overflow-auto p-3 pb-24 sm:p-4 sm:pb-24"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={localVideoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${video || sharing ? '' : 'hidden'}`}/>{!video && !sharing && <div className="absolute inset-0 grid place-items-center text-2xl font-semibold">U</div>}<span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">You</span>{sharing && <span className="absolute right-3 top-3 rounded-lg bg-emerald-500 px-2 py-1 text-xs font-medium">Screen sharing</span>}</div>
      {participants.map((participant) => { if (!participant.uid || participant.uid === uid || participant.status === 'waiting') return null; const hasStream = !!remoteStreams.current[participant.uid]; return <div key={participant.uid} className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={(element) => { remoteRefs.current[participant.uid] = element; if (element) attachRemoteStream(participant.uid); }} autoPlay playsInline className="h-full w-full object-cover" onClick={(event) => { void event.currentTarget.play().catch(() => undefined); }}/>{!hasStream && <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">Connecting media…</div>}<span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">{participant.displayName || 'Participant'}</span></div>; })}
    </div></div>
      {(chat || people) && <><button type="button" aria-label="Close panel" onClick={() => { setChat(false); setPeople(false); }} className="absolute inset-0 z-[60] bg-black/40 md:hidden"/><aside className="absolute top-0 bottom-20 right-0 z-[90] flex w-[min(90vw,24rem)] flex-col border-l border-white/10 bg-slate-900 shadow-2xl md:relative md:z-20 md:w-80 md:shadow-none"><div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4"><h2 className="font-semibold">{chat ? 'Chat' : 'Participants'}</h2><button type="button" onClick={() => { setChat(false); setPeople(false); }} aria-label="Close"><X size={18}/></button></div>{chat ? <><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{messages.length ? messages.map((m) => <div key={m.id}><p className="text-xs text-slate-500">{m.senderName || 'Participant'}</p><p className="mt-1 break-words rounded-xl bg-white/5 px-3 py-2 text-sm">{m.deletedAt ? '[Message deleted]' : m.content}</p></div>) : <p className="mt-8 text-center text-sm text-slate-500">No messages yet.</p>}</div><div className="shrink-0 border-t border-white/10 bg-slate-900 p-3"><div className="flex gap-2"><input value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void sendMessage()} className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm outline-none" placeholder="Type a message…"/><button type="button" onClick={() => void sendMessage()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500" aria-label="Send message"><Send size={16}/></button></div></div></> : <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{participants.length === 0 && <p className="text-sm text-slate-500">No participants found.</p>}{participants.map((p) => <div key={p.uid} className="rounded-xl bg-white/5 p-3"><div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-500/30 text-sm font-semibold">{(p.displayName || 'U').charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm">{p.displayName || 'User'}</p><p className="text-xs text-slate-500">{p.role === 'host' ? 'Host' : p.status === 'waiting' ? 'Waiting for approval' : p.status === 'active' ? 'Participant' : p.status}</p></div></div>{isHost && p.role !== 'host' && p.status === 'waiting' && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void moveParticipant(p.uid, true)} className="min-h-10 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950">Approve</button><button type="button" onClick={() => void moveParticipant(p.uid, false)} className="min-h-10 rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white">Deny</button></div>}</div>)}</div>}</aside></>}
    </section>
    <footer className="absolute bottom-0 left-0 right-0 z-[80] flex min-h-20 items-center justify-center gap-2 border-t border-white/10 bg-slate-950/95 px-2 py-3 backdrop-blur sm:gap-3 sm:px-4"><button type="button" onClick={() => void toggle('audio')} aria-label={audio ? 'Mute microphone' : 'Unmute microphone'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${audio ? 'bg-slate-800' : 'bg-red-500'}`}>{audio ? <Mic/> : <MicOff/>}</button><button type="button" onClick={() => void toggle('video')} aria-label={video ? 'Turn camera off' : 'Turn camera on'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${video ? 'bg-slate-800' : 'bg-red-500'}`}>{video ? <Video/> : <VideoOff/>}</button><button type="button" disabled={!screenShareAllowed} onClick={() => void shareScreen()} aria-label={sharing ? 'Stop sharing' : 'Share screen'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${!screenShareAllowed ? 'bg-slate-800/40 text-slate-600' : sharing ? 'bg-indigo-500' : 'bg-slate-800'}`}><MonitorUp/></button><button type="button" onClick={() => void copyInvite()} aria-label="Share meeting link" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-800"><Share2/></button><button type="button" onClick={() => { setPeople(false); setChat((v) => !v); }} aria-label="Chat" className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${chat ? 'bg-indigo-500' : 'bg-slate-800'}`}><MessageSquare/></button><button type="button" onClick={() => { setChat(false); setPeople((v) => !v); }} aria-label="Participants" className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full ${people ? 'bg-indigo-500' : 'bg-slate-800'}`}><Users/>{isHost && waitingParticipants.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-950">{waitingParticipants.length}</span>}</button><button type="button" onClick={() => void leave()} aria-label={isHost ? 'End meeting' : 'Leave meeting'} className="ml-1 grid h-12 w-14 shrink-0 place-items-center rounded-full bg-red-500"><PhoneOff/></button></footer>
  </main>;
}
