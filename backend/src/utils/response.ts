import { Response } from 'express';
export const sendSuccess = <T>(res: Response, data: T, message?: string, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data, message });
export const sendError = (res: Response, error: string, statusCode = 500) =>
  res.status(statusCode).json({ success: false, error });
export const sendPaginated = <T>(res: Response, data: T[], page: number, limit: number, total: number) =>
  res.status(200).json({ success: true, data, pagination: { page, limit, total, hasMore: page * limit < total } });
