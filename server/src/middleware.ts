import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId: number;
  email: string;
  role: string;
  permissions?: string[];
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof req.query?.token === 'string') {
    token = req.query.token;
  } else if (typeof req.body?._token === 'string') {
    // sendBeacon can't set headers — token passed in body for beforeunload saves
    token = req.body._token;
  }

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({ error: 'Server misconfigured: missing JWT_SECRET' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as AuthPayload;
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      permissions: decoded.permissions,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
