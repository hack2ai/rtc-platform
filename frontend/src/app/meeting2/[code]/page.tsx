'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { useParams, useRouter } from 'next/navigation';
import { Copy, Mic, MicOff, MonitorUp, PhoneOff, Share2, Shield, Users, Video, VideoOff } from 'lucide-react';
import { api } from '../../../config/api';
import { firebaseAuth, firestore } from '../../../config/firebase';
import toast from 'react-hot-toast';

type Participant = { uid: string; displayName?: string; role?: string; status?: string };
type Signal = { senderId: string; targetId: string; type: 'hello' | 'offer' | 'answer' | 'candidate'; payload: any; sessionId?: string; sentAt?: number };
type Peer = { pc: RTCPeerConnection; audioSender: RTCRtpSender; videoSender: RTCRtpSender; remoteSessionId: string; offerInFlight: boolean; pendingCandidates: RTCIceCandidateInit[]; iceChangedAt: number };

const FALLBACK_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const waitForAuth = (timeoutMs = 10000): Promise<User | null> => new Promise((resolve) => {
  let finished = false;
  let unsubscribe: (() => void) | undefined;
  const finish = (user: User | null) => {
    if (finished) return;
    finished = true;
    unsubscribe?.();
    resolve(user);
  };
  unsubscribe = onAuthStateChanged(firebaseAuth, finish);
  if (firebaseAuth.currentUser) finish(firebaseAuth.currentUser);
  window.setTimeout(() => finish(firebaseAuth.currentUser), timeoutMs);
});

