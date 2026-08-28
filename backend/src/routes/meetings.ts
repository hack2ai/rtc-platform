import { Router } from 'express';
import { authenticate, requireHost } from '../middleware/auth';
import { meetingCreateLimiter } from '../middleware/rateLimiter';
import { sanitizeInput, validate, validateCreateMeeting, validateJoinMeeting } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';
import {
  approveParticipant,
  banParticipant,
  createMeeting,
  denyParticipant,
  endMeeting,
  getIceServers,
  getMeetingByCode,
  getMeetingById,
  joinMeeting,
  leaveMeeting,
  listMeetings,
  listParticipants,
  lockMeeting,
  meetingAnalytics,
  removeParticipant,
  updateMeetingSettings,
} from '../controllers/meetingController';

const r = Router();
const wrap = (handler: any) => asyncHandler(handler);

r.use(authenticate);
r.get('/ice-servers', wrap(getIceServers));
r.get('/code/:code', wrap(getMeetingByCode));
r.post('/', meetingCreateLimiter, sanitizeInput, validateCreateMeeting, validate, wrap(createMeeting));
r.get('/', wrap(listMeetings));
r.get('/:meetingId', wrap(getMeetingById));
r.post('/:meetingId/join', sanitizeInput, validateJoinMeeting, validate, wrap(joinMeeting));
r.delete('/:meetingId/leave', wrap(leaveMeeting));
r.post('/:meetingId/end', requireHost, wrap(endMeeting));
r.get('/:meetingId/participants', wrap(listParticipants));
r.get('/:meetingId/analytics', requireHost, wrap(meetingAnalytics));
r.post('/:meetingId/approve/:userId', requireHost, wrap(approveParticipant));
r.post('/:meetingId/deny/:userId', requireHost, wrap(denyParticipant));
r.post('/:meetingId/remove/:userId', requireHost, wrap(removeParticipant));
r.post('/:meetingId/ban/:userId', requireHost, wrap(banParticipant));
r.put('/:meetingId/lock', requireHost, sanitizeInput, wrap(lockMeeting));
r.put('/:meetingId/settings', requireHost, sanitizeInput, wrap(updateMeetingSettings));

export default r;
