import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { db, auth } from '../config/firebase';
import { asyncHandler } from '../middleware/errorHandler';
import { sendSuccess, sendError } from '../utils/response';
import admin from '../config/firebase';
const r = Router();
r.use(authenticate, requireAdmin);
r.get('/users', asyncHandler(async (_req: any, res: any) => {
  const snap = await db.collection('users').orderBy('createdAt','desc').limit(50).get();
  sendSuccess(res,{ users: snap.docs.map(d=>({id:d.id,...d.data()})) });
}));
r.get('/analytics', asyncHandler(async (_req: any, res: any) => {
  const [u,m,msg,f,active] = await Promise.all([
    db.collection('users').count().get(), db.collection('meetings').count().get(),
    db.collection('messages').count().get(), db.collection('files').count().get(),
    db.collection('meetings').where('status','==','active').count().get(),
  ]);
  sendSuccess(res,{ analytics:{ totalUsers:u.data().count, totalMeetings:m.data().count, totalMessages:msg.data().count, totalFiles:f.data().count, activeMeetings:active.data().count } });
}));
r.put('/users/:uid/role', asyncHandler(async (req: any, res: any) => {
  const { role } = req.body;
  if (!['admin','moderator','user'].includes(role)) { sendError(res,'Invalid role',400); return; }
  await db.collection('users').doc(req.params.uid).update({ role, updatedAt:admin.firestore.FieldValue.serverTimestamp() });
  sendSuccess(res,{updated:true});
}));
r.put('/users/:uid/disable', asyncHandler(async (req: any, res: any) => {
  await auth.updateUser(req.params.uid,{disabled:req.body.disabled});
  sendSuccess(res,{disabled:req.body.disabled});
}));
export default r;
