import { body, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';

const MAX_DEPTH = 8;
const stripTags = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return value.replace(/[<>]/g, '').trim();
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripTags(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripTags(item, depth + 1)]));
};

export const sanitizeInput = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body && typeof req.body === 'object') req.body = stripTags(req.body) as Record<string, unknown>;
  next();
};

export const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendError(res, errors.array()[0].msg, 422);
    return;
  }
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
  body('code').optional().isString().isLength({ min: 3, max: 32 }),
  body('password').optional().isString().isLength({ min: 4, max: 32 }),
];

export const validateMessage = [
  body('content').trim().notEmpty().isLength({ max: 5000 }).withMessage('Message required'),
  body('type').isIn(['text', 'file', 'image']),
];

export const validateUpdateProfile = [
  body('displayName').optional().trim().isLength({ min: 2, max: 50 }),
  body('photoURL').optional().isURL(),
];
