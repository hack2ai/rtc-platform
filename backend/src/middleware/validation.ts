import { body, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';

export const sanitizeInput = (req: Request, _res: Response, next: NextFunction): void => {
  const strip = (v: any): any => typeof v === 'string' ? v.replace(/<[^>]*>/g, '') : (typeof v === 'object' && v ? Object.fromEntries(Object.entries(v).map(([k,val]) => [k, strip(val)])) : v);
  if (req.body) req.body = strip(req.body);
  next();
};

export const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { sendError(res, errors.array()[0].msg, 422); return; }
  next();
};

export const validateCreateMeeting = [
  body('title').trim().notEmpty().isLength({ max: 100 }).withMessage('Title required (max 100 chars)'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('scheduledAt').optional().isISO8601(),
  body('password').optional().isLength({ min: 4, max: 32 }),
  body('maxParticipants').optional().isInt({ min: 2, max: 250 }),
];

export const validateJoinMeeting = [
  body('code').optional().isString(),
  body('password').optional().isString(),
];

export const validateMessage = [
  body('content').trim().notEmpty().isLength({ max: 5000 }).withMessage('Message required'),
  body('type').isIn(['text', 'file', 'image']),
];

export const validateUpdateProfile = [
  body('displayName').optional().trim().isLength({ min: 2, max: 50 }),
  body('photoURL').optional().isURL(),
];
