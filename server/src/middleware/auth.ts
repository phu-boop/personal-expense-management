import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';

const JWT_SECRET = config.JWT_SECRET?.trim();

if (!JWT_SECRET || JWT_SECRET.includes('replace_with_') || JWT_SECRET.length < 32) {
  console.warn('JWT_SECRET is missing or insecure. Requests will fail authentication until a real 32+ character secret is configured.');
}

export interface AuthRequest extends Request {
  user?: {
    id: mongoose.Types.ObjectId;
    email: string;
    tenantId?: mongoose.Types.ObjectId;
  };
}


export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const headerToken = req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  const token = headerToken || queryToken;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    if (!decoded?.id || !decoded?.email) {
      return res.status(401).json({ message: 'Invalid token payload' });
    }

    if (!decoded?.tenantId) {
      return res.status(401).json({ message: 'Tenant context is required' });
    }

    req.user = {
      id: new mongoose.Types.ObjectId(decoded.id),
      email: decoded.email,
      tenantId: new mongoose.Types.ObjectId(decoded.tenantId),
    };

    if (!req.user.tenantId) {
      return res.status(401).json({ message: 'Tenant context is required' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

export const requireReadAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || !req.user.tenantId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  next();
};

export const requireWriteAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || !req.user.tenantId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  next();
};
