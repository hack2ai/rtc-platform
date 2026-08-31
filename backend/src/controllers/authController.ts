import { Response } from 'express';
import { db, auth } from '../config/firebase';
import { AuthenticatedRequest } from '../types';
import { sendSuccess, sendError } from '../utils/response';
import { asyncHandler } from '../middleware/errorHandler';
import admin from '../config/firebase';

const defaultSettings = {
  audioEnabled: true,
  videoEnabled: true,
  noiseSuppressionEnabled: true,
  virtualBackgroundEnabled: false,
  theme: 'system',
  language: 'en',
  notifications: {
    meetingReminders: true,
    chatMessages: true,
    participantJoins: true,
    participantLeaves: false,
  },
};

export const register = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { uid, email, displayName } = req.user!;
  const ref = db.collection('users').doc(uid);
  const existing = await ref.get();

  if (existing.exists) {
    await ref.set({
      email: email || existing.data()?.email || '',
      displayName: displayName || existing.data()?.displayName || email?.split('@')[0] || 'User',
      isOnline: true,
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    sendSuccess(res, { user: { ...existing.data(), uid, isOnline: true } }, 'Profile synchronized');
    return;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const user = {
    uid,
    email: email || '',
    displayName: displayName || email?.split('@')[0] || 'User',
    role: 'user',
    isOnline: true,
    settings: defaultSettings,
    lastSeen: now,
    createdAt: now,
    updatedAt: now,
  };

  await ref.create(user);
  sendSuccess(res, { user }, 'Registered', 201);
});

export const getProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const doc = await db.collection('users').doc(req.user!.uid).get();
  if (!doc.exists) { sendError(res, 'User not found', 404); return; }
  sendSuccess(res, { user: doc.data() });
});

export const updateProfile = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { displayName, photoURL } = req.body;
  const updates: Record<string, unknown> = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (displayName) updates.displayName = displayName;
  if (photoURL) updates.photoURL = photoURL;
  await db.collection('users').doc(req.user!.uid).update(updates);
  if (displayName) await auth.updateUser(req.user!.uid, { displayName });
  sendSuccess(res, { updated: true }, 'Profile updated');
});

export const updateSettings = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  await db.collection('users').doc(req.user!.uid).update({ settings: req.body.settings, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  sendSuccess(res, { updated: true });
});

export const logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  await db.collection('users').doc(req.user!.uid).update({ isOnline: false, lastSeen: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await auth.revokeRefreshTokens(req.user!.uid);
  sendSuccess(res, { loggedOut: true });
});

export const deleteAccount = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  await db.collection('users').doc(req.user!.uid).delete();
  await auth.deleteUser(req.user!.uid);
  sendSuccess(res, { deleted: true });
});
