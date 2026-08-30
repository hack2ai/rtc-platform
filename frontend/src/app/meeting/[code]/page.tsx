'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { useParams, useRouter } from 'next/navigation';
import {
  Copy,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Send,
  Share2,
  Shield,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { api } from '../../../config/api';
import { firebaseAuth, firestore } from '../../../config/firebase';
import toast from 'react-hot-toast';

type Message = {
  id: string;
  senderId: string;
  senderName?: string;
  content: string;
  deletedAt?: unknown;
};

type Participant = {
  uid: string;
  displayName?: string;
  role?: string;
  status?: string;
};

type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  settingRemoteAnswerPending: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
  remoteStream: MediaStream | null;
};

const fallbackIce: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

const normalizeCode = (input: string) => {
  const value = input.trim();
  try {
    const url = new URL(value);
    const marker = '/meeting/';
    const index = url.pathname.indexOf(marker);
    return decodeURIComponent(
      index >= 0
        ? url.pathname.slice(index + marker.length)
        : url.pathname.replace(/^\/+/, ''),
    )
      .split(/[?#]/)[0]
      .replace(/^\/|\/$/g, '');
  } catch {
    const marker = '/meeting/';
    const index = value.indexOf(marker);
    return decodeURIComponent(index >= 0 ? value.slice(index + marker.length) : value)
      .split(/[?#]/)[0]
      .replace(/^\/|\/$/g, '');
  }
};

const getShareBase = () =>
  typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '';

export default function MeetingRoom() {
  const params = useParams<{ code: string }>();
  const code = normalizeCode(String(params.code || ''));
  const router = useRouter();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const peers = useRef<Record<string, PeerState>>({});
  const remoteStreams = useRef<Record<string, MediaStream | null>>({});
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
  const [, setRemoteVersion] = useState(0);

  const attachRemoteStream = useCallback((targetId: string) => {
    const element = remoteRefs.current[targetId];
    const remoteStream = remoteStreams.current[targetId];
    if (!element || !remoteStream) return;
    if (element.srcObject !== remoteStream) element.srcObject = remoteStream;
    element.autoplay = true;
    element.playsInline = true;
    void element.play().catch(() => undefined);
  }, []);

  const sendSignal = useCallback(
    async (meetingId: string, targetId: string, type: string, payload: unknown) => {
      const uid = firebaseAuth.currentUser?.uid;
      if (!uid || !targetId || uid === targetId) return;
      try {
        await addDoc(collection(firestore, `meetings/${meetingId}/signaling`), {
          senderId: uid,
          targetId,
          type,
          payload,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        console.error('[WebRTC] signaling write failed', { type, targetId, error });
      }
    },
    [],
  );

  const createPeer = useCallback(
    async (meetingId: string, targetId: string) => {
      const uid = firebaseAuth.currentUser?.uid;
      if (!uid || !targetId || uid === targetId) return null;

      const existing = peers.current[targetId];
      if (existing && existing.pc.connectionState !== 'closed') {
        attachRemoteStream(targetId);
        return existing;
      }

      const pc = new RTCPeerConnection({
        iceServers,
        bundlePolicy: 'max-bundle',
        iceCandidatePoolSize: 4,
      });

      const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
      const state: PeerState = {
        pc,
        polite: uid > targetId,
        makingOffer: false,
        settingRemoteAnswerPending: false,
        ignoreOffer: false,
        pendingCandidates: [],
        audioSender: audioTransceiver.sender,
        videoSender: videoTransceiver.sender,
        remoteStream: null,
      };

      peers.current[targetId] = state;
      console.info('[WebRTC] peer created', { targetId, polite: state.polite });

      const currentStream = streamRef.current;
      if (currentStream) {
        await state.audioSender.replaceTrack(currentStream.getAudioTracks()[0] ?? null);
        await state.videoSender.replaceTrack(currentStream.getVideoTracks()[0] ?? null);
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void sendSignal(meetingId, targetId, 'candidate', event.candidate.toJSON());
        }
      };

      pc.ontrack = (event) => {
        let remoteStream = event.streams[0] ?? state.remoteStream;
        if (!remoteStream) remoteStream = new MediaStream();
        if (!event.streams[0] && !remoteStream.getTracks().some((track) => track.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
        state.remoteStream = remoteStream;
        remoteStreams.current[targetId] = remoteStream;
        console.info('[WebRTC] remote track received', {
          targetId,
          kind: event.track.kind,
          readyState: event.track.readyState,
        });
        setRemoteVersion((value) => value + 1);
        window.setTimeout(() => attachRemoteStream(targetId), 0);
      };

      pc.onnegotiationneeded = async () => {
        // Deterministic offerer: the lexicographically smaller Firebase UID starts.
        // The polite peer only answers or rolls back; this prevents offer glare.
        if (uid > targetId) return;
        if (pc.signalingState !== 'stable' || state.makingOffer) return;
        try {
          state.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            await sendSignal(meetingId, targetId, 'offer', {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            });
            console.info('[WebRTC] offer sent', { targetId });
          }
        } catch (error) {
          console.error('[WebRTC] offer failed', { targetId, error });
        } finally {
          state.makingOffer = false;
        }
      };

      pc.onconnectionstatechange = () => {
        console.info('[WebRTC] connection state', { targetId, state: pc.connectionState });
        if (pc.connectionState === 'connected') {
          setStatus('Connected');
        }
        if (['failed', 'closed'].includes(pc.connectionState)) {
          pc.close();
          delete peers.current[targetId];
          remoteStreams.current[targetId] = null;
          setRemoteVersion((value) => value + 1);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.info('[WebRTC] ICE state', { targetId, state: pc.iceConnectionState });
      };

      return state;
    },
    [attachRemoteStream, iceServers, sendSignal],
  );

  const requestMedia = useCallback(async (wantVideo: boolean, wantAudio: boolean) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException(
        'Camera and microphone are not available in this browser.',
        'NotSupportedError',
      );
    }
    return navigator.mediaDevices.getUserMedia({ video: wantVideo, audio: wantAudio });
  }, []);

  const acquireInitialMedia = useCallback(async () => {
    const attempts: Array<[boolean, boolean]> = [
      [true, true],
      [true, false],
      [false, true],
    ];
    for (const [wantVideo, wantAudio] of attempts) {
      try {
        return await requestMedia(wantVideo, wantAudio);
      } catch (error) {
        console.warn('[WebRTC] media request failed', { wantVideo, wantAudio, error });
      }
    }
    return null;
  }, [requestMedia]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (!code) {
        setStatus('Unable to join');
        toast.error('Invalid meeting link');
        return;
      }
      if (!firebaseAuth.currentUser) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }

      try {
        const meta = (await api.get<any>(`/meetings/code/${encodeURIComponent(code)}`)).data?.data;
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
        } catch (error) {
          console.warn('[WebRTC] ICE server lookup failed; using fallback STUN', error);
        }

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
          toast.error('Camera/microphone unavailable. You can still join the meeting.');
        }
        setStatus('Connected');
      } catch (error: any) {
        console.error('[WebRTC] meeting bootstrap failed', error);
        if (mounted) {
          setStatus('Unable to join');
          toast.error(error?.response?.data?.error || error?.message || 'Unable to join meeting');
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [acquireInitialMedia, code, router]);

  useEffect(() => {
    if (localVideoRef.current && stream && !sharing) {
      localVideoRef.current.srcObject = stream;
    }
  }, [sharing, stream]);

  useEffect(() => {
    for (const participant of participants) {
      if (participant.uid) attachRemoteStream(participant.uid);
    }
  }, [attachRemoteStream, participants]);

  useEffect(() => {
    if (!meeting?.id || status !== 'Connected') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    let active = true;

    const signalingQuery = query(
      collection(firestore, `meetings/${meeting.id}/signaling`),
      where('targetId', '==', uid),
    );

    signalUnsub.current?.();
    signalUnsub.current = onSnapshot(
      signalingQuery,
      async (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (!active || change.type !== 'added') continue;
          const data = change.doc.data() as any;
          if (!data.senderId || data.senderId === uid) continue;

          const state = await createPeer(meeting.id, data.senderId);
          if (!state) continue;
          const { pc } = state;

          try {
            if (data.type === 'offer') {
              const offerCollision =
                state.makingOffer || pc.signalingState !== 'stable';
              state.ignoreOffer = !state.polite && offerCollision;
              if (state.ignoreOffer) continue;

              if (offerCollision) {
                await pc.setLocalDescription({ type: 'rollback' });
              }
              await pc.setRemoteDescription(data.payload);
              for (const candidate of state.pendingCandidates.splice(0)) {
                await pc.addIceCandidate(candidate);
              }
              await pc.setLocalDescription();
              if (pc.localDescription) {
                await sendSignal(meeting.id, data.senderId, 'answer', {
                  type: pc.localDescription.type,
                  sdp: pc.localDescription.sdp,
                });
                console.info('[WebRTC] answer sent', { targetId: data.senderId });
              }
            } else if (data.type === 'answer') {
              if (pc.signalingState !== 'have-local-offer') continue;
              state.settingRemoteAnswerPending = true;
              await pc.setRemoteDescription(data.payload);
              state.settingRemoteAnswerPending = false;
              for (const candidate of state.pendingCandidates.splice(0)) {
                await pc.addIceCandidate(candidate);
              }
              console.info('[WebRTC] answer applied', { targetId: data.senderId });
            } else if (data.type === 'candidate' && data.payload) {
              if (pc.remoteDescription) await pc.addIceCandidate(data.payload);
              else state.pendingCandidates.push(data.payload);
            }
          } catch (error) {
            state.settingRemoteAnswerPending = false;
            console.error('[WebRTC] signaling handling failed', {
              type: data.type,
              targetId: data.senderId,
              error,
            });
          }
        }
      },
      (error) => console.error('[WebRTC] signaling subscription failed', error),
    );

    const refreshParticipants = async () => {
      if (!active || participantsRequestActive.current || document.visibilityState === 'hidden') return;
      participantsRequestActive.current = true;
      try {
        const result = await api.get<any>(`/meetings/${meeting.id}/participants`);
        const list: Participant[] = Array.isArray(result.data?.data) ? result.data.data : [];
        if (!active) return;
        setParticipants(list);
        for (const participant of list) {
          if (participant.uid && participant.uid !== uid && participant.status !== 'waiting') {
            await createPeer(meeting.id, participant.uid);
            attachRemoteStream(participant.uid);
          }
        }
        for (const [id, state] of Object.entries(peers.current)) {
          if (!list.some((participant) => participant.uid === id && participant.status !== 'waiting')) {
            state.pc.close();
            delete peers.current[id];
            remoteStreams.current[id] = null;
          }
        }
      } catch (error) {
        console.error('[WebRTC] participant refresh failed', error);
      } finally {
        participantsRequestActive.current = false;
      }
    };

    void refreshParticipants();
    const timer = window.setInterval(refreshParticipants, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
      signalUnsub.current?.();
      signalUnsub.current = null;
    };
  }, [attachRemoteStream, createPeer, meeting?.id, sendSignal, status]);

  useEffect(() => {
    if (!meeting?.id || !chat) return;
    let active = true;
    const load = async () => {
      if (!active || chatRequestActive.current || document.visibilityState === 'hidden') return;
      chatRequestActive.current = true;
      try {
        const response = await api.get<any>(`/chat/meetings/${meeting.id}/messages`, { limit: 100 });
        if (active) {
          setMessages(Array.isArray(response.data?.data?.messages) ? response.data.data.messages : []);
        }
      } catch (error) {
        console.error('[Chat] load failed', error);
      } finally {
        chatRequestActive.current = false;
      }
    };
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [chat, meeting?.id]);

  useEffect(
    () => () => {
      Object.values(peers.current).forEach((state) => state.pc.close());
      streamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const setOutgoingTrack = async (kind: 'audio' | 'video', track: MediaStreamTrack | null) => {
    for (const state of Object.values(peers.current)) {
      const sender = kind === 'audio' ? state.audioSender : state.videoSender;
      await sender.replaceTrack(track);
    }
  };

  const ensureTrack = async (kind: 'audio' | 'video') => {
    const existing = streamRef.current?.getTracks().find((track) => track.kind === kind);
    if (existing) {
      existing.enabled = true;
      await setOutgoingTrack(kind, existing);
      return existing;
    }

    const requested = await requestMedia(kind === 'video', kind === 'audio');
    const track = requested.getTracks().find((item) => item.kind === kind);
    if (!track) {
      requested.getTracks().forEach((item) => item.stop());
      throw new Error(`No ${kind} track available`);
    }

    if (!streamRef.current) {
      streamRef.current = new MediaStream();
    }
    streamRef.current.addTrack(track);
    requested.getTracks().filter((item) => item !== track).forEach((item) => item.stop());
    setStream(new MediaStream(streamRef.current.getTracks()));
    await setOutgoingTrack(kind, track);
    return track;
  };

  const toggle = async (kind: 'audio' | 'video') => {
    try {
      const track = streamRef.current?.getTracks().find((item) => item.kind === kind);
      if (!track) {
        await ensureTrack(kind);
        if (kind === 'audio') setAudio(true);
        else setVideo(true);
        return;
      }
      track.enabled = !track.enabled;
      await setOutgoingTrack(kind, track.enabled ? track : null);
      if (kind === 'audio') setAudio(track.enabled);
      else setVideo(track.enabled);
    } catch (error: any) {
      console.error('[Media] toggle failed', error);
      toast.error(`${kind === 'audio' ? 'Microphone' : 'Camera'} unavailable (${error?.name || 'error'}). Check browser permissions.`);
    }
  };

  const stopScreenShare = async () => {
    const camera = streamRef.current?.getVideoTracks()[0] ?? null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    await setOutgoingTrack('video', camera);
    if (localVideoRef.current && streamRef.current) localVideoRef.current.srcObject = streamRef.current;
    setSharing(false);
  };

  const shareScreen = async () => {
    if (sharing) {
      try {
        await stopScreenShare();
      } catch (error) {
        console.error('[WebRTC] stop screen share failed', error);
      }
      return;
    }

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen sharing is not supported in this browser.');
      }
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      if (!track) throw new Error('No screen video track was provided.');
      screenStreamRef.current = screen;
      await setOutgoingTrack('video', track);
      if (localVideoRef.current) localVideoRef.current.srcObject = screen;
      setSharing(true);
      track.onended = () => {
        void stopScreenShare().catch((error) => console.error('[WebRTC] screen ended handler failed', error));
      };
    } catch (error: any) {
      setSharing(false);
      if (error?.name !== 'AbortError') {
        console.error('[WebRTC] screen share failed', error);
        toast.error(error?.message || 'Unable to share screen');
      }
    }
  };

  const copyInvite = async () => {
    try {
      const invite = `${getShareBase()}/meeting/${encodeURIComponent(code)}`;
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

  const moveParticipant = async (userId: string, approve: boolean) => {
    if (!meeting?.id) return;
    try {
      await api.post(`/meetings/${meeting.id}/${approve ? 'approve' : 'deny'}/${encodeURIComponent(userId)}`, {});
      setParticipants((current) =>
        approve
          ? current.map((participant) => participant.uid === userId ? { ...participant, status: 'active' } : participant)
          : current.filter((participant) => participant.uid !== userId),
      );
      toast.success(approve ? 'Participant approved' : 'Participant denied');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || `Unable to ${approve ? 'approve' : 'deny'} participant`);
    }
  };

  const leave = async () => {
    try {
      if (meeting?.id) await api.delete(`/meetings/${meeting.id}/leave`);
    } catch (error) {
      console.warn('[Meeting] leave request failed', error);
    }
    Object.values(peers.current).forEach((state) => state.pc.close());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    router.replace('/dashboard');
  };

  if (status === 'Connecting…') {
    return (
      <main className="grid h-screen place-items-center bg-slate-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
          <p>{status}</p>
        </div>
      </main>
    );
  }

  if (status === 'Waiting for host approval') {
    return (
      <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <Shield className="mx-auto text-indigo-400" size={32} />
          <h1 className="mt-4 text-2xl font-semibold">Waiting for approval</h1>
          <p className="mt-2 text-sm text-slate-400">The host has been notified. Keep this tab open while you wait.</p>
          <button type="button" onClick={leave} className="mt-6 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-950">Leave waiting room</button>
        </div>
      </main>
    );
  }

  if (status !== 'Connected') {
    return (
      <main className="grid h-screen place-items-center bg-slate-950 px-6 text-white">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Unable to join meeting</h1>
          <p className="mt-2 text-sm text-slate-400">Check the meeting code, your network connection, and authentication.</p>
          <button type="button" onClick={() => router.replace('/dashboard')} className="mt-4 rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold">Back to dashboard</button>
        </div>
      </main>
    );
  }

  const uid = firebaseAuth.currentUser?.uid;
  const isHost = meeting?.hostId === uid;
  const waitingParticipants = participants.filter((participant) => participant.status === 'waiting' && participant.uid !== uid);

  return (
    <main className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-slate-950 text-white">
      <header className="relative z-50 flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4 sm:px-5">
        <div className="min-w-0">
          <p className="truncate font-semibold">{meeting?.title || 'RTC Meeting'}</p>
          <button type="button" onClick={() => void copyInvite()} className="mt-0.5 flex items-center gap-1 text-xs text-slate-400 hover:text-white" aria-label="Copy invite link">
            <span>{code}</span><Copy size={12}/>{copied && ' Copied'}
          </button>
        </div>
        <div className="flex items-center gap-3 text-slate-400"><Shield size={16}/><span className="text-xs">{participants.length} participant{participants.length === 1 ? '' : 's'}</span></div>
      </header>

      {isHost && waitingParticipants.length > 0 && (
        <div className="relative z-40 flex shrink-0 items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm">
          <div className="min-w-0"><p className="font-medium text-amber-200">{waitingParticipants.length} participant{waitingParticipants.length === 1 ? '' : 's'} waiting for approval</p><p className="truncate text-xs text-amber-100/70">{waitingParticipants.map((participant) => participant.displayName || 'Participant').join(', ')}</p></div>
          <button type="button" onClick={() => { setChat(false); setPeople(true); }} className="shrink-0 rounded-lg bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950">Review</button>
        </div>
      )}

      <section className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1 overflow-auto p-3 pb-24 sm:p-4 sm:pb-24">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
              <video ref={localVideoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${video || sharing ? '' : 'hidden'}`} />
              {!video && !sharing && <div className="absolute inset-0 grid place-items-center"><div className="grid h-20 w-20 place-items-center rounded-full bg-slate-800 text-2xl font-semibold">U</div></div>}
              <span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">You</span>
              {sharing && <span className="absolute right-3 top-3 rounded-lg bg-emerald-500/90 px-2.5 py-1 text-xs font-medium">Screen sharing</span>}
            </div>

            {participants.map((participant) => {
              if (!participant.uid || participant.uid === uid || participant.status === 'waiting') return null;
              return (
                <div key={participant.uid} className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
                  <video
                    ref={(element) => {
                      remoteRefs.current[participant.uid] = element;
                      if (element) {
                        const remoteStream = remoteStreams.current[participant.uid];
                        if (remoteStream) {
                          element.srcObject = remoteStream;
                          void element.play().catch(() => undefined);
                        }
                      }
                    }}
                    autoPlay
                    playsInline
                    className="h-full w-full object-cover"
                  />
                  {!remoteStreams.current[participant.uid] && <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">Connecting media…</div>}
                  <span className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs">{participant.displayName || 'Participant'}</span>
                </div>
              );
            })}
          </div>
        </div>

        {(chat || people) && (
          <>
            <button type="button" aria-label="Close panel" onClick={() => { setChat(false); setPeople(false); }} className="absolute inset-0 z-[60] bg-black/40 md:hidden" />
            <aside className="absolute inset-y-0 right-0 z-[70] flex w-[min(90vw,24rem)] flex-col border-l border-white/10 bg-slate-900 shadow-2xl md:relative md:z-20 md:w-80 md:shadow-none">
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4"><h2 className="font-semibold">{chat ? 'Chat' : 'Participants'}</h2><button type="button" onClick={() => { setChat(false); setPeople(false); }} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10"><X size={18}/></button></div>
              {chat ? (
                <>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                    {messages.length ? messages.map((message) => <div key={message.id}><p className="text-xs text-slate-500">{message.senderName || 'Participant'}</p><p className="mt-1 break-words rounded-xl bg-white/5 px-3 py-2 text-sm">{message.deletedAt ? '[Message deleted]' : message.content}</p></div>) : <p className="mt-8 text-center text-sm text-slate-500">No messages yet.</p>}
                  </div>
                  <div className="shrink-0 border-t border-white/10 bg-slate-900 p-3 pb-4"><div className="flex gap-2"><input value={messageText} onChange={(event) => setMessageText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void sendMessage()} className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Type a message…"/><button type="button" onClick={() => void sendMessage()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500" aria-label="Send message"><Send size={16}/></button></div></div>
                </>
              ) : (
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                  {participants.length === 0 && <p className="text-sm text-slate-500">No participants found.</p>}
                  {participants.map((participant) => (
                    <div key={participant.uid} className="rounded-xl bg-white/5 p-3">
                      <div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-500/30 text-sm font-semibold">{(participant.displayName || 'U').charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm">{participant.displayName || 'User'}</p><p className="text-xs text-slate-500">{participant.role === 'host' ? 'Host' : participant.status === 'waiting' ? 'Waiting for approval' : participant.status === 'active' ? 'Participant' : participant.status}</p></div></div>
                      {isHost && participant.role !== 'host' && participant.status === 'waiting' && <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void moveParticipant(participant.uid, true)} className="min-h-10 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950">Approve</button><button type="button" onClick={() => void moveParticipant(participant.uid, false)} className="min-h-10 rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white">Deny</button></div>}
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </>
        )}
      </section>

      <footer className="absolute bottom-0 left-0 right-0 z-[80] flex min-h-20 items-center justify-center gap-2 border-t border-white/10 bg-slate-950/95 px-2 py-3 backdrop-blur sm:gap-3 sm:px-4">
        <button type="button" onClick={() => void toggle('audio')} aria-label={audio ? 'Mute microphone' : 'Unmute microphone'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${audio ? 'bg-slate-800 hover:bg-slate-700' : 'bg-red-500 hover:bg-red-400'}`}>{audio ? <Mic/> : <MicOff/>}</button>
        <button type="button" onClick={() => void toggle('video')} aria-label={video ? 'Turn camera off' : 'Turn camera on'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${video ? 'bg-slate-800 hover:bg-slate-700' : 'bg-red-500 hover:bg-red-400'}`}>{video ? <Video/> : <VideoOff/>}</button>
        <button type="button" onClick={() => void shareScreen()} aria-label={sharing ? 'Stop sharing' : 'Share screen'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${sharing ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'}`}><MonitorUp/></button>
        <button type="button" onClick={() => void copyInvite()} aria-label="Share meeting link" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-800 hover:bg-slate-700"><Share2/></button>
        <button type="button" onClick={() => { setPeople(false); setChat((value) => !value); }} aria-label="Chat" className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${chat ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'}`}><MessageSquare/></button>
        <button type="button" onClick={() => { setChat(false); setPeople((value) => !value); }} aria-label="Participants" className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full ${people ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'}`}><Users/>{isHost && waitingParticipants.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-950">{waitingParticipants.length}</span>}</button>
        <button type="button" onClick={() => void leave()} aria-label="Leave meeting" className="ml-1 grid h-12 w-14 shrink-0 place-items-center rounded-full bg-red-500 hover:bg-red-400"><PhoneOff/></button>
      </footer>
    </main>
  );
}
