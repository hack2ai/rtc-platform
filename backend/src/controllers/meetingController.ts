import { Request, Response } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { AuthenticatedRequest, Meeting, MeetingSettings } from '../types';
import { generateMeetingCode } from '../utils/meetingCode';
import { sendError, sendPaginated, sendSuccess } from '../utils/response';

const DEFAULT_SETTINGS: MeetingSettings = {
  waitingRoomEnabled: true,
  hostApprovalRequired: false,
  chatEnabled: true,
  screenShareEnabled: true,
  fileShareEnabled: true,
  whiteboardEnabled: true,
  recordingEnabled: false,
  muteOnEntry: false,
  videoOnEntry: true,
  allowParticipantRename: true,
};

const publicMeeting = (data: FirebaseFirestore.DocumentData) => {
  const { password: _password, ...safe } = data;
  return safe;
};

const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, stored?: string): boolean => {
  if (!stored) return true;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
};

const getMeeting = async (meetingId: string) => db.collection('meetings').doc(meetingId).get();

const requireUser = (req: AuthenticatedRequest, res: Response): string | null => {
  if (!req.user?.uid) {
    sendError(res, 'Authentication required', 401);
    return null;
  }
  return req.user.uid;
};

export const getIceServers = async (_req: Request, res: Response) => {
  const servers: Array<Record<string, unknown>> = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({
      urls: process.env.TURN_URL.split(',').map((url) => url.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  sendSuccess(res, { iceServers: servers });
};

export const createMeeting = async (req: AuthenticatedRequest, res: Response) => {
  const uid = requireUser(req, res);
  if (!uid) return;

  const title = String(req.body.title).trim();
  const description = req.body.description ? String(req.body.description).trim() : undefined;
  const maxParticipants = Number(req.body.maxParticipants || 100);
  const scheduledAt = req.body.scheduledAt ? Timestamp.fromDate(new Date(req.body.scheduledAt)) : undefined;
  const settings: MeetingSettings = { ...DEFAULT_SETTINGS, ...(req.body.settings || {}) };
  if (typeof req.body.recordingEnabled === 'boolean') settings.recordingEnabled = req.body.recordingEnabled;

  let code = generateMeetingCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await db.collection('meetings').where('code', '==', code).limit(1).get();
    if (existing.empty) break;
    code = generateMeetingCode();
  }

  const ref = db.collection('meetings').doc();
  const now = FieldValue.serverTimestamp();
  const meeting: Record<string, unknown> = {
    id: ref.id,
    code,
    title,
    ...(description ? { description } : {}),
    hostId: uid,
    hostName: req.user?.displayName || req.user?.email || 'Host',
    status: scheduledAt ? 'scheduled' : 'active',
    ...(scheduledAt ? { scheduledAt } : { startedAt: now }),
    settings,
    participants: [uid],
    waitingRoom: [],
    bannedUsers: [],
    recordingEnabled: settings.recordingEnabled,
    isLocked: false,
    ...(req.body.password ? { password: hashPassword(String(req.body.password)) } : {}),
    maxParticipants,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(meeting);
  await ref.collection('participants').doc(uid).set({
    uid,
    meetingId: ref.id,
    displayName: req.user?.displayName || req.user?.email || 'Host',
    role: 'host',
    status: 'active',
    audioEnabled: true,
    videoEnabled: true,
    screenSharing: false,
    handRaised: false,
    connectionQuality: 'excellent',
    joinedAt: now,
  });

  sendSuccess(res, publicMeeting({ ...meeting, createdAt: undefined, updatedAt: undefined }), 'Meeting created', 201);
};

export const listMeetings = async (req: AuthenticatedRequest, res: Response) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));

  const [hosted, joined] = await Promise.all([
    db.collection('meetings').where('hostId', '==', uid).limit(100).get(),
    db.collection('meetings').where('participants', 'array-contains', uid).limit(100).get(),
  ]);
  const byId = new Map<string, FirebaseFirestore.DocumentData>();
  [...hosted.docs, ...joined.docs].forEach((doc) => byId.set(doc.id, publicMeeting(doc.data())));
  const all = [...byId.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const start = (page - 1) * limit;
  sendPaginated(res, all.slice(start, start + limit), page, limit, all.length);
};

export const getMeetingById = async (req: AuthenticatedRequest, res: Response) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const snap = await getMeeting(req.params.meetingId);
  if (!snap.exists) return sendError(res, 'Meeting not found', 404);
  const data = snap.data()!;
  const isMember = data.hostId === uid || data.participants?.includes(uid) || data.waitingRoom?.includes(uid);
  if (!isMember) return sendError(res, 'You are not a participant in this meeting', 403);
  sendSuccess(res, publicMeeting(data));
};

export const getMeetingByCode = async (req: AuthenticatedRequest, res: Response) => {
  const code = String(req.params.code).trim().toLowerCase();
  const snap = await db.collection('meetings').where('code', '==', code).limit(1).get();
  if (snap.empty) return sendError(res, 'Meeting not found', 404);
  const data = snap.docs[0].data();
  sendSuccess(res, {
    id: data.id,
    code: data.code,
    title: data.title,
    hostName: data.hostName,
    status: data.status,
    isLocked: data.isLocked,
    maxParticipants: data.maxParticipants,
    waitingRoomEnabled: data.settings?.waitingRoomEnabled ?? true,
  });
};

