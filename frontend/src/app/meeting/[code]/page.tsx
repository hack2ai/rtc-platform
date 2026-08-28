'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Mic, MicOff, Video, VideoOff, MonitorUp, MessageSquare, PhoneOff, Users, Shield, Copy, Send, X } from 'lucide-react';
import { api } from '../../../config/api';
import { firebaseAuth } from '../../../config/firebase';
import toast from 'react-hot-toast';

type Message = { id: string; senderId: string; senderName: string; content: string; createdAt?: any; deletedAt?: any };
type Participant = { uid: string; displayName?: string; role?: string; status?: string; audioEnabled?: boolean; videoEnabled?: boolean };

export default function MeetingRoom() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
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

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!firebaseAuth.currentUser) { router.replace('/login'); return; }
      try {
        const meta = (await api.get<any>(`/meetings/code/${encodeURIComponent(String(code))}`)).data?.data;
        const joined = (await api.post<any>(`/meetings/${meta.id}/join`, {})).data?.data;
        if (!mounted) return;
        setMeeting({ ...meta, ...joined?.meeting });
        setStatus(joined?.status === 'waiting' ? 'Waiting for host approval' : 'Connected');
        if (joined?.status !== 'waiting') {
          const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          if (mounted) setStream(media);
        }
      } catch (e: any) {
        if (mounted) { setStatus('Unable to join'); toast.error(e?.response?.data?.error || 'Unable to join meeting'); }
      }
    })();
    return () => { mounted = false; };
  }, [code, router]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Connected') return;
    let active = true;
    const refresh = async () => {
      try {
        const [p, m] = await Promise.all([
          api.get<any>(`/meetings/${meeting.id}/participants`),
          api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 }),
        ]);
        if (!active) return;
        setParticipants(p.data?.data || []);
        setMessages(m.data?.data?.messages || []);
      } catch { /* transient polling errors are ignored */ }
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [meeting?.id, status]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, chat]);

  const toggle = (kind: 'audio' | 'video') => {
    if (!stream) return;
    stream.getTracks().filter((t) => t.kind === kind).forEach((t) => { t.enabled = !t.enabled; });
    kind === 'audio' ? setAudio((v) => !v) : setVideo((v) => !v);
  };

  const copy = () => { navigator.clipboard?.writeText(String(code)); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };

  const share = async () => {
    if (sharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setSharing(false);
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = screen;
      if (screenVideoRef.current) screenVideoRef.current.srcObject = screen;
      setSharing(true);
      screen.getVideoTracks()[0].onended = () => { screenStreamRef.current = null; setSharing(false); };
    } catch { setSharing(false); }
  };

  const sendMessage = async () => {
    const content = messageText.trim();
    if (!content || !meeting?.id) return;
    setMessageText('');
    try {
      await api.post(`/chat/meetings/${meeting.id}/messages`, { content });
      const r = await api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 });
      setMessages(r.data?.data?.messages || []);
    } catch (e: any) { setMessageText(content); toast.error(e?.response?.data?.error || 'Unable to send message'); }
  };

  const leave = async () => {
    if (meeting?.id) try { await api.delete(`/meetings/${meeting.id}/leave`); } catch { /* continue leaving locally */ }
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    stream?.getTracks().forEach((t) => t.stop());
    router.replace('/dashboard');
  };

  if (status === 'Connecting…') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" /><p>{status}</p></div></main>;
  if (status === 'Unable to join') return <main className="grid h-screen place-items-center bg-slate-950 text-white"><div className="text-center"><p className="text-lg font-semibold">Unable to join meeting</p><button onClick={() => router.replace('/dashboard')} className="mt-4 rounded-xl bg-indigo-500 px-5 py-2 text-sm">Back to dashboard</button></div></main>;

  return <main className="flex h-screen flex-col bg-slate-950 text-white">
    <header className="flex h-16 items-center justify-between border-b border-white/10 px-5">
      <div><p className="font-semibold">{meeting?.title || 'RTC Meeting'}</p><button onClick={copy} className="mt-0.5 flex items-center gap-1 text-xs text-slate-400 hover:text-white">{code}<Copy size={12} />{copied && ' Copied'}</button></div>
      <div className="flex items-center gap-3 text-slate-400"><Shield size={16} /><span className="hidden text-xs sm:inline">{status}</span><button onClick={() => setPeople((v) => !v)} aria-label="Participants"><Users size={18} /></button></div>
    </header>
    <section className="flex min-h-0 flex-1">
      <div className="relative flex flex-1 items-center justify-center p-4">
        <div className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
          <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${video ? '' : 'hidden'}`} />
          {!video && <div className="absolute inset-0 grid place-items-center"><div className="grid h-20 w-20 place-items-center rounded-full bg-slate-800 text-2xl font-semibold">U</div></div>}
          {sharing && <video ref={screenVideoRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-contain bg-black" />}
          <div className="absolute bottom-4 left-4 rounded-lg bg-black/50 px-3 py-1.5 text-xs backdrop-blur">You</div>
          {sharing && <div className="absolute right-4 top-4 rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-medium">Screen sharing</div>}
        </div>
      </div>
      {(chat || people) && <aside className="hidden w-80 border-l border-white/10 bg-slate-900 md:flex md:flex-col">
        <div className="flex items-center justify-between border-b border-white/10 p-4"><h2 className="font-semibold">{chat ? 'Chat' : 'Participants'}</h2><button onClick={() => { setChat(false); setPeople(false); }} aria-label="Close"><X size={18} /></button></div>
        {chat ? <><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{messages.length ? messages.map((m) => <div key={m.id}><p className="text-xs text-slate-500">{m.senderName}</p><p className="mt-1 break-words rounded-xl bg-white/5 px-3 py-2 text-sm">{m.deletedAt ? '[Message deleted]' : m.content}</p></div>) : <p className="mt-8 text-center text-sm text-slate-500">No messages yet.</p>}<div ref={messagesEndRef} /></div><div className="border-t border-white/10 p-3"><div className="flex gap-2"><input value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm outline-none" placeholder="Type a message…" /><button onClick={sendMessage} className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500" aria-label="Send"><Send size={16} /></button></div></div></> : <div className="space-y-2 overflow-y-auto p-4">{participants.map((p) => <div key={p.uid} className="flex items-center gap-3 rounded-xl bg-white/5 p-3"><div className="grid h-9 w-9 place-items-center rounded-full bg-indigo-500/30 text-sm font-semibold">{(p.displayName || 'U').charAt(0).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-sm">{p.displayName || 'User'}</p><p className="text-xs text-slate-500">{p.role === 'host' ? 'Host' : 'Participant'}</p></div></div>)}</div>}
      </aside>}
    </section>
    <footer className="flex h-20 items-center justify-center gap-2 border-t border-white/10 bg-slate-950 px-4">
      <button onClick={() => toggle('audio')} aria-label={audio ? 'Mute microphone' : 'Unmute microphone'} className={`grid h-12 w-12 place-items-center rounded-full ${audio ? 'bg-slate-800' : 'bg-red-500'}`}>{audio ? <Mic /> : <MicOff />}</button>
      <button onClick={() => toggle('video')} aria-label={video ? 'Turn camera off' : 'Turn camera on'} className={`grid h-12 w-12 place-items-center rounded-full ${video ? 'bg-slate-800' : 'bg-red-500'}`}>{video ? <Video /> : <VideoOff />}</button>
      <button onClick={share} aria-label={sharing ? 'Stop sharing' : 'Share screen'} className={`grid h-12 w-12 place-items-center rounded-full ${sharing ? 'bg-indigo-500' : 'bg-slate-800'}`}><MonitorUp /></button>
      <button onClick={() => { setPeople(false); setChat((v) => !v); }} aria-label="Chat" className={`grid h-12 w-12 place-items-center rounded-full ${chat ? 'bg-indigo-500' : 'bg-slate-800'}`}><MessageSquare /></button>
      <button onClick={() => { setChat(false); setPeople((v) => !v); }} aria-label="Participants" className={`grid h-12 w-12 place-items-center rounded-full ${people ? 'bg-indigo-500' : 'bg-slate-800'}`}><Users /></button>
      <button onClick={leave} aria-label="Leave meeting" className="ml-2 grid h-12 w-14 place-items-center rounded-full bg-red-500"><PhoneOff /></button>
    </footer>
  </main>;
}
