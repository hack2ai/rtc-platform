'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  makingOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
  remoteStream: MediaStream | null;
  offerStarted: boolean;
};

const fallbackIce: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

function normalizeCode(input: string) {
  const value = input.trim();
  try {
    const url = new URL(value);
    const marker = '/meeting/';
    const index = url.pathname.indexOf(marker);
    return decodeURIComponent(index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname.replace(/^\/+/, ''))
      .split(/[?#]/)[0]
      .replace(/^\/|\/$/g, '');
  } catch {
    const marker = '/meeting/';
    const index = value.indexOf(marker);
    return decodeURIComponent(index >= 0 ? value.slice(index + marker.length) : value)
      .split(/[?#]/)[0]
      .replace(/^\/|\/$/g, '');
  }
}

const shareBase = () => (typeof window === 'undefined' ? '' : window.location.origin.replace(/\/$/, ''));

export default function MeetingRoom() {
  const params = useParams<{ code: string }>();
  const code = normalizeCode(String(params.code || ''));
  const router = useRouter();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const remoteStreams = useRef<Record<string, MediaStream | null>>({});
  const peers = useRef<Record<string, PeerState>>({});
  const sentHello = useRef<Record<string, boolean>>({});
  const streamRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const signalUnsub = useRef<(() => void) | null>(null);
  const participantTimer = useRef<number | null>(null);
  const participantRequestActive = useRef(false);

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
  const [status, setStatus] = useState('Connecting…');
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
    void element.play().catch(async () => {
      // Some mobile browsers block autoplay with audio. Muted autoplay still
      // renders the remote video; the user can tap the tile to enable sound.
      element.muted = true;
      try { await element.play(); } catch { /* user gesture may still be required */ }
    });
  }, []);

  const signalPath = useCallback((meetingId: string, targetId: string) =>
    collection(firestore, `meetings/${meetingId}/signaling/${targetId}/messages`), []);

  const sendSignal = useCallback(async (
    meetingId: string,
    targetId: string,
    type: SignalType,
    payload: unknown,
  ) => {
    const senderId = firebaseAuth.currentUser?.uid;
    if (!senderId || !targetId || senderId === targetId) return;
    try {
      await addDoc(signalPath(meetingId, targetId), {
        senderId,
        targetId,
        type,
        payload,
        createdAt: serverTimestamp(),
      });
      console.info('[WebRTC] signaling sent', { type, targetId });
    } catch (error) {
      console.error('[WebRTC] signaling write failed', { type, targetId, error });
    }
  }, [signalPath]);

  const startOffer = useCallback(async (meetingId: string, targetId: string, state: PeerState) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || uid > targetId || state.offerStarted || state.pc.signalingState !== 'stable') return;
    state.offerStarted = true;
    state.makingOffer = true;
    try {
      const offer = await state.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await state.pc.setLocalDescription(offer);
      const local = state.pc.localDescription;
      if (!local) throw new Error('Offer description missing');
      await sendSignal(meetingId, targetId, 'offer', { type: local.type, sdp: local.sdp });
      console.info('[WebRTC] offer sent', { targetId });
    } catch (error) {
      state.offerStarted = false;
      console.error('[WebRTC] offer failed', { targetId, error });
    } finally {
      state.makingOffer = false;
    }
  }, [sendSignal]);

  const createPeer = useCallback(async (meetingId: string, targetId: string) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || !targetId || uid === targetId) return null;

    const existing = peers.current[targetId];
    if (existing && !['closed', 'failed'].includes(existing.pc.connectionState)) {
      if (uid < targetId) void startOffer(meetingId, targetId, existing);
      attachRemoteStream(targetId);
      return existing;
    }
    if (existing) {
      try { existing.pc.close(); } catch { /* already closed */ }
      delete peers.current[targetId];
    }

    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', iceCandidatePoolSize: 4 });
    const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    const state: PeerState = {
      pc,
      polite: uid > targetId,
      makingOffer: false,
      pendingCandidates: [],
      audioSender: audioTransceiver.sender,
      videoSender: videoTransceiver.sender,
      remoteStream: null,
      offerStarted: false,
    };
    peers.current[targetId] = state;
    console.info('[WebRTC] peer created', { targetId, polite: state.polite });

    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal(meetingId, targetId, 'candidate', event.candidate.toJSON());
    };
    pc.onicecandidateerror = (event) => {
      console.warn('[WebRTC] ICE candidate error', {
        targetId,
        url: event.url,
        code: event.errorCode,
        text: event.errorText,
      });
    };
    pc.oniceconnectionstatechange = () => {
      console.info('[WebRTC] ICE state', { targetId, state: pc.iceConnectionState });
    };
    pc.onconnectionstatechange = () => {
      console.info('[WebRTC] connection state', { targetId, state: pc.connectionState });
      if (pc.connectionState === 'connected') setStatus('Connected');
      if (pc.connectionState === 'failed') {
        console.error('[WebRTC] connection failed', { targetId });
        try { pc.restartIce(); } catch { /* browser may not support restart */ }
      }
      if (pc.connectionState === 'closed') {
        delete peers.current[targetId];
        remoteStreams.current[targetId] = null;
        forceRemoteRender((v) => v + 1);
      }
    };
    pc.ontrack = (event) => {
      let remote = event.streams[0] || state.remoteStream;
      if (!remote) remote = new MediaStream();
      if (!remote.getTracks().some((track) => track.id === event.track.id)) remote.addTrack(event.track);
      state.remoteStream = remote;
      remoteStreams.current[targetId] = remote;
      console.info('[WebRTC] remote track received', {
        targetId,
        kind: event.track.kind,
        tracks: remote.getTracks().map((track) => ({ id: track.id, kind: track.kind, readyState: track.readyState })),
      });
      forceRemoteRender((v) => v + 1);
      window.setTimeout(() => attachRemoteStream(targetId), 0);
    };

    const local = streamRef.current;
    if (local) {
      await state.audioSender.replaceTrack(local.getAudioTracks()[0] ?? null);
      await state.videoSender.replaceTrack(local.getVideoTracks()[0] ?? null);
    }
    if (uid < targetId) await startOffer(meetingId, targetId, state);
    return state;
  }, [attachRemoteStream, iceServers, sendSignal, startOffer]);

  const requestMedia = useCallback(async (wantVideo: boolean, wantAudio: boolean) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Media devices are unavailable.', 'NotSupportedError');
    return navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: wantAudio });
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!code) return;
      if (!firebaseAuth.currentUser) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      try {
        console.info('[WebRTC] bootstrap start', { code, uid: firebaseAuth.currentUser.uid });
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
        } catch (error) {
          console.warn('[WebRTC] using fallback STUN', error);
        }
        let media: MediaStream | null = null;
        for (const [wantVideo, wantAudio] of [[true, true], [true, false], [false, true]] as Array<[boolean, boolean]>) {
          try {
            media = await requestMedia(wantVideo, wantAudio);
            break;
          } catch (error) {
            console.warn('[WebRTC] getUserMedia failed', { wantVideo, wantAudio, error });
          }
        }
        if (!alive) return;
        if (media) {
          streamRef.current = media;
          setStream(media);
          setAudio(media.getAudioTracks().some((track) => track.enabled));
          setVideo(media.getVideoTracks().some((track) => track.enabled));
        } else {
          setAudio(false);
          setVideo(false);
          toast.error('Camera/microphone unavailable.');
        }
        setStatus('Connected');
        console.info('[WebRTC] bootstrap complete', { meetingId: meta.id, uid: firebaseAuth.currentUser?.uid });
      } catch (error: any) {
        console.error('[WebRTC] bootstrap failed', error);
        if (alive) {
          setStatus('Unable to join');
          toast.error(error?.response?.data?.error || error?.message || 'Unable to join meeting');
        }
      }
    })();
    return () => { alive = false; };
  }, [acquireInitialMedia, code, requestMedia, router]);

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
        if (!senderId || senderId === uid || !data.type) continue;
        console.info('[WebRTC] signaling received', { type: data.type, senderId });
        const state = await createPeer(meeting.id, senderId);
        if (!state) continue;
        const { pc } = state;
        try {
          if (data.type === 'hello') {
            continue;
          }
          if (data.type === 'offer') {
            if (state.polite && pc.signalingState !== 'stable') {
              await pc.setLocalDescription({ type: 'rollback' });
            }
            if (pc.signalingState !== 'stable') continue;
            await pc.setRemoteDescription(data.payload);
            for (const candidate of state.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
            await pc.setLocalDescription(await pc.createAnswer());
            const answer = pc.localDescription;
            if (!answer) throw new Error('Answer description missing');
            await sendSignal(meeting.id, senderId, 'answer', { type: answer.type, sdp: answer.sdp });
            console.info('[WebRTC] answer sent', { targetId: senderId });
          } else if (data.type === 'answer') {
            if (pc.signalingState !== 'have-local-offer') {
              console.warn('[WebRTC] ignoring answer in state', { targetId: senderId, signalingState: pc.signalingState });
              continue;
            }
            await pc.setRemoteDescription(data.payload);
            for (const candidate of state.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
            console.info('[WebRTC] answer applied', { targetId: senderId });
          } else if (data.type === 'candidate' && data.payload) {
            if (pc.remoteDescription) await pc.addIceCandidate(data.payload);
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
        for (const participant of list) {
          if (!participant.uid || participant.uid === uid || participant.status === 'waiting') continue;
          await createPeer(meeting.id, participant.uid);
          attachRemoteStream(participant.uid);
          if (!sentHello.current[participant.uid]) {
            sentHello.current[participant.uid] = true;
            await sendSignal(meeting.id, participant.uid, 'hello', { protocol: 3 });
          }
        }
        const activeIds = new Set(list.filter((p) => p.status !== 'waiting').map((p) => p.uid));
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
    participantTimer.current = window.setInterval(refresh, 2000);
    return () => {
      active = false;
      if (participantTimer.current) window.clearInterval(participantTimer.current);
      participantTimer.current = null;
      signalUnsub.current?.();
      signalUnsub.current = null;
    };
  }, [attachRemoteStream, createPeer, meeting?.id, sendSignal, status]);

  useEffect(() => () => {
    signalUnsub.current?.();
    Object.values(peers.current).forEach((state) => state.pc.close());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const setOutgoingTrack = async (kind: 'audio' | 'video', track: MediaStreamTrack | null) => {
    await Promise.all(Object.values(peers.current).map((state) => {
      const sender = kind === 'audio' ? state.audioSender : state.videoSender;
      return sender.replaceTrack(track);
    }));
  };

  const toggle = async (kind: 'audio' | 'video') => {
    try {
      let track = streamRef.current?.getTracks().find((item) => item.kind === kind) || null;
      if (!track) {
        const requested = await requestMedia(kind === 'video', kind === 'audio');
        track = requested.getTracks().find((item) => item.kind === kind) || null;
        if (!track) throw new Error(`No ${kind} track available`);
        if (!streamRef.current) streamRef.current = new MediaStream();
        streamRef.current.addTrack(track);
        requested.getTracks().filter((item) => item !== track).forEach((item) => item.stop());
        setStream(new MediaStream(streamRef.current.getTracks()));
      }
      track.enabled = !track.enabled;
      await setOutgoingTrack(kind, track.enabled ? track : null);
      if (kind === 'audio') setAudio(track.enabled); else setVideo(track.enabled);
    } catch (error: any) {
      console.error('[Media] toggle failed', error);
      toast.error(`${kind === 'audio' ? 'Microphone' : 'Camera'} unavailable.`);
    }
  };

  const stopScreenShare = async () => {
    const camera = streamRef.current?.getVideoTracks()[0] ?? null;
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    await setOutgoingTrack('video', camera);
    if (localVideoRef.current && streamRef.current) localVideoRef.current.srcObject = streamRef.current;
    setSharing(false);
  };

  const shareScreen = async () => {
    if (sharing) return stopScreenShare();
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported.');
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      if (!track) throw new Error('No screen track returned.');
      screenRef.current = screen;
      await setOutgoingTrack('video', track);
      if (localVideoRef.current) localVideoRef.current.srcObject = screen;
      setSharing(true);
      track.onended = () => { void stopScreenShare(); };
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('[WebRTC] screen share failed', error);
        toast.error(error?.message || 'Unable to share screen');
      }
    }
  };

  const copyInvite = async () => {
    const invite = `${shareBase()}/meeting/${encodeURIComponent(code)}`;
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ title: meeting?.title || 'RTC Meeting', text: 'Join my RTC meeting', url: invite });
      } else {
        await navigator.clipboard.writeText(invite);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
        toast.success('Invite link copied');
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') toast.error('Could not share meeting link');
    }
  };

  const sendMessage = async () => {
    const content = messageText.trim();
    if (!content || !meeting?.id) return;
    setMessageText('');
    try {
      await api.post(`/chat/meetings/${meeting.id}/messages`, { content, type: 'text' });
      const response = await api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 });
      setMessages(Array.isArray(response.data?.data?.messages) ? response.data.data.messages : []);
    } catch (error: any) {
      setMessageText(content);
      toast.error(error?.response?.data?.error || 'Unable to send message');
    }
  };

  const leave = async () => {
    try { if (meeting?.id) await api.delete(`/meetings/${meeting.id}/leave`); } catch (error) { console.warn('[Meeting] leave failed', error); }
    Object.values(peers.current).forEach((state) => state.pc.close());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
    router.replace('/dashboard');
  };

  if (status === 'Connecting…') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400"/><p>Connecting…</p></div></main>;
  if (status === 'Waiting for host approval') return <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white"><div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center"><Shield className="mx-auto text-indigo-400" size={34}/><h1 className="mt-4 text-2xl font-semibold">Waiting for approval</h1><p className="mt-2 text-sm text-slate-400">The host needs to approve your entry.</p><button type="button" onClick={leave} className="mt-6 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">Leave</button></div></main>;
  if (status !== 'Connected') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><h1 className="text-xl font-semibold">Unable to join meeting</h1><button type="button" onClick={() => router.replace('/dashboard')} className="mt-4 rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold">Back to dashboard</button></div></main>;

  const uid = firebaseAuth.currentUser?.uid;
  return <main className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 text-white">
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4"><div className="min-w-0"><p className="truncate font-semibold">{meeting?.title || 'RTC Meeting'}</p><button type="button" onClick={() => void copyInvite()} className="flex items-center gap-1 text-xs text-slate-400"><span>{code}</span><Copy size={12}/>{copied && ' Copied'}</button></div><div className="flex items-center gap-2 text-xs text-slate-400"><Shield size={15}/>{participants.length} participants</div></header>
    <section className="min-h-0 flex-1 overflow-auto p-3 pb-24 sm:p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={localVideoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${video || sharing ? '' : 'hidden'}`}/>{!video && !sharing && <div className="absolute inset-0 grid place-items-center text-2xl font-semibold">U</div>}<span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">You</span>{sharing && <span className="absolute right-3 top-3 rounded-lg bg-emerald-500 px-2 py-1 text-xs font-medium">Screen sharing</span>}</div>
      {participants.map((participant) => {
        if (!participant.uid || participant.uid === uid || participant.status === 'waiting') return null;
        const hasStream = !!remoteStreams.current[participant.uid];
        return <div key={participant.uid} className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={(element) => { remoteRefs.current[participant.uid] = element; if (element) attachRemoteStream(participant.uid); }} autoPlay playsInline className="h-full w-full object-cover" onClick={(event) => { const element = event.currentTarget; element.muted = !element.muted; void element.play().catch(() => undefined); }}/>{!hasStream && <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">Connecting media…</div>}<span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">{participant.displayName || 'Participant'}</span></div>;
      })}
    </div></section>
    {(chat || people) && <aside className="absolute inset-y-16 right-0 z-50 flex w-[min(90vw,24rem)] flex-col border-l border-white/10 bg-slate-900 shadow-2xl"><div className="flex items-center justify-between border-b border-white/10 p-4"><h2 className="font-semibold">{chat ? 'Chat' : 'Participants'}</h2><button type="button" onClick={() => { setChat(false); setPeople(false); }}><X size={18}/></button></div>{chat ? <><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{messages.length ? messages.map((m) => <div key={m.id}><p className="text-xs text-slate-500">{m.senderName || 'Participant'}</p><p className="rounded-xl bg-white/5 px-3 py-2 text-sm">{m.deletedAt ? '[Message deleted]' : m.content}</p></div>) : <p className="text-center text-sm text-slate-500">No messages yet.</p>}</div><div className="border-t border-white/10 p-3"><div className="flex gap-2"><input value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void sendMessage()} className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm outline-none" placeholder="Type a message…"/><button type="button" onClick={() => void sendMessage()} className="rounded-xl bg-indigo-500 px-3"><Send size={16}/></button></div></div></> : <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{participants.map((p) => <div key={p.uid} className="rounded-xl bg-white/5 p-3"><p className="text-sm">{p.displayName || 'User'}</p><p className="text-xs text-slate-500">{p.role === 'host' ? 'Host' : p.status || 'Participant'}</p></div>)}</div>}</aside>}
    <footer className="absolute bottom-0 left-0 right-0 z-40 flex min-h-20 items-center justify-center gap-2 border-t border-white/10 bg-slate-950/95 px-2 py-3 backdrop-blur"><button type="button" onClick={() => void toggle('audio')} aria-label={audio ? 'Mute microphone' : 'Unmute microphone'} className={`grid h-12 w-12 place-items-center rounded-full ${audio ? 'bg-slate-800' : 'bg-red-500'}`}>{audio ? <Mic/> : <MicOff/>}</button><button type="button" onClick={() => void toggle('video')} aria-label={video ? 'Turn camera off' : 'Turn camera on'} className={`grid h-12 w-12 place-items-center rounded-full ${video ? 'bg-slate-800' : 'bg-red-500'}`}>{video ? <Video/> : <VideoOff/>}</button><button type="button" onClick={() => void shareScreen()} aria-label={sharing ? 'Stop sharing' : 'Share screen'} className={`grid h-12 w-12 place-items-center rounded-full ${sharing ? 'bg-indigo-500' : 'bg-slate-800'}`}><MonitorUp/></button><button type="button" onClick={() => void copyInvite()} aria-label="Share meeting link" className="grid h-12 w-12 place-items-center rounded-full bg-slate-800"><Share2/></button><button type="button" onClick={() => { setPeople(false); setChat((v) => !v); }} aria-label="Chat" className={`grid h-12 w-12 place-items-center rounded-full ${chat ? 'bg-indigo-500' : 'bg-slate-800'}`}><MessageSquare/></button><button type="button" onClick={() => { setChat(false); setPeople((v) => !v); }} aria-label="Participants" className={`grid h-12 w-12 place-items-center rounded-full ${people ? 'bg-indigo-500' : 'bg-slate-800'}`}><Users/></button><button type="button" onClick={() => void leave()} aria-label="Leave meeting" className="grid h-12 w-14 place-items-center rounded-full bg-red-500"><PhoneOff/></button></footer>
  </main>;
}
