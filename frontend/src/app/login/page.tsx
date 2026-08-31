'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth, googleProvider } from '../../config/firebase';
import { api } from '../../config/api';
import { Video, Mail, LockKeyhole } from 'lucide-react';
import toast from 'react-hot-toast';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = useMemo(() => {
    const requested = searchParams.get('next');
    return requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard';
  }, [searchParams]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, user => {
      if (user) router.replace(next);
    });
    return unsubscribe;
  }, [next, router]);

  const syncProfile = async () => {
    await api.post('/auth/register', {});
    router.replace(next);
  };

  const formatAuthError = (error: any) => {
    if (error?.code === 'auth/unauthorized-domain') {
      return 'This sign-in host is not authorized in Firebase Authentication. Add the current host to Authentication > Settings > Authorized domains.';
    }
    return error?.response?.data?.error
      || error?.response?.data?.message
      || error?.message?.replace('Firebase: ', '')
      || 'Unable to sign in';
  };

  const login = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      await syncProfile();
    } catch (error: any) {
      await firebaseAuth.signOut().catch(() => undefined);
      toast.error(formatAuthError(error));
    } finally { setBusy(false); }
  };

  const google = async () => {
    setBusy(true);
    try {
      await signInWithPopup(firebaseAuth, googleProvider);
      await syncProfile();
    } catch (error: any) {
      await firebaseAuth.signOut().catch(() => undefined);
      toast.error(formatAuthError(error));
    } finally { setBusy(false); }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white"><div className="mx-auto flex min-h-[80vh] max-w-md items-center"><div className="w-full">
      <div className="mb-8 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500"><Video/></div><h1 className="mt-5 text-3xl font-bold">Welcome to RTC Platform</h1><p className="mt-2 text-sm text-slate-400">Sign in to manage meetings and collaboration.</p></div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl"><button disabled={busy} onClick={google} className="w-full rounded-xl border border-white/10 bg-white px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">Continue with Google</button><div className="my-6 flex items-center gap-3 text-xs text-slate-600"><div className="h-px flex-1 bg-white/10"/>OR<div className="h-px flex-1 bg-white/10"/></div>
        <label className="text-xs text-slate-400">Email</label><div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950 px-3"><Mail size={16} className="text-slate-500"/><input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="email" className="w-full bg-transparent px-1 py-3 text-sm outline-none" placeholder="you@example.com"/></div>
        <label className="mt-4 block text-xs text-slate-400">Password</label><div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950 px-3"><LockKeyhole size={16} className="text-slate-500"/><input value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} type="password" autoComplete="current-password" className="w-full bg-transparent px-1 py-3 text-sm outline-none" placeholder="••••••••"/></div>
        <button disabled={busy||!email.trim()||!password} onClick={login} className="mt-5 w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold disabled:opacity-50">{busy?'Signing in…':'Sign in'}</button></div>
      <p className="mt-6 text-center text-xs text-slate-500">Firebase client configuration is public by design; private server credentials remain outside source control.</p>
    </div></div></main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-slate-950 text-slate-400">Loading sign-in…</main>}>
      <LoginPageContent />
    </Suspense>
  );
}
