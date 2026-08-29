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
type Peer = { pc: RTCPeerConnection };
const fallbackIce: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

const getShareBase = () => typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '';

export default function MeetingRoom() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const peers = useRef<Record<string, Peer>>({});
  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const signalUnsub = useRef<(() => void) | null>(null);
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
    await addDoc(collection(firestore, `meetings/${meetingId}/signaling`), {
      senderId: uid,
      targetId,
      type,
      payload,
      createdAt: serverTimestamp(),
    });
  };

  const createPeer = async (meetingId: string, targetId: string, shouldOffer: boolean) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || uid === targetId) return null;
    if (peers.current[targetId]) return peers.current[targetId].pc;

    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', iceCandidatePoolSize: 10 });
    peers.current[targetId] = { pc };
    streamRef.current?.getTracks().forEach((track) => pc.addTrack(track, streamRef.current!));
    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal(meetingId, targetId, 'candidate', event.candidate.toJSON());
    };
    pc.ontrack = (event) => {
      const element = remoteRefs.current[targetId];
      if (element && event.streams[0]) element.srcObject = event.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        pc.close();
        delete peers.current[targetId];
      }
    };
    if (shouldOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(meetingId, targetId, 'offer', offer);
    }
    return pc;
  };

  const requestMedia = async (wantVideo: boolean, wantAudio: boolean) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException('Camera and microphone are not available in this browser/context.', 'NotSupportedError');
    }
    return navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: wantAudio });
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!firebaseAuth.currentUser) {
        router.replace('/login?next=' + encodeURIComponent(window.location.pathname));
        return;
      }
      try {
        const meta = (await api.get<any>(`/meetings/code/${encodeURIComponent(String(code))}`)).data?.data;
        if (!meta?.id) throw new Error('Meeting not found');

        const joined = (await api.post<any>(`/meetings/${meta.id}/join`, {})).data?.data;
        if (!mounted) return;
        setMeeting({ ...meta, ...joined?.meeting });

        if (joined?.status === 'waiting') {
          setStatus('Waiting for host approval');
          return;
        }

        try {
          const ice = (await api.get<any>('/meetings/ice-servers')).data?.data?.iceServers;
          if (Array.isArray(ice) && ice.length) setIceServers(ice);
        } catch {}

        let media: MediaStream | null = null;
        try {
          media = await requestMedia(true, true);
        } catch {
          try { media = await requestMedia(true, false); } catch {
            try { media = await requestMedia(false, true); } catch { media = null; }
          }
        }

        if (!mounted) return;
        if (media) {
          streamRef.current = media;
          setStream(media);
          setAudio(media.getAudioTracks().length > 0 ? media.getAudioTracks()[0].enabled : false);
          setVideo(media.getVideoTracks().length > 0 ? media.getVideoTracks()[0].enabled : false);
        } else {
          toast.error('Camera/microphone access is unavailable. You can still join and use chat/screen sharing.');
        }
        setStatus('Connected');
      } catch (e: any) {
        if (mounted) {
          setStatus('Unable to join');
          toast.error(e?.response?.data?.error || e?.message || 'Unable to join meeting');
        }
      }
    })();
    return () => { mounted = false; };
  }, [code, router]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Waiting for host approval') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    let active = true;
    const checkApproval = async () => {
      try {
        const result = await api.get<any>(`/meetings/${meeting.id}`);
        const current = result.data?.data;
        if (active && current?.participants?.includes(uid)) window.location.reload();
      } catch {}
    };
    void checkApproval();
    const timer = window.setInterval(checkApproval, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [meeting?.id, status]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

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
        try {
          const pc = await createPeer(meeting.id, data.senderId, false);
          if (!pc) continue;
          if (data.type === 'offer') {
            await pc.setRemoteDescription(data.payload);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal(meeting.id, data.senderId, 'answer', answer);
          } else if (data.type === 'answer') {
            await pc.setRemoteDescription(data.payload);
          } else if (data.type === 'candidate' && data.payload) {
            await pc.addIceCandidate(data.payload);
          }
        } catch (error) {
          console.warn('WebRTC signaling error', error);
        }
      }
    }, (error) => console.warn('Signaling subscription failed', error));

    const refresh = async () => {
      try {
        const result = await api.get<any>(`/meetings/${meeting.id}/participants`);
        const list: Participant[] = result.data?.data || [];
        setParticipants(list);
        for (const participant of list) {
          const id = participant.uid;
          if (id && id !== uid && participant.status !== 'waiting') {
            await createPeer(meeting.id, id, uid < id);
          }
        }
      } catch {}
    };

    void refresh();
    const timer = window.setInterval(refresh, 3000);
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
      try {
        const r = await api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 });
        if (active) setMessages(r.data?.data?.messages || []);
      } catch {}
    };
    void load();
    const timer = window.setInterval(load, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [meeting?.id, chat]);

  useEffect(() => () => {
    Object.values(peers.current).forEach(({ pc }) => pc.close());
    streamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const ensureTrack = async (kind: 'audio' | 'video') => {
    const current = streamRef.current;
    const existing = current?.getTracks().find((track) => track.kind === kind);
    if (existing) { existing.enabled = true; return existing; }

    const requested = await requestMedia(kind === 'video', kind === 'audio');
    const track = requested.getTracks().find((item) => item.kind === kind);
    if (!track) {
      requested.getTracks().forEach((item) => item.stop());
      throw new Error(`No ${kind} track available`);
    }

    if (!streamRef.current) {
      streamRef.current = requested;
      setStream(requested);
    } else {
      streamRef.current.addTrack(track);
      requested.getTracks().filter((item) => item !== track).forEach((item) => item.stop());
    }

    Object.values(peers.current).forEach(({ pc }) => {
      const sender = pc.getSenders().find((item) => item.track?.kind === kind);
      if (sender) void sender.replaceTrack(track);
      else void pc.addTrack(track, streamRef.current!);
    });
    return track;
  };

  const toggle = async (kind: 'audio' | 'video') => {
    try {
      if (!streamRef.current?.getTracks().some((t) => t.kind === kind)) {
        await ensureTrack(kind);
        kind === 'audio' ? setAudio(true) : setVideo(true);
        return;
      }
      streamRef.current.getTracks().filter((t) => t.kind === kind).forEach((t) => { t.enabled = !t.enabled; });
      kind === 'audio' ? setAudio((v) => !v) : setVideo((v) => !v);
    } catch (error) {
      console.error('Media toggle error:', error);
      toast.error(`${kind === 'audio' ? 'Microphone' : 'Camera'} permission or device is unavailable.`);
    }
  };

  const copy = async () => {
    try {
      const invite = `${getShareBase()}/meeting/${encodeURIComponent(String(code))}`;
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

  const moveParticipant = async (userId: string, approve: boolean) => {
    if (!meeting?.id) return;
    try {
      await api.post(`/meetings/${meeting.id}/${approve ? 'approve' : 'deny'}/${encodeURIComponent(userId)}`, {});
      setParticipants((current) => current.map((p) => p.uid === userId ? { ...p, status: approve ? 'active' : 'removed' } : p).filter((p) => p.status !== 'removed'));
      toast.success(approve ? 'Participant approved' : 'Participant denied');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || `Unable to ${approve ? 'approve' : 'deny'} participant`);
    }
  };

  const share = async () => {
    if (sharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setSharing(false);
      return;
    }
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported in this browser.');
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = screen;
      const track = screen.getVideoTracks()[0];
      Object.values(peers.current).forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) void sender.replaceTrack(track);
      });
      if (videoRef.current) videoRef.current.srcObject = screen;
      setSharing(true);
      track.onended = () => {
        const camera = streamRef.current?.getVideoTracks()[0];
        Object.values(peers.current).forEach(({ pc }) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender && camera) void sender.replaceTrack(camera);
        });
        screenStreamRef.current = null;
        if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
        setSharing(false);
      };
    } catch (error: any) {
      setSharing(false);
      toast.error(error?.message || 'Unable to share screen');
    }
  };

  const sendMessage = async () => {
    const content = messageText.trim();
    if (!content || !meeting?.id) return;
    setMessageText('');
    try {
      await api.post(`/chat/meetings/${meeting.id}/messages`, { content, type: 'text' });
      const r = await api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 });
      setMessages(r.data?.data?.messages || []);
    } catch (e: any) {
      setMessageText(content);
      toast.error(e?.response?.data?.error || 'Unable to send message');
    }
  };

  const leave = async () => {
    if (meeting?.id) {
      try { await api.delete(`/meetings/${meeting.id}/leave`); } catch {}
    }
    Object.values(peers.current).forEach(({ pc }) => pc.close());
    streamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    router.replace('/dashboard');
  };

  if (status === 'Connecting…') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400"/><p>{status}</p></div></main>;
  if (status === 'Waiting for host approval') return <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center"><Shield className="mx-auto text-indigo-400" size={32}/><h1 className="mt-4 text-2xl font-semibold">Waiting for approval</h1><p className="mt-2 text-sm text-slate-400">The host has been notified. Keep this tab open while you wait.</p><button type="button" onClick={leave} className="mt-6 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">Leave waiting room</button></div></main>;
  if (status !== 'Connected') return <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white"><div className="text-center"><h1 className="text-xl font-semibold">Unable to join meeting</h1><p className="mt-2 text-sm text-slate-400">Check the meeting code, your network connection, and authentication.</p><button type="button" onClick={() => router.replace('/dashboard')} className="mt-4 rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold">Back to dashboard</button></div></main>;

  const isHost = meeting?.hostId === firebaseAuth.currentUser?.uid;
  const waitingParticipants = participants.filter((p) => p.status === 'waiting' && p.uid !== firebaseAuth.currentUser?.uid);

  return <main className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 text-white">
    <header className="relative z-50 flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4 sm:px-5">
      <div className="min-w-0">
        <p className="truncate font-semibold">{meeting?.title || 'RTC Meeting'}</p>
        <button type="button" onClick={copy} className="mt-0.5 flex items-center gap-1 text-xs text-slate-400 hover:text-white" aria-label="Copy invite link"><span>{code}</span><Copy size={12}/>{copied && ' Copied'}</button>
      </div>
      <div className="flex items-center gap-3 text-slate-400"><Shield size={16}/><span className="text-xs">{participants.length} participant{participants.length === 1 ? '' : 's'}</span></div>
    </header>

    {isHost && waitingParticipants.length > 0 && <div className="relative z-40 flex shrink-0 items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="min-w-0"><p className="font-medium text-amber-200">{waitingParticipants.length} participant{waitingParticipants.length === 1 ? '' : 's'} waiting for approval</p><p className="truncate text-xs text-amber-100/70">{waitingParticipants.map((p) => p.displayName || 'Participant').join(', ')}</p></div>
      <button type="button" onClick={() => { setChat(false); setPeople(true); }} className="shrink-0 rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950">Review</button>
    </div>}

    <section className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
      <div className="relative min-w-0 flex-1 overflow-auto p-3 pb-24 sm:p-4 sm:pb-24">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
            <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${video || sharing ? '' : 'hidden'}`}/>
            {!video && !sharing && <div className="absolute inset-0 grid place-items-center"><div className="grid h-20 w-20 place-items-center rounded-full bg-slate-800 text-2xl font-semibold">U</div></div>}
            <span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">You</span>
            {sharing && <span className="absolute right-3 top-3 rounded-lg bg-emerald-500/90 px-2.5 py-1 text-xs font-medium">Screen sharing</span>}
          </div>
          {participants.map((p) => {
            const id = p.uid;
            if (!id || id === firebaseAuth.currentUser?.uid || p.status === 'waiting') return null;
            return <div key={id} className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900"><video ref={(el) => { remoteRefs.current[id] = el; }} autoPlay playsInline className="h-full w-full object-cover"/><span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">{p.displayName || 'Participant'}</span></div>;
          })}
        </div>
      </div>

      {(chat || people) && <>
        <button type="button" aria-label="Close panel" onClick={() => { setChat(false); setPeople(false); }} className="absolute inset-0 z-[60] bg-black/40 md:hidden" />
        <aside className="absolute inset-y-0 right-0 z-[70] flex w-[min(90vw,24rem)] flex-col border-l border-white/10 bg-slate-900 shadow-2xl md:relative md:z-20 md:w-80 md:shadow-none">
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4"><h2 className="font-semibold">{chat ? 'Chat' : 'Participants'}</h2><button type="button" onClick={() => { setChat(false); setPeople(false); }} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10"><X size={18}/></button></div>
          {chat ? <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{messages.length ? messages.map((m) => <div key={m.id}><p className="text-xs text-slate-500">{m.senderName || 'Participant'}</p><p className="mt-1 break-words rounded-xl bg-white/5 px-3 py-2 text-sm">{m.deletedAt ? '[Message deleted]' : m.content}</p></div>) : <p className="mt-8 text-center text-sm text-slate-500">No messages yet.</p>}</div>
            <div className="shrink-0 border-t border-white/10 p-3"><div className="flex gap-2"><input value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void sendMessage()} className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Type a message…"/><button type="button" onClick={() => void sendMessage()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500" aria-label="Send message"><Send size={16}/></button></div></div>
          </> : <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
            {participants.length === 0 && <p className="text-sm text-slate-500">No participants found.</p>}
            {participants.map((p) => <div key={p.uid} className="rounded-xl bg-white/5 p-3"><div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-500/30 text-sm font-semibold">{(p.displayName || 'U').charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm">{p.displayName || 'User'}</p><p className="text-xs text-slate-500">{p.role === 'host' ? 'Host' : p.status === 'waiting' ? 'Waiting for approval' : p.status === 'active' ? 'Participant' : p.status}</p></div></div>{isHost && p.role !== 'host' && p.status === 'waiting' && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void moveParticipant(p.uid, true)} className="min-h-10 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 active:scale-[0.98]">Approve</button><button type="button" onClick={() => void moveParticipant(p.uid, false)} className="min-h-10 rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-400 active:scale-[0.98]">Deny</button></div>}</div>)}
          </div>}
        </aside>
      </>}
    </section>

    <footer className="absolute bottom-0 left-0 right-0 z-[80] flex min-h-20 items-center justify-center gap-2 border-t border-white/10 bg-slate-950/95 px-2 py-3 backdrop-blur sm:gap-3 sm:px-4">
      <button type="button" onClick={() => void toggle('audio')} aria-label={audio ? 'Mute microphone' : 'Unmute microphone'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${audio ? 'bg-slate-800 hover:bg-slate-700' : 'bg-red-500 hover:bg-red-400'}`}>{audio ? <Mic/> : <MicOff/>}</button>
      <button type="button" onClick={() => void toggle('video')} aria-label={video ? 'Turn camera off' : 'Turn camera on'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${video ? 'bg-slate-800 hover:bg-slate-700' : 'bg-red-500 hover:bg-red-400'}`}>{video ? <Video/> : <VideoOff/>}</button>
      <button type="button" onClick={() => void share()} aria-label={sharing ? 'Stop sharing' : 'Share screen'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${sharing ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'}`}><MonitorUp/></button>
      <button type="button" onClick={() => void copy()} aria-label="Share meeting link" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-800 hover:bg-slate-700"><Share2/></button>
      <button type="button" onClick={() => { setPeople(false); setChat((v) => !v); }} aria-label="Chat" className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${chat ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'}`}><MessageSquare/></button>
      <button type="button" onClick={() => { setChat(false); setPeople((v) => !v); }} aria-label="Participants" className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full ${people ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'}`}><Users/>{isHost && waitingParticipants.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-950">{waitingParticipants.length}</span>}</button>
      <button type="button" onClick={() => void leave()} aria-label="Leave meeting" className="ml-1 grid h-12 w-14 shrink-0 place-items-center rounded-full bg-red-500 hover:bg-red-400"><PhoneOff/></button>
    </footer>
  </main>;
}
