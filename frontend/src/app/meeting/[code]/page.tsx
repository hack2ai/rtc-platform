'use client';

import { useEffect, useRef, useState } from 'react';
import { addDoc, collection, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';
import { useParams, useRouter } from 'next/navigation';
import { Mic, MicOff, Video, VideoOff, MonitorUp, MessageSquare, PhoneOff, Users, Shield, Copy, Send, X, Share2 } from 'lucide-react';
import { api } from '../../../config/api';
import { firebaseAuth, firestore } from '../../../config/firebase';
import toast from 'react-hot-toast';

type Message = { id: string; senderId: string; senderName?: string; content: string; deletedAt?: any };
type Participant = { uid: string; displayName?: string; role?: string; status?: string };
type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
};

const fallbackIce: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const getShareBase = () => typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '';

const normalizeCode = (input: string) => {
  const value = input.trim();
  try {
    const url = new URL(value);
    const marker = '/meeting/';
    const index = url.pathname.indexOf(marker);
    return decodeURIComponent(index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname.replace(/^\/+/, '')).split(/[?#]/)[0].replace(/^\/|\/$/g, '');
  } catch {
    const marker = '/meeting/';
    const index = value.indexOf(marker);
    return decodeURIComponent(index >= 0 ? value.slice(index + marker.length) : value).split(/[?#]/)[0].replace(/^\/|\/$/g, '');
  }
};

export default function MeetingRoom() {
  const params = useParams<{ code: string }>();
  const code = normalizeCode(String(params.code || ''));
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const peers = useRef<Record<string, PeerState>>({});
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const signalUnsub = useRef<(() => void) | null>(null);
  const participantsRequestActive = useRef(false);
  const chatRequestActive = useRef(false);

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

  const sendSignal = async (meetingId: string, targetId: string, type: string, payload: unknown) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || uid === targetId) return;
    await addDoc(collection(firestore, `meetings/${meetingId}/signaling`), { senderId: uid, targetId, type, payload, createdAt: serverTimestamp() });
  };

  const createPeer = async (meetingId: string, targetId: string) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || !targetId || uid === targetId) return null;
    const existing = peers.current[targetId];
    if (existing && existing.pc.connectionState !== 'closed') return existing.pc;

    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', iceCandidatePoolSize: 10 });
    const state: PeerState = { pc, polite: uid > targetId, makingOffer: false, ignoreOffer: false, pendingCandidates: [] };
    peers.current[targetId] = state;

    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal(meetingId, targetId, 'candidate', event.candidate.toJSON());
    };
    pc.ontrack = (event) => {
      const element = remoteRefs.current[targetId];
      if (element && event.streams[0]) element.srcObject = event.streams[0];
    };
    pc.onnegotiationneeded = async () => {
      if (pc.signalingState !== 'stable' || state.makingOffer) return;
      try {
        state.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) await sendSignal(meetingId, targetId, 'offer', pc.localDescription);
      } catch (error) {
        console.warn('Negotiation failed', error);
      } finally {
        state.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        pc.close();
        delete peers.current[targetId];
      }
    };

    streamRef.current?.getTracks().forEach((track) => pc.addTrack(track, streamRef.current!));
    return pc;
  };

  const requestMedia = async (wantVideo: boolean, wantAudio: boolean) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException('Camera and microphone are not available in this browser.', 'NotSupportedError');
    }
    return navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: wantAudio });
  };

  const acquireInitialMedia = async () => {
    let media: MediaStream | null = null;
    try { media = await requestMedia(true, true); } catch {}
    if (!media) {
      try { media = await requestMedia(true, false); } catch {}
    }
    if (!media) {
      try { media = await requestMedia(false, true); } catch {}
    }
    return media;
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!code) { setStatus('Unable to join'); toast.error('Invalid meeting link'); return; }
      if (!firebaseAuth.currentUser) {
        router.replace('/login?next=' + encodeURIComponent(window.location.pathname));
        return;
      }
      try {
        const meta = (await api.get<any>(`/meetings/code/${encodeURIComponent(code)}`)).data?.data;
        if (!meta?.id) throw new Error('Meeting not found');
        const joined = (await api.post<any>(`/meetings/${meta.id}/join`, {})).data?.data;
        if (!mounted) return;
        setMeeting({ ...meta, ...joined?.meeting });
        if (joined?.status === 'waiting') { setStatus('Waiting for host approval'); return; }

        try {
          const ice = (await api.get<any>('/meetings/ice-servers')).data?.data?.iceServers;
          if (Array.isArray(ice) && ice.length) setIceServers(ice);
        } catch {}

        const media = await acquireInitialMedia();
        if (!mounted) return;
        if (media) {
          streamRef.current = media;
          setStream(media);
          setAudio(media.getAudioTracks().some((track) => track.enabled));
          setVideo(media.getVideoTracks().some((track) => track.enabled));
        } else {
          setAudio(false);
          setVideo(false);
          toast.error('Camera/microphone unavailable. You can still use chat and screen sharing.');
        }
        setStatus('Connected');
      } catch (error: any) {
        if (mounted) { setStatus('Unable to join'); toast.error(error?.response?.data?.error || error?.message || 'Unable to join meeting'); }
      }
    })();
    return () => { mounted = false; };
  }, [code, router]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Waiting for host approval') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    let active = true;
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const result = await api.get<any>(`/meetings/${meeting.id}`);
        const current = result.data?.data;
        if (active && Array.isArray(current?.participants) && current.participants.includes(uid)) window.location.reload();
      } catch {}
    };
    void check();
    const timer = window.setInterval(check, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [meeting?.id, status]);

  useEffect(() => {
    if (videoRef.current && stream && !sharing) videoRef.current.srcObject = stream;
  }, [stream, sharing]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Connected') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    let active = true;
    const q = query(collection(firestore, `meetings/${meeting.id}/signaling`), where('targetId', '==', uid));
    signalUnsub.current?.();
    signalUnsub.current = onSnapshot(q, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (!active || change.type !== 'added') continue;
        const data = change.doc.data() as any;
        const pc = await createPeer(meeting.id, data.senderId);
        const state = peers.current[data.senderId];
        if (!pc || !state) continue;
        try {
          if (data.type === 'offer') {
            const offerCollision = state.makingOffer || pc.signalingState !== 'stable';
            state.ignoreOffer = !state.polite && offerCollision;
            if (state.ignoreOffer) continue;
            if (offerCollision) await pc.setLocalDescription({ type: 'rollback' });
            await pc.setRemoteDescription(data.payload);
            for (const candidate of state.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
            await pc.setLocalDescription();
            if (pc.localDescription) await sendSignal(meeting.id, data.senderId, 'answer', pc.localDescription);
          } else if (data.type === 'answer') {
            await pc.setRemoteDescription(data.payload);
            for (const candidate of state.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
          } else if (data.type === 'candidate' && data.payload) {
            if (pc.remoteDescription) await pc.addIceCandidate(data.payload);
            else state.pendingCandidates.push(data.payload);
          }
        } catch (error) {
          if (!(state.ignoreOffer && data.type === 'candidate')) console.warn('WebRTC signaling error', error);
        }
      }
    }, (error) => console.warn('Signaling subscription failed', error));

    const refresh = async () => {
      if (!active || participantsRequestActive.current || document.visibilityState === 'hidden') return;
      participantsRequestActive.current = true;
      try {
        const result = await api.get<any>(`/meetings/${meeting.id}/participants`);
        const list: Participant[] = Array.isArray(result.data?.data) ? result.data.data : [];
        if (!active) return;
        setParticipants(list);
        for (const participant of list) {
          if (participant.uid && participant.uid !== uid && participant.status !== 'waiting') await createPeer(meeting.id, participant.uid);
        }
        for (const [id, state] of Object.entries(peers.current)) {
          if (!list.some((p) => p.uid === id && p.status !== 'waiting')) { state.pc.close(); delete peers.current[id]; }
        }
      } catch {}
      finally { participantsRequestActive.current = false; }
    };

    void refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
      signalUnsub.current?.();
      signalUnsub.current = null;
    };
  }, [meeting?.id, status, iceServers]);

  useEffect(() => {
    if (!meeting?.id || !chat) return;
    let active = true;
    const load = async () => {
      if (chatRequestActive.current || document.visibilityState === 'hidden') return;
      chatRequestActive.current = true;
      try {
        const r = await api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 });
        if (active) setMessages(Array.isArray(r.data?.data?.messages) ? r.data.data.messages : []);
      } catch {}
      finally { chatRequestActive.current = false; }
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [meeting?.id, chat]);

  useEffect(() => () => {
    Object.values(peers.current).forEach(({ pc }) => pc.close());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const ensureTrack = async (kind: 'audio' | 'video') => {
    const existing = streamRef.current?.getTracks().find((track) => track.kind === kind);
    if (existing) { existing.enabled = true; return existing; }
    const requested = await requestMedia(kind === 'video', kind === 'audio');
    const track = requested.getTracks().find((item) => item.kind === kind);
    if (!track) { requested.getTracks().forEach((item) => item.stop()); throw new Error(`No ${kind} track available`); }
    if (!streamRef.current) {
      streamRef.current = requested;
      setStream(requested);
    } else {
      streamRef.current.addTrack(track);
      requested.getTracks().filter((item) => item !== track).forEach((item) => item.stop());
    }
    for (const { pc } of Object.values(peers.current)) {
      const sender = pc.getSenders().find((item) => item.track?.kind === kind);
      if (sender) await sender.replaceTrack(track);
      else pc.addTrack(track, streamRef.current!);
    }
    return track;
  };

  const toggle = async (kind: 'audio' | 'video') => {
    try {
      const track = streamRef.current?.getTracks().find((item) => item.kind === kind);
      if (!track) {
        await ensureTrack(kind);
        kind === 'audio' ? setAudio(true) : setVideo(true);
        return;
      }
      track.enabled = !track.enabled;
      kind === 'audio' ? setAudio(track.enabled) : setVideo(track.enabled);
    } catch (error: any) {
      console.error('Media toggle error', error);
      toast.error(`${kind === 'audio' ? 'Microphone' : 'Camera'} unavailable (${error?.name || 'error'}). Check browser permissions.`);
    }
  };

  const copy = async () => {
    try {
      const invite = `${getShareBase()}/meeting/${encodeURIComponent(code)}`;
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) await navigator.share({ title: meeting?.title || 'RTC Meeting', text: 'Join my RTC meeting', url: invite });
      else { await navigator.clipboard.writeText(invite); setCopied(true); window.setTimeout(() => setCopied(false), 1500); toast.success('Invite link copied'); }
    } catch (error: any) {
      if (error?.name !== 'AbortError') toast.error('Could not share meeting link');
    }
  };

  const moveParticipant = async (userId: string, approve: boolean) => {
    if (!meeting?.id) return;
    try {
      await api.post(`/meetings/${meeting.id}/${approve ? 'approve' : 'deny'}/${encodeURIComponent(userId)}`, {});
      setParticipants((current) => approve ? current.map((p) => p.uid === userId ? { ...p, status: 'active' } : p) : current.filter((p) => p.uid !== userId));
      toast.success(approve ? 'Participant approved' : 'Participant denied');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || `Unable to ${approve ? 'approve' : 'deny'} participant`);
    }
  };

  const share = async () => {
    if (sharing) {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      const camera = streamRef.current?.getVideoTracks()[0];
      for (const { pc } of Object.values(peers.current)) {
        const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
        if (sender && camera) await sender.replaceTrack(camera);
      }
      if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
      setSharing(false);
      return;
    }
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported in this browser.');
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = screen;
      const track = screen.getVideoTracks()[0];
      for (const { pc } of Object.values(peers.current)) {
        const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
        if (sender) await sender.replaceTrack(track);
      }
      if (videoRef.current) videoRef.current.srcObject = screen;
      setSharing(true);
      track.onended = () => { void share(); };
    } catch (error: any) {
      setSharing(false);
      if (error?.name !== 'AbortError') toast.error(error?.message || 'Unable to share screen');
    }
  };

  const sendMessage = async () => {
    const content = messageText.trim();
    if (!content || !meeting?.id) return;
    setMessageText('');
    try {
      await api.post(`/chat/meetings/${meeting.id}/messages`, { content, type: 'text' });
      const r = await api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 });
      setMessages(Array.isArray(r.data?.data?.messages) ? r.data.data.messages : []);
    } catch (error: any) {
      setMessageText(content);
      toast.error(error?.response?.data?.error || 'Unable to send message');
    }
  };

  const leave = async () => {
    if (meeting?.id) { try { await api.delete(`/meetings/${meeting.id}/leave`); } catch {} }
    Object.values(peers.current).forEach(({ pc }) => pc.close());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    router.replace('/dashboard');
  };

  if (status === 'Connecting…') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400"/><p>{status}</p></div></main>;
  if (status === 'Waiting for host approval') return <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center"><Shield className="mx-auto text-indigo-400" size={32}/><h1 className="mt-4 text-2xl font-semibold">Waiting for approval</h1><p className="mt-2 text-sm text-slate-400">The host has been notified. Keep this tab open while you wait.</p><button type="button" onClick={leave} className="mt-6 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">Leave waiting room</button></div></main>;
  if (status !== 'Connected') return <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white"><div className="text-center"><h1 className="text-xl font-semibold">Unable to join meeting</h1><p className="mt-2 text-sm text-slate-400">Check the meeting code, your network connection, and authentication.</p><button type="button" onClick={() => router.replace('/dashboard')} className="mt-4 rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold">Back to dashboard</button></div></main>;

  const uid = firebaseAuth.currentUser?.uid;
  const isHost = meeting?.hostId === uid;
  const waitingParticipants = participants.filter((p) => p.status === 'waiting' && p.uid !== uid);

  return <main className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 text-white">
    <header className="relative z-50 flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4 sm:px-5">
      <div className="min-w-0"><p className="truncate font-semibold">{meeting?.title || 'RTC Meeting'}</p><button type="button" onClick={copy} className="mt-0.5 flex items-center gap-1 text-xs text-slate-400 hover:text-white" aria-label="Copy invite link"><span>{code}</span><Copy size={12}/>{copied && ' Copied'}</button></div>
      <div className="flex items-center gap-3 text-slate-400"><Shield size={16}/><span className="text-xs">{participants.length} participant{participants.length === 1 ? '' : 's'}</span></div>
    </header>

    {isHost && waitingParticipants.length > 0 && <div className="relative z-40 flex shrink-0 items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm"><div className="min-w-0"><p className="font-medium text-amber-200">{waitingParticipants.length} participant{waitingParticipants.length === 1 ? '' : 's'} waiting for approval</p><p className="truncate text-xs text-amber-100/70">{waitingParticipants.map((p) => p.displayName || 'Participant').join(', ')}</p></div><button type="button" onClick={() => { setChat(false); setPeople(true); }} className="shrink-0 rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950">Review</button></div>}

    <section className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
      <div className="relative min-w-0 flex-1 overflow-auto p-3 pb-24 sm:p-4 sm:pb-24"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${video || sharing ? '' : 'hidden'}`}/>{!video && !sharing && <div className="absolute inset-0 grid place-items-center"><div className="grid h-20 w-20 place-items-center rounded-full bg-slate-800 text-2xl font-semibold">U</div></div>}<span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">You</span>{sharing && <span className="absolute right-3 top-3 rounded-lg bg-emerald-500/90 px-2.5 py-1 text-xs font-medium">Screen sharing</span>}</div>
        {participants.map((p) => { if (!p.uid || p.uid === uid || p.status === 'waiting') return null; return <div key={p.uid} className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={(el) => { remoteRefs.current[p.uid] = el; }} autoPlay playsInline className="h-full w-full object-cover"/><span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">{p.displayName || 'Participant'}</span></div>; })}
      </div></div>

      {(chat || people) && <><button type="button" aria-label="Close panel" onClick={() => { setChat(false); setPeople(false); }} className="absolute inset-0 z-[60] bg-black/40 md:hidden"/><aside className="absolute inset-y-0 right-0 z-[70] flex w-[min(90vw,24rem)] flex-col border-l border-white/10 bg-slate-900 shadow-2xl md:relative md:z-20 md:w-80 md:shadow-none">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4"><h2 className="font-semibold">{chat ? 'Chat' : 'Participants'}</h2><button type="button" onClick={() => { setChat(false); setPeople(false); }} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10"><X size={18}/></button></div>
        {chat ? <><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{messages.length ? messages.map((m) => <div key={m.id}><p className="text-xs text-slate-500">{m.senderName || 'Participant'}</p><p className="mt-1 break-words rounded-xl bg-white/5 px-3 py-2 text-sm">{m.deletedAt ? '[Message deleted]' : m.content}</p></div>) : <p className="mt-8 text-center text-sm text-slate-500">No messages yet.</p>}</div><div className="shrink-0 border-t border-white/10 bg-slate-900 p-3 pb-4"><div className="flex gap-2"><input value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void sendMessage()} className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Type a message…"/><button type="button" onClick={() => void sendMessage()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500" aria-label="Send message"><Send size={16}/></button></div></div></>
        : <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{participants.length === 0 && <p className="text-sm text-slate-500">No participants found.</p>}{participants.map((p) => <div key={p.uid} className="rounded-xl bg-white/5 p-3"><div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-500/30 text-sm font-semibold">{(p.displayName || 'U').charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm">{p.displayName || 'User'}</p><p className="text-xs text-slate-500">{p.role === 'host' ? 'Host' : p.status === 'waiting' ? 'Waiting for approval' : p.status === 'active' ? 'Participant' : p.status}</p></div></div>{isHost && p.role !== 'host' && p.status === 'waiting' && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void moveParticipant(p.uid, true)} className="min-h-10 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 active:scale-[0.98]">Approve</button><button type="button" onClick={() => void moveParticipant(p.uid, false)} className="min-h-10 rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-400 active:scale-[0.98]">Deny</button></div>}</div>)}</div>}
      </aside></>}
    </section>

    <footer className="absolute bottom-0 left-0 right-0 z-[80] flex min-h-20 items-center justify-center gap-2 border-t border-white/10 bg-slate-950/95 px-2 py-3 backdrop-blur sm:gap-3 sm:px-4">
      <button type="button" onClick={() => void toggle('audio')} aria-label={audio ? 'Mute microphone' : 'Unmute microphone'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${audio ? 'bg-slate-800 hover:bg-slate-700' : 'bg-red-500 hover:bg-red-400'}`}>{audio ? <Mic/> : <MicOff/>}</button>
      <button type="button" onClick={() => void toggle('video')} aria-label={video ? 'Turn camera off' : 'Turn camera on'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${video ? 'bg-slate-800 hover:bg-slate-700' : 'bg-red-500 hover:bg-red-400'}`}>{video ? <Video/> : <VideoOff/>}</button>
      <button type="button" onClick={() => void share()} aria-label={sharing ? 'Stop sharing' : 'Share screen'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${sharing ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'}`}><MonitorUp/></button>
      <button type="button" onClick={() => void copy()} aria-label="Share meeting link" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-800 hover:bg-slate-700"><Share2/></button>
      <button type="button" onClick={() => { setPeople(false); setChat((value) => !value); }} aria-label="Chat" className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${chat ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'}`}><MessageSquare/></button>
      <button type="button" onClick={() => { setChat(false); setPeople((value) => !value); }} aria-label="Participants" className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full ${people ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'}`}><Users/>{isHost && waitingParticipants.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-950">{waitingParticipants.length}</span>}</button>
      <button type="button" onClick={() => void leave()} aria-label="Leave meeting" className="ml-1 grid h-12 w-14 shrink-0 place-items-center rounded-full bg-red-500 hover:bg-red-400"><PhoneOff/></button>
    </footer>
  </main>;
}
