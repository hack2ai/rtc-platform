import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { sendError } from '../utils/response';

export class AppError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction): void => {
  logger.error(`${req.method} ${req.path}`, err?.message || err);
  if (err instanceof AppError) {
    sendError(res, err.message, err.statusCode);
    return;
  }
  sendError(res, process.env.NODE_ENV === 'production' ? 'Internal server error' : err?.message || 'Internal server error', 500);
};

export const notFound = (req: Request, res: Response): void => {
  sendError(res, `Route ${req.originalUrl} not found`, 404);
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res, next)).catch(next);
