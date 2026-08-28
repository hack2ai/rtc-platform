import rateLimit from 'express-rate-limit';
const msg = (m: string) => ({ success: false, error: m });
export const apiLimiter = rateLimit({ windowMs: 15*60*1000, max: 300, message: msg('Too many requests') });
export const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, message: msg('Too many auth attempts'), skipSuccessfulRequests: true });
export const meetingCreateLimiter = rateLimit({ windowMs: 60*60*1000, max: 30, message: msg('Meeting creation limit reached') });
export const uploadLimiter = rateLimit({ windowMs: 60*60*1000, max: 50, message: msg('Upload limit reached') });
