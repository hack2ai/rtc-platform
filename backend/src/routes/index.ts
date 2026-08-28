import { Router } from 'express';
import authRoutes from './auth';
import meetingRoutes from './meetings';
import chatRoutes from './chat';
import recordingRoutes from './recordings';
import notificationRoutes from './notifications';
import adminRoutes from './admin';
import fileRoutes from './files';
import { db } from '../config/firebase';

const router = Router();
router.use('/auth', authRoutes);
router.use('/meetings', meetingRoutes);
router.use('/chat', chatRoutes);
router.use('/recordings', recordingRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);
router.use('/files', fileRoutes);

router.get('/health', (_req, res) => res.json({ status:'ok', service:'rtc-platform-api', timestamp:new Date().toISOString() }));
router.get('/ready', async (_req, res) => {
  try { await db.collection('health').doc('probe').get(); res.json({ status:'ready', checks:{ firestore:'ok' }, timestamp:new Date().toISOString() }); }
  catch { res.status(503).json({ status:'not_ready', checks:{ firestore:'error' }, timestamp:new Date().toISOString() }); }
});
export default router;
