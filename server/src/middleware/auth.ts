import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

export interface AuthRequest extends Request {
  user?: {
    id: mongoose.Types.ObjectId;
    email: string;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as any;
    req.user = { id: new mongoose.Types.ObjectId(decoded.id), email: decoded.email };
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};
