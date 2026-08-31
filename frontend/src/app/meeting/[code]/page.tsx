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
type Signal = { senderId: string; targetId: string; type: 'hello' | 'offer' | 'answer' | 'candidate'; payload: any; sessionId?: string; createdAt?: unknown };
type PeerState = {
  pc: RTCPeerConnection;
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
  remoteStream: MediaStream | null;
  remoteSessionId: string | null;
  remoteSessionAt: number;
  offerInFlight: boolean;
  pendingCandidates: RTCIceCandidateInit[];
};

const fallbackIce: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const makeSessionId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function waitForAuth(timeoutMs = 10000): Promise<User | null> {
  return new Promise((resolve) => {
    let finished = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (user: User | null) => {
      if (finished) return;
      finished = true;
      if (unsubscribe) unsubscribe();
      resolve(user);
    };
    unsubscribe = onAuthStateChanged(firebaseAuth, finish);
    if (firebaseAuth.currentUser) finish(firebaseAuth.currentUser);
    window.setTimeout(() => finish(firebaseAuth.currentUser), timeoutMs);
  });
}

function normalizeCode(value: string) {
  const input = value.trim();
  try {
    const url = new URL(input);
    const marker = '/meeting/';
    const index = url.pathname.indexOf(marker);
    return decodeURIComponent(index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname.replace(/^\/+/, '')).split(/[?#]/)[0].replace(/^\/|\/$/g, '');
  } catch {
    const marker = '/meeting/';
    const index = input.indexOf(marker);
    return decodeURIComponent(index >= 0 ? input.slice(index + marker.length) : input).split(/[?#]/)[0].replace(/^\/|\/$/g, '');
  }
}

export default function MeetingRoom() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = normalizeCode(String(params.code || ''));
  const sessionId = useRef(makeSessionId());
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const remoteStreams = useRef<Record<string, MediaStream | null>>({});
  const peers = useRef<Record<string, PeerState>>({});
  const streamRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const signalUnsub = useRef<(() => void) | null>(null);
  const helloTimer = useRef<number | null>(null);
  const participantTimer = useRef<number | null>(null);
  const requestActive = useRef(false);
  const remoteSessionTimes = useRef<Record<string, number>>({});
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
  const [, forceRender] = useState(0);

  const attachRemote = useCallback((uid: string) => {
    const element = remoteRefs.current[uid];
    const remote = remoteStreams.current[uid];
    if (!element || !remote) return;
    if (element.srcObject !== remote) element.srcObject = remote;
    element.autoplay = true;
    element.playsInline = true;
    void element.play().catch(() => undefined);
  }, []);

  const outgoingVideoTrack = () => screenRef.current?.getVideoTracks()[0] || streamRef.current?.getVideoTracks()[0] || null;

  const replaceOutgoing = useCallback(async (kind: 'audio' | 'video', track: MediaStreamTrack | null) => {
    await Promise.all(Object.values(peers.current).map((peer) => (kind === 'audio' ? peer.audioSender : peer.videoSender).replaceTrack(track)));
  }, []);

  const sendSignal = useCallback(async (meetingId: string, targetId: string, type: Signal['type'], payload: any) => {
    const senderId = firebaseAuth.currentUser?.uid;
    if (!senderId || !targetId || senderId === targetId) return;
    try {
      await addDoc(collection(firestore, `meetings/${meetingId}/signaling/${targetId}/messages`), {
        senderId,
        targetId,
        type,
        payload,
        sessionId: sessionId.current,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('[WebRTC] signal write failed', { type, targetId, error });
    }
  }, []);

  const closePeer = useCallback((uid: string) => {
    const peer = peers.current[uid];
    if (!peer) return;
    try { peer.pc.close(); } catch { /* noop */ }
    delete peers.current[uid];
    remoteStreams.current[uid] = null;
    forceRender((v) => v + 1);
  }, []);

  const createPeer = useCallback(async (meetingId: string, targetId: string) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || !targetId || uid === targetId) return null;
    const existing = peers.current[targetId];
    if (existing && !['closed', 'failed'].includes(existing.pc.connectionState)) return existing;
    if (existing) closePeer(targetId);

    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', iceCandidatePoolSize: 4 });
    const audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    const videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    const peer: PeerState = { pc, audioSender, videoSender, remoteStream: null, remoteSessionId: null, remoteSessionAt: 0, offerInFlight: false, pendingCandidates: [] };
    peers.current[targetId] = peer;

    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal(meetingId, targetId, 'candidate', event.candidate.toJSON());
    };
    pc.onicecandidateerror = (event) => console.warn('[WebRTC] ICE candidate error', { targetId, code: event.errorCode, text: event.errorText, url: event.url });
    pc.oniceconnectionstatechange = () => console.info('[WebRTC] ICE state', { targetId, state: pc.iceConnectionState });
    pc.onconnectionstatechange = () => {
      console.info('[WebRTC] connection state', { targetId, state: pc.connectionState });
      if (pc.connectionState === 'connected') setStatus('Connected');
      if (pc.connectionState === 'failed') {
        peer.offerInFlight = false;
        try { pc.restartIce(); } catch { /* noop */ }
      }
      if (pc.connectionState === 'closed') closePeer(targetId);
    };
    pc.ontrack = (event) => {
      const remote = event.streams[0] || peer.remoteStream || new MediaStream();
      if (!remote.getTracks().some((track) => track.id === event.track.id)) remote.addTrack(event.track);
      peer.remoteStream = remote;
      remoteStreams.current[targetId] = remote;
      forceRender((v) => v + 1);
      window.setTimeout(() => attachRemote(targetId), 0);
    };

    await audioSender.replaceTrack(streamRef.current?.getAudioTracks()[0] || null);
    await videoSender.replaceTrack(outgoingVideoTrack());
    return peer;
  }, [attachRemote, closePeer, iceServers, sendSignal]);

  const ensureOffer = useCallback(async (meetingId: string, targetId: string, peer: PeerState) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || uid >= targetId || peer.offerInFlight || peer.pc.signalingState !== 'stable') return;
    peer.offerInFlight = true;
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      const description = peer.pc.localDescription;
      if (!description) throw new Error('Missing local offer');
      await sendSignal(meetingId, targetId, 'offer', { type: description.type, sdp: description.sdp });
    } catch (error) {
      peer.offerInFlight = false;
      console.error('[WebRTC] offer failed', { targetId, error });
    }
  }, [sendSignal]);

  const requestMedia = useCallback(async (wantVideo: boolean, wantAudio: boolean) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Media devices are unavailable.', 'NotSupportedError');
    return navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: wantAudio });
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const user = await waitForAuth();
      if (!alive) return;
      if (!user) {
        setStatus('Unable to join');
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      try {
        setStatus('Joining meeting…');
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
          const response = await api.get<any>('/meetings/ice-servers');
          const servers = response.data?.data?.iceServers;
          if (Array.isArray(servers) && servers.length) setIceServers(servers);
        } catch (error) { console.warn('[WebRTC] ICE server lookup failed', error); }
        setStatus('Starting camera…');
        let media: MediaStream | null = null;
        for (const [wantVideo, wantAudio] of [[true, true], [true, false], [false, true]] as Array<[boolean, boolean]>) {
          try { media = await requestMedia(wantVideo, wantAudio); break; } catch (error) { console.warn('[Media] request failed', { wantVideo, wantAudio, error }); }
        }
        if (!alive) { media?.getTracks().forEach((track) => track.stop()); return; }
        if (media) {
          streamRef.current = media;
          setStream(media);
          setAudio(Boolean(media.getAudioTracks().length));
          setVideo(Boolean(media.getVideoTracks().length));
        } else {
          setAudio(false); setVideo(false);
          toast.error('Camera/microphone unavailable. You can still join.');
        }
        setStatus('Connected');
      } catch (error: any) {
        console.error('[Meeting] bootstrap failed', error);
        if (alive) { setStatus('Unable to join'); toast.error(error?.response?.data?.error || error?.message || 'Unable to join meeting'); }
      }
    })();
    return () => { alive = false; };
  }, [code, requestMedia, router]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Waiting for host approval') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    const check = async () => {
      try {
        const current = (await api.get<any>(`/meetings/${meeting.id}`)).data?.data;
        if (Array.isArray(current?.participants) && current.participants.includes(uid)) window.location.reload();
      } catch { /* keep waiting */ }
    };
    const timer = window.setInterval(check, 2500);
    void check();
    return () => window.clearInterval(timer);
  }, [meeting?.id, status]);

  useEffect(() => {
    if (localVideoRef.current && stream) localVideoRef.current.srcObject = sharing && screenRef.current ? screenRef.current : stream;
  }, [sharing, stream]);

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
        const data = change.doc.data() as Signal;
        const senderId = String(data.senderId || '');
        const senderSession = String(data.sessionId || '');
        if (!senderId || senderId === uid || !data.type) continue;
        if (data.type === 'hello') {
          const sentAt = Number(data.payload?.sentAt || 0);
          if (sentAt && sentAt < (remoteSessionTimes.current[senderId] || 0)) continue;
          remoteSessionTimes.current[senderId] = sentAt || Date.now();
          const current = peers.current[senderId];
          if (current && current.remoteSessionId && current.remoteSessionId !== senderSession) closePeer(senderId);
          const peer = (await createPeer(meeting.id, senderId)) as PeerState | null;
          if (!peer) continue;
          peer.remoteSessionId = senderSession || peer.remoteSessionId;
          peer.remoteSessionAt = remoteSessionTimes.current[senderId];
          await sendSignal(meeting.id, senderId, 'hello', { protocol: 8, sentAt: Date.now() });
          if (uid < senderId) await ensureOffer(meeting.id, senderId, peer);
          continue;
        }
        const peer = peers.current[senderId];
        if (!peer || !peer.remoteSessionId || (senderSession && senderSession !== peer.remoteSessionId)) continue;
        try {
          if (data.type === 'offer') {
            if (peer.pc.signalingState !== 'stable') {
              try { await peer.pc.setLocalDescription({ type: 'rollback' }); } catch { /* noop */ }
            }
            if (peer.pc.signalingState !== 'stable') continue;
            await peer.pc.setRemoteDescription(data.payload);
            for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
            await peer.pc.setLocalDescription(await peer.pc.createAnswer());
            const answer = peer.pc.localDescription;
            if (answer) await sendSignal(meeting.id, senderId, 'answer', { type: answer.type, sdp: answer.sdp });
          } else if (data.type === 'answer') {
            if (peer.pc.signalingState !== 'have-local-offer') continue;
            await peer.pc.setRemoteDescription(data.payload);
            for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
            peer.offerInFlight = false;
          } else if (data.type === 'candidate' && data.payload) {
            if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.payload);
            else peer.pendingCandidates.push(data.payload);
          }
        } catch (error) {
          console.error('[WebRTC] signaling handling failed', { senderId, type: data.type, error });
        }
      }
    }, (error) => console.error('[WebRTC] signaling subscription failed', error));

    const refresh = async () => {
      if (!active || requestActive.current || document.visibilityState === 'hidden') return;
      requestActive.current = true;
      try {
        const response = await api.get<any>(`/meetings/${meeting.id}/participants`);
        const list: Participant[] = Array.isArray(response.data?.data) ? response.data.data : [];
        if (!active) return;
        setParticipants(list);
        const activeIds = new Set(list.filter((p) => p.status === 'active').map((p) => p.uid));
        for (const p of list) {
          if (!p.uid || p.uid === uid || p.status !== 'active') continue;
          const peer = (await createPeer(meeting.id, p.uid)) as PeerState | null;
          if (!peer) continue;
          const last = remoteSessionTimes.current[p.uid] || 0;
          if (!peer.remoteSessionId || last < Date.now() - 8000) {
            await sendSignal(meeting.id, p.uid, 'hello', { protocol: 8, sentAt: Date.now() });
          }
          if (uid < p.uid) await ensureOffer(meeting.id, p.uid, peer);
          attachRemote(p.uid);
        }
        for (const id of Object.keys(peers.current)) if (!activeIds.has(id)) closePeer(id);
      } catch (error) { console.error('[WebRTC] participant refresh failed', error); }
      finally { requestActive.current = false; }
    };
    void refresh();
    participantTimer.current = window.setInterval(refresh, 2500);
    helloTimer.current = window.setInterval(() => {
      for (const p of participants) if (p.uid !== uid && p.status === 'active') void sendSignal(meeting.id, p.uid, 'hello', { protocol: 8, sentAt: Date.now() });
    }, 5000);
    return () => {
      active = false;
      signalUnsub.current?.(); signalUnsub.current = null;
      if (participantTimer.current) window.clearInterval(participantTimer.current);
      if (helloTimer.current) window.clearInterval(helloTimer.current);
      participantTimer.current = null; helloTimer.current = null;
    };
  }, [attachRemote, closePeer, createPeer, ensureOffer, meeting?.id, participants, sendSignal, status]);

  useEffect(() => () => {
    signalUnsub.current?.();
    Object.keys(peers.current).forEach((uid) => { try { peers.current[uid].pc.close(); } catch { /* noop */ } });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const toggle = async (kind: 'audio' | 'video') => {
    try {
      let track = streamRef.current?.getTracks().find((item) => item.kind === kind) || null;
      if (!track) {
        const fresh = await requestMedia(kind === 'video', kind === 'audio');
        track = fresh.getTracks().find((item) => item.kind === kind) || null;
        fresh.getTracks().filter((item) => item !== track).forEach((item) => item.stop());
        if (!track) throw new Error(`No ${kind} track available`);
        if (!streamRef.current) streamRef.current = new MediaStream();
        streamRef.current.addTrack(track);
        setStream(new MediaStream(streamRef.current.getTracks()));
      }
      track.enabled = !track.enabled;
      await replaceOutgoing(kind, track.enabled ? track : null);
      if (kind === 'audio') setAudio(track.enabled); else setVideo(track.enabled);
    } catch (error) { console.error('[Media] toggle failed', error); toast.error(`${kind === 'audio' ? 'Microphone' : 'Camera'} unavailable.`); }
  };

  const stopScreen = async () => {
    const camera = streamRef.current?.getVideoTracks()[0] || null;
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    await replaceOutgoing('video', camera);
    if (localVideoRef.current && streamRef.current) localVideoRef.current.srcObject = streamRef.current;
    setSharing(false);
  };

  const shareScreen = async () => {
    if (sharing) { await stopScreen(); return; }
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported in this browser.');
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      if (!track) throw new Error('No screen track returned.');
      screenRef.current = screen;
      await replaceOutgoing('video', track);
      if (localVideoRef.current) localVideoRef.current.srcObject = screen;
      setSharing(true);
      track.onended = () => { void stopScreen(); };
    } catch (error: any) { if (error?.name !== 'AbortError') toast.error(error?.message || 'Unable to share screen'); }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meeting/${encodeURIComponent(code)}`);
      setCopied(true); window.setTimeout(() => setCopied(false), 1500); toast.success('Invite link copied');
    } catch { toast.error('Could not copy invite link'); }
  };

  const loadMessages = async () => {
    if (!meeting?.id) return;
    try {
      const response = await api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 });
      setMessages(Array.isArray(response.data?.data?.messages) ? response.data.data.messages : []);
    } catch (error) { console.warn('[Chat] load failed', error); }
  };

  useEffect(() => { if (chat) void loadMessages(); }, [chat, meeting?.id]);

  const sendMessage = async () => {
    const content = messageText.trim();
    if (!content || !meeting?.id) return;
    setMessageText('');
    try { await api.post(`/chat/meetings/${meeting.id}/messages`, { content, type: 'text' }); await loadMessages(); }
    catch (error: any) { setMessageText(content); toast.error(error?.response?.data?.error || 'Unable to send message'); }
  };

  const moveParticipant = async (userId: string, approve: boolean) => {
    if (!meeting?.id) return;
    try {
      await api.post(`/meetings/${meeting.id}/${approve ? 'approve' : 'deny'}/${encodeURIComponent(userId)}`, {});
      setParticipants((current) => approve ? current.map((p) => p.uid === userId ? { ...p, status: 'active' } : p) : current.filter((p) => p.uid !== userId));
      toast.success(approve ? 'Participant approved' : 'Participant denied');
    } catch (error: any) { toast.error(error?.response?.data?.error || 'Unable to update participant'); }
  };

  const leave = async () => {
    const uid = firebaseAuth.currentUser?.uid;
    try {
      if (meeting?.id) {
        if (uid && meeting.hostId === uid) await api.post(`/meetings/${meeting.id}/end`, {});
        else await api.delete(`/meetings/${meeting.id}/leave`);
      }
    } catch (error) { console.warn('[Meeting] leave failed', error); }
    Object.values(peers.current).forEach((peer) => peer.pc.close());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
    router.replace('/dashboard');
  };

  if (status === 'Waiting for host approval') return <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center"><Shield className="mx-auto text-indigo-400" size={36}/><h1 className="mt-4 text-2xl font-semibold">Waiting for approval</h1><p className="mt-2 text-sm text-slate-400">The host has been notified. This page enters automatically after approval.</p><button type="button" onClick={leave} className="mt-6 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">Leave waiting room</button></div></main>;
  if (status === 'Unable to join') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><h1 className="text-xl font-semibold">Unable to join meeting</h1><button type="button" onClick={() => router.replace('/dashboard')} className="mt-4 rounded-xl bg-indigo-500 px-5 py-2">Back to dashboard</button></div></main>;
  if (status !== 'Connected') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400"/><p>{status}</p></div></main>;

  const uid = firebaseAuth.currentUser?.uid;
  const isHost = meeting?.hostId === uid;
  const waiting = participants.filter((p) => p.uid !== uid && p.status === 'waiting');

  return <main className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 text-white">
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4"><div><p className="font-semibold">{meeting?.title || 'RTC Meeting'}</p><button type="button" onClick={() => void copyInvite()} className="flex items-center gap-1 text-xs text-slate-400">{code}<Copy size={12}/>{copied && 'Copied'}</button></div><div className="flex items-center gap-2 text-xs text-slate-400"><Shield size={16}/>{participants.length} participants</div></header>
    {isHost && waiting.length > 0 && <div className="flex items-center justify-between border-b border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm"><span className="text-amber-200">{waiting.length} participant{waiting.length === 1 ? '' : 's'} waiting for approval</span><button type="button" onClick={() => setPeople(true)} className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950">Review</button></div>}
    <section className="relative flex min-h-0 flex-1 overflow-hidden"><div className="min-w-0 flex-1 overflow-auto p-3 pb-24"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={localVideoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${video || sharing ? '' : 'hidden'}`}/>{!video && !sharing && <div className="absolute inset-0 grid place-items-center text-2xl font-semibold">U</div>}<span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">You</span>{sharing && <span className="absolute right-3 top-3 rounded-lg bg-emerald-500 px-2 py-1 text-xs font-medium">Screen sharing</span>}</div>
      {participants.map((p) => { if (!p.uid || p.uid === uid || p.status !== 'active') return null; const hasStream = !!remoteStreams.current[p.uid]; return <div key={p.uid} className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={(el) => { remoteRefs.current[p.uid] = el; if (el) attachRemote(p.uid); }} autoPlay playsInline className="h-full w-full object-cover" onClick={(e) => { void e.currentTarget.play().catch(() => undefined); }}/>{!hasStream && <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">Connecting media…</div>}<span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">{p.displayName || 'Participant'}</span></div>; })}
    </div></div>
    {(chat || people) && <><button type="button" aria-label="Close panel" onClick={() => { setChat(false); setPeople(false); }} className="absolute inset-0 z-40 bg-black/40 md:hidden"/><aside className="absolute right-0 top-0 bottom-20 z-50 flex w-[min(90vw,24rem)] flex-col border-l border-white/10 bg-slate-900 md:relative md:bottom-0 md:z-20 md:w-80"><div className="flex items-center justify-between border-b border-white/10 p-4"><h2 className="font-semibold">{chat ? 'Chat' : 'Participants'}</h2><button type="button" onClick={() => { setChat(false); setPeople(false); }}><X size={18}/></button></div>{chat ? <><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{messages.length ? messages.map((m) => <div key={m.id}><p className="text-xs text-slate-500">{m.senderName || 'Participant'}</p><p className="mt-1 rounded-xl bg-white/5 px-3 py-2 text-sm">{m.deletedAt ? '[Message deleted]' : m.content}</p></div>) : <p className="mt-8 text-center text-sm text-slate-500">No messages yet.</p>}</div><div className="border-t border-white/10 p-3"><div className="flex gap-2"><input value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void sendMessage()} className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm" placeholder="Type a message…"/><button type="button" onClick={() => void sendMessage()} className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500"><Send size={16}/></button></div></div></> : <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{participants.map((p) => <div key={p.uid} className="rounded-xl bg-white/5 p-3"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-indigo-500/30 text-sm">{(p.displayName || 'U').charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm">{p.displayName || 'User'}</p><p className="text-xs text-slate-500">{p.role === 'host' ? 'Host' : p.status}</p></div></div>{isHost && p.role !== 'host' && p.status === 'waiting' && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void moveParticipant(p.uid, true)} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950">Approve</button><button type="button" onClick={() => void moveParticipant(p.uid, false)} className="rounded-lg bg-red-500 px-3 py-2 text-xs font-bold">Deny</button></div>}</div>)}</div>}</aside></>}
    </section>
    <footer className="absolute bottom-0 left-0 right-0 z-30 flex min-h-20 items-center justify-center gap-2 border-t border-white/10 bg-slate-950/95 px-2 py-3"><button type="button" onClick={() => void toggle('audio')} className={`grid h-12 w-12 place-items-center rounded-full ${audio ? 'bg-slate-800' : 'bg-red-500'}`}>{audio ? <Mic/> : <MicOff/>}</button><button type="button" onClick={() => void toggle('video')} className={`grid h-12 w-12 place-items-center rounded-full ${video ? 'bg-slate-800' : 'bg-red-500'}`}>{video ? <Video/> : <VideoOff/>}</button><button type="button" onClick={() => void shareScreen()} className={`grid h-12 w-12 place-items-center rounded-full ${sharing ? 'bg-indigo-500' : 'bg-slate-800'}`}><MonitorUp/></button><button type="button" onClick={() => void copyInvite()} className="grid h-12 w-12 place-items-center rounded-full bg-slate-800"><Share2/></button><button type="button" onClick={() => { setPeople(false); setChat((v) => !v); }} className={`grid h-12 w-12 place-items-center rounded-full ${chat ? 'bg-indigo-500' : 'bg-slate-800'}`}><MessageSquare/></button><button type="button" onClick={() => { setChat(false); setPeople((v) => !v); }} className={`relative grid h-12 w-12 place-items-center rounded-full ${people ? 'bg-indigo-500' : 'bg-slate-800'}`}><Users/>{isHost && waiting.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-950">{waiting.length}</span>}</button><button type="button" onClick={() => void leave()} className="grid h-12 w-14 place-items-center rounded-full bg-red-500"><PhoneOff/></button></footer>
  </main>;
}
