'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { firebaseAuth } from '../../config/firebase';
import { api } from '../../config/api';
import { Video, Plus, ArrowRight, ShieldCheck, MessageSquare, FolderOpen, Clock3, LogOut, Copy, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

type Meeting = { id: string; code: string; title?: string; status?: string; createdAt?: any };

const shareBase = () => (typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL || '')).replace(/\/$/, '');

const normalizeMeetingCode = (input: string) => {
  const value = input.trim();
  if (!value) return '';

  try {
    const url = new URL(value);
    const marker = '/meeting/';
    const index = url.pathname.indexOf(marker);
    if (index >= 0) {
      return decodeURIComponent(url.pathname.slice(index + marker.length)).replace(/^\/|\/$/g, '');
    }
    return decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''));
  } catch {
    const marker = '/meeting/';
    const index = value.indexOf(marker);
    if (index >= 0) {
      return decodeURIComponent(value.slice(index + marker.length).split(/[?#]/)[0]).replace(/^\/|\/$/g, '');
    }
    return value.replace(/^\/+|\/+$/g, '');
  }
};

export default function DashboardPage() {
  const router = useRouter();
  const [code,setCode]=useState('');
  const [title,setTitle]=useState('');
  const [showCreate,setShowCreate]=useState(false);
  const [busy,setBusy]=useState(false);
  const [recentMeetings,setRecentMeetings]=useState<Meeting[]>([]);
  const [user,setUser]=useState(firebaseAuth.currentUser);
  const [loadingRecent,setLoadingRecent]=useState(false);

  useEffect(()=>onAuthStateChanged(firebaseAuth,u=>{setUser(u);if(!u)router.replace('/login')}),[router]);

  useEffect(() => {
    if (!user) { setRecentMeetings([]); return; }
    let active = true;
    const loadRecentMeetings = async () => {
      setLoadingRecent(true);
      try {
        const response = await api.get<any>('/meetings', { page: 1, limit: 10 });
        const payload = response.data?.data ?? response.data;
        const items = Array.isArray(payload) ? payload : (payload?.items ?? payload?.data ?? []);
        if (active) setRecentMeetings(Array.isArray(items) ? items : []);
      } catch (error) {
        console.error('Failed to load recent meetings:', error);
        if (active) setRecentMeetings([]);
      } finally {
        if (active) setLoadingRecent(false);
      }
    };
    void loadRecentMeetings();
    return () => { active = false; };
  }, [user]);

  const join=()=>{
    const value=normalizeMeetingCode(code);
    if(value) router.push(`/meeting/${encodeURIComponent(value)}`);
    else toast.error('Enter a meeting code or invite link');
  };

  const create=async()=>{
    setBusy(true);
    try{
      const r=await api.post<any>('/meetings',{title:title.trim()||'New meeting'});
      const meeting=r.data?.data;
      setShowCreate(false);
      setTitle('');
      if(meeting?.code)router.push(`/meeting/${encodeURIComponent(meeting.code)}`);
      else toast.error('Meeting created but no room code was returned');
    }catch(e:any){toast.error(e?.response?.data?.error||'Unable to create meeting')}
    finally{setBusy(false)}
  };

  const copyInvite = async (meetingCode: string) => {
    try {
      await navigator.clipboard.writeText(`${shareBase()}/meeting/${encodeURIComponent(meetingCode)}`);
      toast.success('Invite link copied');
    } catch { toast.error('Could not copy invite link'); }
  };

  const logout=async()=>{await signOut(firebaseAuth);router.replace('/login')};

  if(!user)return <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">Loading workspace…</main>;

  return <main className="min-h-screen bg-slate-950 text-white">
    <nav className="border-b border-white/10 bg-slate-950/80 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500"><Video size={20}/></div><span className="text-lg font-semibold">RTC Platform</span></div><div className="flex items-center gap-4 text-sm text-slate-300"><span className="hidden sm:inline">{user.displayName||user.email}</span><button onClick={logout} title="Sign out" className="rounded-lg p-2 hover:bg-white/10"><LogOut size={17}/></button></div></div></nav>
    <section className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-10 max-w-3xl"><p className="mb-3 text-sm font-medium text-indigo-400">REAL-TIME WORKSPACE</p><h1 className="text-4xl font-bold tracking-tight md:text-5xl">Meet, collaborate, and get work done.</h1><p className="mt-4 text-lg text-slate-400">Host secure video meetings with chat, screen sharing, files, and collaborative tools in one workspace.</p></div>
      <div className="grid gap-5 md:grid-cols-2">
        <button onClick={()=>setShowCreate(true)} className="group rounded-2xl border border-indigo-400/30 bg-indigo-500/10 p-7 text-left transition hover:-translate-y-0.5 hover:bg-indigo-500/15"><div className="mb-8 grid h-12 w-12 place-items-center rounded-xl bg-indigo-500"><Plus/></div><h2 className="text-xl font-semibold">Start a new meeting</h2><p className="mt-2 text-sm text-slate-400">Create a private meeting room and invite participants.</p><span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-indigo-300">Create meeting <ArrowRight size={16}/></span></button>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-7"><div className="mb-5 flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-slate-800"><ArrowRight/></div><div><h2 className="text-xl font-semibold">Join a meeting</h2><p className="text-sm text-slate-400">Enter a meeting code or paste an invite link.</p></div></div><div className="flex gap-2"><input value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==='Enter'&&join()} placeholder="abc-1234-def or invite URL" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 outline-none focus:border-indigo-400"/><button onClick={join} disabled={!code.trim()} className="rounded-xl bg-white px-5 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">Join</button></div></div>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button onClick={()=>document.getElementById('recent-meetings')?.scrollIntoView({behavior:'smooth'})} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left hover:bg-white/[0.06]"><Video size={20} className="text-indigo-400"/><p className="mt-4 font-medium">Meetings</p><p className="mt-1 text-xs text-slate-500">View your recent meeting rooms</p></button>
        <button onClick={()=>toast('Open Chat from inside a meeting', { icon: '💬' })} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left hover:bg-white/[0.06]"><MessageSquare size={20} className="text-indigo-400"/><p className="mt-4 font-medium">Chat</p><p className="mt-1 text-xs text-slate-500">Available inside meeting rooms</p></button>
        <button onClick={()=>toast('File sharing is available inside meeting rooms', { icon: '📁' })} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left hover:bg-white/[0.06]"><FolderOpen size={20} className="text-indigo-400"/><p className="mt-4 font-medium">Files</p><p className="mt-1 text-xs text-slate-500">Shared resources in meetings</p></button>
        <button onClick={()=>toast('Security settings are enforced by the meeting and authentication layers', { icon: '🛡️' })} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left hover:bg-white/[0.06]"><ShieldCheck size={20} className="text-indigo-400"/><p className="mt-4 font-medium">Security</p><p className="mt-1 text-xs text-slate-500">Protected by default</p></button>
      </div>

      <div id="recent-meetings" className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-6"><div className="flex items-center gap-3"><Clock3 size={18} className="text-slate-400"/><h3 className="font-semibold">Recent meetings</h3></div>
        {loadingRecent ? <p className="mt-5 text-sm text-slate-500">Loading your meetings…</p> : recentMeetings.length === 0 ? <p className="mt-5 text-sm text-slate-500">No meetings yet. Create or join a meeting and it will appear here.</p> : <div className="mt-5 space-y-3">{recentMeetings.map((meeting)=><div key={meeting.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-medium">{meeting.title||'Untitled meeting'}</p><p className="mt-1 text-xs text-slate-500">Code: {meeting.code} · {meeting.status||'active'}</p></div><div className="flex shrink-0 gap-2"><button onClick={()=>router.push(`/meeting/${encodeURIComponent(meeting.code)}`)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold">Join <ExternalLink size={13}/></button><button onClick={()=>copyInvite(meeting.code)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15"><Copy size={13}/> Copy link</button></div></div>)}</div>}
      </div>
    </section>
    {showCreate&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"><div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"><h2 className="text-xl font-semibold">Create meeting</h2><p className="mt-1 text-sm text-slate-400">Give your meeting a recognizable name.</p><input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="Team sync" className="mt-6 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 outline-none focus:border-indigo-400"/><div className="mt-5 flex justify-end gap-2"><button disabled={busy} onClick={()=>setShowCreate(false)} className="rounded-xl px-4 py-2 text-sm text-slate-400">Cancel</button><button disabled={busy} onClick={create} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy?'Creating…':'Create room'}</button></div></div></div>}
  </main>;
}
