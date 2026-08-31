import { Response, NextFunction } from 'express';
import { auth, db } from '../config/firebase';
import { AuthenticatedRequest } from '../types';
import { sendError } from '../utils/response';
import { logger } from '../utils/logger';

export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      sendError(res, 'No token provided', 401);
      return;
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      sendError(res, 'No token provided', 401);
      return;
    }

    // Token verification must not perform a Firestore read. The previous
    // implementation fetched users/{uid} on every authenticated request,
    // which consumed Firestore read quota and could make a valid Firebase
    // token look invalid when the database quota was exhausted.
    const decoded = await auth.verifyIdToken(token, false);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || '',
      displayName: decoded.name,
      role: 'user',
    };
    next();
  } catch (error: any) {
    const code = typeof error?.code === 'string' ? error.code : 'unknown';
    const message = typeof error?.message === 'string' ? error.message : 'Unknown Firebase token verification error';
    logger.error(`Firebase ID token verification failed [${code}]: ${message}`);

    if (code === 'auth/id-token-expired') {
      sendError(res, 'Firebase session expired. Please sign in again.', 401);
      return;
    }
    if (code === 'auth/id-token-revoked') {
      sendError(res, 'Firebase session revoked. Please sign in again.', 401);
      return;
    }
    if (code === 'auth/argument-error' || code === 'auth/invalid-id-token') {
      sendError(res, 'Firebase ID token is malformed or invalid.', 401);
      return;
    }

    sendError(res, `Invalid token (${code})`, 401);
  }
};

export const requireAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const doc = await db.collection('users').doc(req.user!.uid).get();
    if (doc.data()?.role !== 'admin') {
      sendError(res, 'Admin required', 403);
      return;
    }
    req.user!.role = 'admin';
    next();
  } catch (error) {
    logger.error('Admin role lookup failed', error);
    sendError(res, 'Unable to verify administrator role', 503);
  }
};

export const requireHost = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const doc = await db.collection('meetings').doc(req.params.meetingId).get();
    if (!doc.exists) { sendError(res, 'Meeting not found', 404); return; }
    if (doc.data()?.hostId !== req.user?.uid) { sendError(res, 'Host required', 403); return; }
    next();
  } catch (e) { sendError(res, 'Authorization error', 500); }
};