export const joinMeeting = async (req: AuthenticatedRequest, res: Response) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const ref = db.collection('meetings').doc(req.params.meetingId);
  let result: { status: string; meeting: FirebaseFirestore.DocumentData } | null = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error('Meeting not found'), { statusCode: 404 });
    const data = snap.data()!;
    if (data.bannedUsers?.includes(uid)) throw Object.assign(new Error('You are banned from this meeting'), { statusCode: 403 });
    if (data.status === 'ended' || data.status === 'cancelled') throw Object.assign(new Error('Meeting is no longer active'), { statusCode: 409 });
    if (data.hostId === uid || data.participants?.includes(uid)) {
      result = { status: 'active', meeting: publicMeeting(data) };
      return;
    }
    if (data.isLocked) throw Object.assign(new Error('Meeting is locked'), { statusCode: 423 });
    if (data.password && !verifyPassword(String(req.body.password || ''), data.password)) {
      throw Object.assign(new Error('Invalid meeting password'), { statusCode: 401 });
    }
    const participantCount = Array.isArray(data.participants) ? data.participants.length : 0;
    if (participantCount >= Number(data.maxParticipants || 100)) throw Object.assign(new Error('Meeting is full'), { statusCode: 409 });

    const waiting = Boolean(data.settings?.waitingRoomEnabled || data.settings?.hostApprovalRequired);
    const nextStatus = waiting ? 'waiting' : 'active';
    const participantRef = ref.collection('participants').doc(uid);
    tx.set(participantRef, {
      uid, meetingId: ref.id, displayName: req.user?.displayName || req.user?.email || 'Participant',
      role: 'participant', status: nextStatus, audioEnabled: !data.settings?.muteOnEntry,
      videoEnabled: Boolean(data.settings?.videoOnEntry), screenSharing: false, handRaised: false,
      connectionQuality: 'good', joinedAt: FieldValue.serverTimestamp(),
    });
    if (waiting) {
      tx.update(ref, { waitingRoom: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp() });
    } else {
      tx.update(ref, { participants: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp(), ...(data.status === 'scheduled' ? { status: 'active', startedAt: FieldValue.serverTimestamp() } : {}) });
    }
    result = { status: nextStatus, meeting: publicMeeting({ ...data, id: ref.id }) };
  });

  if (!result) return sendError(res, 'Unable to join meeting', 500);
  sendSuccess(res, result, result.status === 'waiting' ? 'Waiting for host approval' : 'Joined meeting');
};

export const leaveMeeting = async (req: AuthenticatedRequest, res: Response) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const ref = db.collection('meetings').doc(req.params.meetingId);
  const participantRef = ref.collection('participants').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return sendError(res, 'Meeting not found', 404);
  const data = snap.data()!;
  if (data.hostId === uid) return sendError(res, 'Host must end the meeting instead of leaving', 400);
  if (!data.participants?.includes(uid) && !data.waitingRoom?.includes(uid)) return sendError(res, 'You are not in this meeting', 404);
  const batch = db.batch();
  batch.update(ref, { participants: FieldValue.arrayRemove(uid), waitingRoom: FieldValue.arrayRemove(uid), updatedAt: FieldValue.serverTimestamp() });
  batch.set(participantRef, { status: 'left', leftAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  sendSuccess(res, null, 'Left meeting');
};

export const endMeeting = async (req: AuthenticatedRequest, res: Response) => {
  const ref = db.collection('meetings').doc(req.params.meetingId);
  const snap = await ref.get();
  if (!snap.exists) return sendError(res, 'Meeting not found', 404);
  const data = snap.data()!;
  if (data.status === 'ended') return sendSuccess(res, publicMeeting(data), 'Meeting already ended');
  await ref.update({ status: 'ended', endedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), participants: [], waitingRoom: [] });
  const participants = await ref.collection('participants').where('status', 'in', ['active', 'waiting']).get();
  const batch = db.batch();
  participants.docs.forEach((doc) => batch.update(doc.ref, { status: 'left', leftAt: FieldValue.serverTimestamp() }));
  if (!participants.empty) await batch.commit();
  sendSuccess(res, { id: ref.id, status: 'ended' }, 'Meeting ended');
};

export const listParticipants = async (req: AuthenticatedRequest, res: Response) => {
  const uid = requireUser(req, res);
  if (!uid) return;
  const snap = await getMeeting(req.params.meetingId);
  if (!snap.exists) return sendError(res, 'Meeting not found', 404);
  const data = snap.data()!;
  if (data.hostId !== uid && !data.participants?.includes(uid)) return sendError(res, 'Access denied', 403);
  const participants = await snap.ref.collection('participants').where('status', 'in', ['active', 'waiting']).get();
  sendSuccess(res, participants.docs.map((doc) => doc.data()));
};

