import { Router, Request, Response } from 'express';
import authRoutes from './auth';
import meetingRoutes from './meetings';
import chatRoutes from './chat';
import recordingRoutes from './recordings';
import notificationRoutes from './notifications';
import adminRoutes from './admin';
import { asyncHandler } from '../middleware/errorHandler';
import { sendError } from '../utils/response';

const router = Router();
router.use('/auth', authRoutes);
router.use('/meetings', meetingRoutes);
router.use('/chat', chatRoutes);
router.use('/recordings', recordingRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);
router.use('/files', asyncHandler(async (_req: Request, res: Response) => {
  sendError(res, 'File sharing service is not implemented in this release', 501);
}));
router.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
export default router;