const normalizeCode = (value: string) => {
  const input = value.trim();
  try {
    const url = new URL(input);
    const marker = '/meeting/';
    const i = url.pathname.indexOf(marker);
    return decodeURIComponent(i >= 0 ? url.pathname.slice(i + marker.length) : url.pathname.replace(/^\/+/, '')).split(/[?#]/)[0].replace(/^\/|\/$/g, '');
  } catch {
    const marker = '/meeting/';
    const i = input.indexOf(marker);
    return decodeURIComponent(i >= 0 ? input.slice(i + marker.length) : input).split(/[?#]/)[0].replace(/^\/|\/$/g, '');
  }
};

const sessionId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function MeetingRoomV2() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = normalizeCode(String(params.code || ''));
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const remoteStreams = useRef<Record<string, MediaStream | null>>({});
  const peers = useRef<Record<string, Peer>>({});
  const pendingSignals = useRef<Record<string, Signal[]>>({});
  const remoteSessions = useRef<Record<string, { id: string; sentAt: number }>>({});
  const participantsRef = useRef<Participant[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>(FALLBACK_ICE);
  const signalUnsub = useRef<(() => void) | null>(null);
  const [meeting, setMeeting] = useState<any>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState('Checking sign-in…');
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, forceRender] = useState(0);

  const attachRemote = useCallback((uid: string) => {
    const el = remoteRefs.current[uid];
    const media = remoteStreams.current[uid];
    if (!el || !media) return;
    if (el.srcObject !== media) el.srcObject = media;
    el.autoplay = true;
    el.playsInline = true;
    void el.play().catch(() => undefined);
  }, []);

  const closePeer = useCallback((uid: string) => {
    const peer = peers.current[uid];
    if (!peer) return;
    try { peer.pc.close(); } catch { /* noop */ }
    delete peers.current[uid];
    remoteStreams.current[uid] = null;
    forceRender((v) => v + 1);
  }, []);

  const sendSignal = useCallback(async (meetingId: string, targetId: string, type: Signal['type'], payload: any, sentAt = Date.now()) => {
    const senderId = firebaseAuth.currentUser?.uid;
    if (!senderId || !targetId || senderId === targetId) return;
    try {
      await addDoc(collection(firestore, `meetings/${meetingId}/signaling/${targetId}/messages`), {
        senderId,
        targetId,
        type,
        payload,
        sessionId: currentSession.current,
        sentAt,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('[WebRTC] signal write failed', { type, targetId, error });
    }
  }, []);

  const currentSession = useRef(sessionId());

  const offer = useCallback(async (meetingId: string, targetId: string, peer: Peer) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || uid >= targetId || peer.offerInFlight || peer.pc.signalingState !== 'stable') return;
    peer.offerInFlight = true;
    try {
      const desc = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(desc);
      const local = peer.pc.localDescription;
      if (!local) throw new Error('Local offer missing');
      await sendSignal(meetingId, targetId, 'offer', { type: local.type, sdp: local.sdp });
      console.info('[WebRTC] offer sent', targetId);
    } catch (error) {
      peer.offerInFlight = false;
      console.error('[WebRTC] offer failed', { targetId, error });
    }
  }, [sendSignal]);

  const createPeer = useCallback(async (meetingId: string, targetId: string) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || !targetId || uid === targetId) return null;
    const existing = peers.current[targetId];
    if (existing && !['closed', 'failed'].includes(existing.pc.connectionState)) return existing;
    if (existing) closePeer(targetId);

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current, bundlePolicy: 'max-bundle', iceCandidatePoolSize: 4 });
    const audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    const videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    const peer: Peer = { pc, audioSender, videoSender, remoteSessionId: '', offerInFlight: false, pendingCandidates: [], iceChangedAt: Date.now() };
    peers.current[targetId] = peer;

    pc.onicecandidate = (event) => { if (event.candidate) void sendSignal(meetingId, targetId, 'candidate', event.candidate.toJSON()); };
    pc.onicecandidateerror = (event) => console.warn('[WebRTC] ICE error', targetId, event.errorCode, event.errorText, event.url);
    pc.oniceconnectionstatechange = () => {
      peer.iceChangedAt = Date.now();
      console.info('[WebRTC] ICE', targetId, pc.iceConnectionState);
      if (['failed', 'disconnected'].includes(pc.iceConnectionState)) {
        peer.offerInFlight = false;
        try { pc.restartIce(); } catch { /* noop */ }
        window.setTimeout(() => void offer(meetingId, targetId, peer), 300);
      }
    };
    pc.onconnectionstatechange = () => {
      console.info('[WebRTC] connection', targetId, pc.connectionState);
      if (pc.connectionState === 'connected') setStatus('Connected');
      if (pc.connectionState === 'failed') {
        peer.offerInFlight = false;
        try { pc.restartIce(); } catch { /* noop */ }
        window.setTimeout(() => void offer(meetingId, targetId, peer), 300);
      }
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
    await videoSender.replaceTrack(screenRef.current?.getVideoTracks()[0] || streamRef.current?.getVideoTracks()[0] || null);
    return peer;
  }, [attachRemote, closePeer, offer, sendSignal]);

  const flushPending = useCallback(async (meetingId: string, senderId: string) => {
    const queue = pendingSignals.current[senderId] || [];
    pendingSignals.current[senderId] = [];
    const peer = peers.current[senderId];
    const remote = remoteSessions.current[senderId];
    if (!peer || !remote) return;
    for (const signal of queue) {
      if (signal.sessionId !== remote.id) continue;
      try {
        if (signal.type === 'offer') {
          if (peer.pc.signalingState !== 'stable') {
            try { await peer.pc.setLocalDescription({ type: 'rollback' }); } catch { /* noop */ }
          }
          if (peer.pc.signalingState !== 'stable') continue;
          await peer.pc.setRemoteDescription(signal.payload);
          for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          const answer = peer.pc.localDescription;
          if (answer) await sendSignal(meetingId, senderId, 'answer', { type: answer.type, sdp: answer.sdp });
        } else if (signal.type === 'candidate') {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.payload);
          else peer.pendingCandidates.push(signal.payload);
        } else if (signal.type === 'answer' && peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription(signal.payload);
          for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
          peer.offerInFlight = false;
        }
      } catch (error) { console.error('[WebRTC] buffered signal failed', error); }
    }
  }, [sendSignal]);

  const handleSignal = useCallback(async (meetingId: string, data: Signal) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || !data.senderId || data.senderId === uid || !data.type) return;
    const sender = data.senderId;

    if (data.type === 'hello') {
      const sentAt = Number(data.sentAt || data.payload?.sentAt || 0);
      const previous = remoteSessions.current[sender];
      if (previous && previous.id === (data.sessionId || '') && sentAt && sentAt <= previous.sentAt) return;
      if (previous && sentAt && sentAt < previous.sentAt) return;
      if (previous && previous.id !== data.sessionId) closePeer(sender);
      remoteSessions.current[sender] = { id: data.sessionId || '', sentAt: sentAt || Date.now() };
      const peer = await createPeer(meetingId, sender);
      if (!peer) return;
      peer.remoteSessionId = data.sessionId || '';
      await sendSignal(meetingId, sender, 'hello', { protocol: 9, sentAt: Date.now() });
      await flushPending(meetingId, sender);
      if (uid < sender) await offer(meetingId, sender, peer);
      return;
    }

    const remote = remoteSessions.current[sender];
    if (!remote || (data.sessionId && data.sessionId !== remote.id)) {
      const queue = pendingSignals.current[sender] || [];
      if (queue.length < 30) queue.push(data);
      pendingSignals.current[sender] = queue;
      return;
    }
    let peer = peers.current[sender];
    if (!peer) peer = (await createPeer(meetingId, sender)) || undefined;
    if (!peer) return;
    peer.remoteSessionId = remote.id;

    try {
      if (data.type === 'offer') {
        if (peer.pc.signalingState !== 'stable') {
          try { await peer.pc.setLocalDescription({ type: 'rollback' }); } catch { /* noop */ }
        }
        if (peer.pc.signalingState !== 'stable') return;
        await peer.pc.setRemoteDescription(data.payload);
        for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        const answer = peer.pc.localDescription;
        if (answer) await sendSignal(meetingId, sender, 'answer', { type: answer.type, sdp: answer.sdp });
      } else if (data.type === 'answer') {
        if (peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription(data.payload);
        for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate);
        peer.offerInFlight = false;
      } else if (data.type === 'candidate') {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.payload);
        else peer.pendingCandidates.push(data.payload);
      }
    } catch (error) { console.error('[WebRTC] signal failed', { sender, type: data.type, error }); }
  }, [closePeer, createPeer, flushPending, offer, sendSignal]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const user = await waitForAuth();
      if (!alive) return;
      if (!user) {
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
        if (joined?.status === 'waiting') { setStatus('Waiting for host approval'); return; }
        try {
          const response = await api.get<any>('/meetings/ice-servers');
          const servers = response.data?.data?.iceServers;
          if (Array.isArray(servers) && servers.length) { iceServersRef.current = servers; }
        } catch (error) { console.warn('[WebRTC] ICE lookup failed', error); }
        setStatus('Starting camera…');
        let media: MediaStream | null = null;
        for (const [wantVideo, wantAudio] of [[true, true], [true, false], [false, true]] as Array<[boolean, boolean]>) {
          try { media = await navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: wantAudio }); break; }
          catch (error) { console.warn('[Media] request failed', wantVideo, wantAudio, error); }
        }
        if (!alive) { media?.getTracks().forEach((track) => track.stop()); return; }
        if (media) {
          streamRef.current = media;
          setStream(media);
          setAudio(Boolean(media.getAudioTracks().length));
          setVideo(Boolean(media.getVideoTracks().length));
        } else { setAudio(false); setVideo(false); }
        setStatus('Connected');
      } catch (error: any) {
        console.error('[Meeting] bootstrap failed', error);
        if (alive) { setStatus('Unable to join'); toast.error(error?.response?.data?.error || error?.message || 'Unable to join meeting'); }
      }
    })();
    return () => { alive = false; };
  }, [code, router]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Waiting for host approval') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    const timer = window.setInterval(async () => {
      try {
        const current = (await api.get<any>(`/meetings/${meeting.id}`)).data?.data;
        if (Array.isArray(current?.participants) && current.participants.includes(uid)) window.location.reload();
      } catch { /* keep waiting */ }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [meeting?.id, status]);

  useEffect(() => {
    if (localVideoRef.current && stream) localVideoRef.current.srcObject = sharing && screenRef.current ? screenRef.current : stream;
  }, [sharing, stream]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Connected') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    let alive = true;
    const incoming = collection(firestore, `meetings/${meeting.id}/signaling/${uid}/messages`);
    signalUnsub.current?.();
    signalUnsub.current = onSnapshot(incoming, (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (!alive || change.type !== 'added') continue;
        void handleSignal(meeting.id, change.doc.data() as Signal);
      }
    }, (error) => console.error('[WebRTC] signaling subscription failed', error));

    const refresh = async () => {
      if (!alive) return;
      try {
        const result = await api.get<any>(`/meetings/${meeting.id}/participants`);
        const list: Participant[] = Array.isArray(result.data?.data) ? result.data.data : [];
        if (!alive) return;
        participantsRef.current = list;
        setParticipants(list);
        const activeIds = new Set(list.filter((p) => p.status === 'active').map((p) => p.uid));
        for (const p of list) {
          if (!p.uid || p.uid === uid || p.status !== 'active') continue;
          const peer = await createPeer(meeting.id, p.uid);
          if (!peer) continue;
          if (uid < p.uid) await offer(meeting.id, p.uid, peer);
          await sendSignal(meeting.id, p.uid, 'hello', { protocol: 9, sentAt: Date.now() });
          attachRemote(p.uid);
        }
        for (const id of Object.keys(peers.current)) if (!activeIds.has(id)) closePeer(id);
      } catch (error) { console.error('[WebRTC] participant refresh failed', error); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    const watchdog = window.setInterval(() => {
      const now = Date.now();
      for (const [id, peer] of Object.entries(peers.current)) {
        if (!['checking', 'disconnected'].includes(peer.pc.iceConnectionState)) continue;
        if (now - peer.iceChangedAt < 8000) continue;
        peer.iceChangedAt = now;
        peer.offerInFlight = false;
        try { peer.pc.restartIce(); } catch { /* noop */ }
        void offer(meeting.id, id, peer);
      }
    }, 2000);
    return () => {
      alive = false;
      signalUnsub.current?.();
      signalUnsub.current = null;
      window.clearInterval(timer);
      window.clearInterval(watchdog);
    };
  }, [attachRemote, closePeer, createPeer, handleSignal, meeting?.id, offer, sendSignal, status]);

  useEffect(() => () => {
    signalUnsub.current?.();
    Object.values(peers.current).forEach((peer) => { try { peer.pc.close(); } catch { /* noop */ } });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const toggleTrack = async (kind: 'audio' | 'video') => {
    try {
      let track = streamRef.current?.getTracks().find((item) => item.kind === kind) || null;
      if (!track) {
        const fresh = await navigator.mediaDevices.getUserMedia({ video: kind === 'video', audio: kind === 'audio' });
        track = fresh.getTracks().find((item) => item.kind === kind) || null;
        fresh.getTracks().filter((item) => item !== track).forEach((item) => item.stop());
        if (!track) throw new Error(`No ${kind} track`);
        if (!streamRef.current) streamRef.current = new MediaStream();
        streamRef.current.addTrack(track);
        setStream(new MediaStream(streamRef.current.getTracks()));
      }
      track.enabled = !track.enabled;
      await Promise.all(Object.values(peers.current).map((peer) => (kind === 'audio' ? peer.audioSender : peer.videoSender).replaceTrack(track!.enabled ? track : null)));
      if (kind === 'audio') setAudio(track.enabled); else setVideo(track.enabled);
    } catch (error) { console.error('[Media] toggle failed', error); toast.error(`${kind === 'audio' ? 'Microphone' : 'Camera'} unavailable.`); }
  };

  const shareScreen = async () => {
    if (sharing) {
      const camera = streamRef.current?.getVideoTracks()[0] || null;
      screenRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current = null;
      await Promise.all(Object.values(peers.current).map((peer) => peer.videoSender.replaceTrack(camera)));
      setSharing(false);
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      if (!track) throw new Error('No screen track');
      screenRef.current = screen;
      await Promise.all(Object.values(peers.current).map((peer) => peer.videoSender.replaceTrack(track)));
      setSharing(true);
      track.onended = () => void shareScreen();
    } catch (error: any) { if (error?.name !== 'AbortError') toast.error(error?.message || 'Unable to share screen'); }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meeting/${encodeURIComponent(code)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { toast.error('Could not copy invite link'); }
  };

  const leave = async () => {
    const uid = firebaseAuth.currentUser?.uid;
    try {
      if (meeting?.id) {
        if (uid && meeting.hostId === uid) await api.post(`/meetings/${meeting.id}/end`, {});
        else await api.delete(`/meetings/${meeting.id}/leave`);
      }
    } catch (error) { console.warn('[Meeting] leave failed', error); }
    router.replace('/dashboard');
  };

  if (status === 'Waiting for host approval') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center"><Shield className="mx-auto text-indigo-400"/><h1 className="mt-3 text-2xl font-semibold">Waiting for approval</h1><p className="mt-2 text-sm text-slate-400">The host will let you in.</p><button onClick={() => void leave()} className="mt-5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950">Leave</button></div></main>;
  if (status !== 'Connected') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400"/><p>{status}</p></div></main>;

  const uid = firebaseAuth.currentUser?.uid;
  const isHost = meeting?.hostId === uid;
  const waiting = participants.filter((p) => p.uid !== uid && p.status === 'waiting');
  const activeParticipants = participants.filter((p) => p.uid !== uid && p.status === 'active');

  return <main className="flex h-screen min-h-0 flex-col bg-slate-950 text-white">
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4"><div><p className="font-semibold">{meeting?.title || 'RTC Meeting'}</p><button onClick={() => void copyInvite()} className="flex items-center gap-1 text-xs text-slate-400">{code}<Copy size={12}/>{copied && 'Copied'}</button></div><div className="flex items-center gap-2 text-xs text-slate-400"><Users size={16}/>{participants.length} participant{participants.length === 1 ? '' : 's'}</div></header>
    {isHost && waiting.length > 0 && <div className="flex items-center justify-between bg-amber-500/10 px-4 py-2 text-sm"><span>{waiting.length} waiting for approval</span><button onClick={() => toast('Open the Participants panel in the full client to approve.')} className="rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-semibold text-slate-950">Review</button></div>}
    <section className="min-h-0 flex-1 overflow-auto p-3 pb-24"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={localVideoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${video || sharing ? '' : 'hidden'}`}/>{!video && !sharing && <div className="absolute inset-0 grid place-items-center text-3xl font-semibold">U</div>}<span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2 py-1 text-xs">You</span>{sharing && <span className="absolute right-3 top-3 rounded-lg bg-emerald-500 px-2 py-1 text-xs">Screen sharing</span>}</div>
      {activeParticipants.map((p) => { const has = !!remoteStreams.current[p.uid]; return <div key={p.uid} className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={(el) => { remoteRefs.current[p.uid] = el; attachRemote(p.uid); }} autoPlay playsInline className="h-full w-full object-cover" onClick={(e) => void e.currentTarget.play().catch(() => undefined)}/>{!has && <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">Connecting media…</div>}<span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2 py-1 text-xs">{p.displayName || 'Participant'}</span></div>; })}
    </div></section>
    <footer className="fixed bottom-0 left-0 right-0 flex h-20 items-center justify-center gap-3 border-t border-white/10 bg-slate-950/95 px-3"><button onClick={() => void toggleTrack('audio')} aria-label="Toggle microphone" className={`grid h-12 w-12 place-items-center rounded-full ${audio ? 'bg-slate-800' : 'bg-red-500'}`}>{audio ? <Mic/> : <MicOff/>}</button><button onClick={() => void toggleTrack('video')} aria-label="Toggle camera" className={`grid h-12 w-12 place-items-center rounded-full ${video ? 'bg-slate-800' : 'bg-red-500'}`}>{video ? <Video/> : <VideoOff/>}</button><button onClick={() => void shareScreen()} aria-label="Share screen" className={`grid h-12 w-12 place-items-center rounded-full ${sharing ? 'bg-indigo-500' : 'bg-slate-800'}`}><MonitorUp/></button><button onClick={() => void copyInvite()} aria-label="Copy invite" className="grid h-12 w-12 place-items-center rounded-full bg-slate-800"><Share2/></button><button onClick={() => void leave()} aria-label={isHost ? 'End meeting' : 'Leave meeting'} className="grid h-12 w-14 place-items-center rounded-full bg-red-500"><PhoneOff/></button></footer>
  </main>;
}
