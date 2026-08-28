import { Router, Request, Response } from 'express';
import { authenticate, requireHost } from '../middleware/auth';
import { meetingCreateLimiter } from '../middleware/rateLimiter';
import { sanitizeInput, validate, validateCreateMeeting } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';
import { sendError } from '../utils/response';

const r = Router();
const notImplemented = asyncHandler(async (_req: Request, res: Response) => {
  sendError(res, 'Meeting service is not implemented in this release', 501);
});

r.use(authenticate);
r.get('/ice-servers', notImplemented);
r.get('/code/:code', notImplemented);
r.post('/', meetingCreateLimiter, sanitizeInput, validateCreateMeeting, validate, notImplemented);
r.get('/', notImplemented);
r.get('/:meetingId', notImplemented);
r.post('/:meetingId/join', sanitizeInput, notImplemented);
r.delete('/:meetingId/leave', notImplemented);
r.post('/:meetingId/end', requireHost, notImplemented);
r.get('/:meetingId/participants', notImplemented);
r.get('/:meetingId/analytics', requireHost, notImplemented);
r.post('/:meetingId/approve/:userId', requireHost, notImplemented);
r.post('/:meetingId/deny/:userId', requireHost, notImplemented);
r.post('/:meetingId/remove/:userId', requireHost, notImplemented);
r.post('/:meetingId/ban/:userId', requireHost, notImplemented);
r.put('/:meetingId/lock', requireHost, notImplemented);
r.put('/:meetingId/settings', requireHost, sanitizeInput, notImplemented);

export default r;
