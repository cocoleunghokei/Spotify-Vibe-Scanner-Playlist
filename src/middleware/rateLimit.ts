import { Request, Response, NextFunction } from 'express';

const store = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 10; // per minute per IP for vibe generation

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  let entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  } else {
    entry.count++;
  }
  if (entry.count > MAX_REQUESTS) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }
  next();
}
