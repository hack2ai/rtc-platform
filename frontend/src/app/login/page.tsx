'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth, googleProvider } from '../../config/firebase';
import { api } from '../../config/api';
import { Video, Mail, LockKeyhole } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage(){
  const router=useRouter(); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false);
  useEffect(()=>onAuthStateChanged(firebaseAuth,u=>{if(u)router.replace('/dashboard')}),[router]);
  const finish=async()=>{try{await api.post('/auth/register');router.replace('/dashboard')}catch(e){router.replace('/dashboard')}};
  const login=async()=>{setBusy(true);try{await signInWithEmailAndPassword(firebaseAuth,email,password);await finish()}catch(e:any){toast.error(e?.message?.replace('Firebase: ','')||'Unable to sign in')}finally{setBusy(false)}};
  const google=async()=>{setBusy(true);try{await signInWithPopup(firebaseAuth,googleProvider);await finish()}catch(e:any){toast.error(e?.message||'Google sign-in failed')}finally{setBusy(false)}};
  return <main className="min-h-screen bg-slate-950 px-6 py-12 text-white"><div className="mx-auto flex min-h-[80vh] max-w-md items-center"><div className="w-full"><div className="mb-8 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500"><Video/></div><h1 className="mt-5 text-3xl font-bold">Welcome to RTC Platform</h1><p className="mt-2 text-sm text-slate-400">Sign in to manage meetings and collaboration.</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl"><button disabled={busy} onClick={google} className="w-full rounded-xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">Continue with Google</button><div className="my-6 flex items-center gap-3 text-xs text-slate-600"><div className="h-px flex-1 bg-white/10"/>OR<div className="h-px flex-1 bg-white/10"/></div><label className="text-xs text-slate-400">Email</label><div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950 px-3"><Mail size={16} className="text-slate-500"/><input value={email} onChange={e=>setEmail(e.target.value)} type="email" className="w-full bg-transparent px-1 py-3 text-sm outline-none" placeholder="you@example.com"/></div><label className="mt-4 block text-xs text-slate-400">Password</label><div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950 px-3"><LockKeyhole size={16} className="text-slate-500"/><input value={password} onChange={e=>setPassword(e.target.value)} type="password" className="w-full bg-transparent px-1 py-3 text-sm outline-none" placeholder="••••••••"/></div><button disabled={busy||!email||!password} onClick={login} className="mt-5 w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold disabled:opacity-50">{busy?'Signing in…':'Sign in'}</button></div><p className="mt-6 text-center text-xs text-slate-500">Your Firebase credentials stay in the browser; secrets are never committed.</p></div></div></main>;
}
