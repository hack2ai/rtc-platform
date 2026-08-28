import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { sendError } from '../utils/response';

const r = Router();
r.use(authenticate);
const notImplemented = asyncHandler(async (_req: Request, res: Response) => {
  sendError(res, 'Notification service is not implemented in this release', 501);
});
r.get('/', notImplemented);
r.put('/read-all', notImplemented);
r.put('/:notificationId/read', notImplemented);
r.delete('/:notificationId', notImplemented);
export default r;
