import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { sendError } from '../utils/response';

const r = Router();
r.use(authenticate);
const notImplemented = asyncHandler(async (_req: Request, res: Response) => {
  sendError(res, 'Recording service is not implemented in this release', 501);
});
r.post('/meetings/:meetingId/recordings/start', notImplemented);
r.post('/recordings/:recordingId/stop', notImplemented);
r.put('/recordings/:recordingId/finalize', notImplemented);
r.get('/recordings', notImplemented);
r.delete('/recordings/:recordingId', notImplemented);
export default r;
