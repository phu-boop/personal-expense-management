import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import type { AuthPayload } from '../types.js';

export const signToken = (payload: AuthPayload) => {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
};

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    const error = new Error('Unauthorized');
    (error as any).statusCode = 401;
    return next(error);
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
    (req as any).user = payload;
    return next();
  } catch (error) {
    const err = new Error('Invalid or expired token');
    (err as any).statusCode = 401;
    return next(err);
  }
};
