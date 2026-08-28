import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types';
import { db } from '../config/firebase';
import { sendError, sendPaginated, sendSuccess } from '../utils/response';

const r = Router();
r.use(authenticate);

r.get('/', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const uid = req.user!.uid;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const page = Math.max(1, Number(req.query.page || 1));
  const snap = await db.collection('notifications').where('userId', '==', uid).limit(200).get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => {
    const at = a.createdAt?.toMillis?.() ?? 0; const bt = b.createdAt?.toMillis?.() ?? 0; return bt - at;
  });
  const start = (page - 1) * limit;
  sendPaginated(res, items.slice(start, start + limit), page, limit, items.length);
}));

r.put('/read-all', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const snap = await db.collection('notifications').where('userId', '==', req.user!.uid).where('read', '==', false).limit(500).get();
  if (!snap.empty) {
    const batch = db.batch(); snap.docs.forEach((d) => batch.update(d.ref, { read: true, readAt: FieldValue.serverTimestamp() })); await batch.commit();
  }
  sendSuccess(res, { updated: snap.size }, 'Notifications marked as read');
}));

r.put('/:notificationId/read', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const ref = db.collection('notifications').doc(req.params.notificationId);
  const snap = await ref.get();
  if (!snap.exists) return sendError(res, 'Notification not found', 404);
  if (snap.data()!.userId !== req.user!.uid) return sendError(res, 'Access denied', 403);
  await ref.update({ read: true, readAt: FieldValue.serverTimestamp() });
  sendSuccess(res, { id: ref.id, read: true });
}));

r.delete('/:notificationId', asyncHandler(async (req: AuthenticatedRequest, res) => {
  const ref = db.collection('notifications').doc(req.params.notificationId);
  const snap = await ref.get();
  if (!snap.exists) return sendError(res, 'Notification not found', 404);
  if (snap.data()!.userId !== req.user!.uid) return sendError(res, 'Access denied', 403);
  await ref.delete();
  sendSuccess(res, null, 'Notification deleted');
}));

export default r;