export const meetingAnalytics = async (req: AuthenticatedRequest, res: Response) => {
  const snap = await getMeeting(req.params.meetingId);
  if (!snap.exists) return sendError(res, 'Meeting not found', 404);
  const data = snap.data()!;
  const participants = await snap.ref.collection('participants').get();
  const records = participants.docs.map((doc) => doc.data());
  const joined = records.filter((p) => p.joinedAt).length;
  const left = records.filter((p) => p.leftAt).length;
  const duration = data.startedAt && data.endedAt ? Math.max(0, data.endedAt.toMillis() - data.startedAt.toMillis()) : null;
  sendSuccess(res, { meetingId: snap.id, status: data.status, participantCount: joined, activeParticipants: records.filter((p) => p.status === 'active').length, completedParticipants: left, durationMs: duration });
};

export const approveParticipant = async (req: AuthenticatedRequest, res: Response) => moveWaitingParticipant(req, res, true);
export const denyParticipant = async (req: AuthenticatedRequest, res: Response) => moveWaitingParticipant(req, res, false);

const moveWaitingParticipant = async (req: AuthenticatedRequest, res: Response, approve: boolean) => {
  const ref = db.collection('meetings').doc(req.params.meetingId);
  const userId = req.params.userId;
  const snap = await ref.get();
  if (!snap.exists) return sendError(res, 'Meeting not found', 404);
  const data = snap.data()!;
  if (!data.waitingRoom?.includes(userId)) return sendError(res, 'Participant is not waiting', 404);
  const participantRef = ref.collection('participants').doc(userId);
  const batch = db.batch();
  batch.update(ref, { waitingRoom: FieldValue.arrayRemove(userId), ...(approve ? { participants: FieldValue.arrayUnion(userId) } : {}), updatedAt: FieldValue.serverTimestamp() });
  batch.set(participantRef, { status: approve ? 'active' : 'removed', ...(approve ? {} : { leftAt: FieldValue.serverTimestamp() }) }, { merge: true });
  await batch.commit();
  sendSuccess(res, { userId, status: approve ? 'active' : 'denied' });
};

export const removeParticipant = async (req: AuthenticatedRequest, res: Response) => {
  const ref = db.collection('meetings').doc(req.params.meetingId);
  const userId = req.params.userId;
  const snap = await ref.get();
  if (!snap.exists) return sendError(res, 'Meeting not found', 404);
  if (snap.data()!.hostId === userId) return sendError(res, 'Host cannot be removed', 400);
  await ref.update({ participants: FieldValue.arrayRemove(userId), waitingRoom: FieldValue.arrayRemove(userId), updatedAt: FieldValue.serverTimestamp() });
  await ref.collection('participants').doc(userId).set({ status: 'removed', leftAt: FieldValue.serverTimestamp() }, { merge: true });
  sendSuccess(res, { userId, status: 'removed' });
};

export const banParticipant = async (req: AuthenticatedRequest, res: Response) => {
  const ref = db.collection('meetings').doc(req.params.meetingId);
  const userId = req.params.userId;
  const snap = await ref.get();
  if (!snap.exists) return sendError(res, 'Meeting not found', 404);
  if (snap.data()!.hostId === userId) return sendError(res, 'Host cannot be banned', 400);
  await ref.update({ bannedUsers: FieldValue.arrayUnion(userId), participants: FieldValue.arrayRemove(userId), waitingRoom: FieldValue.arrayRemove(userId), updatedAt: FieldValue.serverTimestamp() });
  await ref.collection('participants').doc(userId).set({ status: 'banned', leftAt: FieldValue.serverTimestamp() }, { merge: true });
  sendSuccess(res, { userId, status: 'banned' });
};

export const lockMeeting = async (req: AuthenticatedRequest, res: Response) => {
  const locked = Boolean(req.body.locked);
  const ref = db.collection('meetings').doc(req.params.meetingId);
  await ref.update({ isLocked: locked, updatedAt: FieldValue.serverTimestamp() });
  sendSuccess(res, { locked }, locked ? 'Meeting locked' : 'Meeting unlocked');
};

export const updateMeetingSettings = async (req: AuthenticatedRequest, res: Response) => {
  const allowed = Object.keys(DEFAULT_SETTINGS) as Array<keyof MeetingSettings>;
  const incoming = req.body.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body;
  const updates: Partial<MeetingSettings> = {};
  for (const key of allowed) if (typeof incoming[key] === 'boolean') updates[key] = incoming[key];
  if (!Object.keys(updates).length) return sendError(res, 'No valid settings supplied', 422);
  const ref = db.collection('meetings').doc(req.params.meetingId);
  const snap = await ref.get();
  if (!snap.exists) return sendError(res, 'Meeting not found', 404);
  const current = snap.data()!.settings || DEFAULT_SETTINGS;
  const settings = { ...DEFAULT_SETTINGS, ...current, ...updates };
  await ref.update({ settings, recordingEnabled: settings.recordingEnabled, updatedAt: FieldValue.serverTimestamp() });
  sendSuccess(res, settings, 'Meeting settings updated');
};
