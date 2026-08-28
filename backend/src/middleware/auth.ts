import { Response, NextFunction } from 'express';
import { auth, db } from '../config/firebase';
import { AuthenticatedRequest } from '../types';
import { sendError } from '../utils/response';
import { logger } from '../utils/logger';

export const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) { sendError(res, 'No token provided', 401); return; }
    const token = header.split('Bearer ')[1];
    const decoded = await auth.verifyIdToken(token);
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    req.user = { uid: decoded.uid, email: decoded.email || '', displayName: decoded.name, role: userDoc.data()?.role || 'user' };
    next();
  } catch (e) { logger.error('Auth error:', e); sendError(res, 'Invalid token', 401); }
};

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'admin') { sendError(res, 'Admin required', 403); return; }
  next();
};

export const requireHost = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const doc = await db.collection('meetings').doc(req.params.meetingId).get();
    if (!doc.exists) { sendError(res, 'Meeting not found', 404); return; }
    if (doc.data()?.hostId !== req.user?.uid) { sendError(res, 'Host required', 403); return; }
    next();
  } catch (e) { sendError(res, 'Authorization error', 500); }
};
