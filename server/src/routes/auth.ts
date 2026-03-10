import { Router, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { authMiddleware, AuthRequest } from '../middleware.js';

const router = Router();

// ── Rate limiting ──
const loginAttempts = new Map<string, number[]>();
const registerAttempts = new Map<string, number[]>();

function checkIpRate(map: Map<string, number[]>, ip: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const attempts = (map.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (attempts.length >= maxAttempts) return false;
  attempts.push(now);
  map.set(ip, attempts);
  return true;
}

// cleanup stale entries every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of loginAttempts) { const f = times.filter((t) => now - t < 15 * 60 * 1000); if (f.length === 0) loginAttempts.delete(ip); else loginAttempts.set(ip, f); }
  for (const [ip, times] of registerAttempts) { const f = times.filter((t) => now - t < 60 * 60 * 1000); if (f.length === 0) registerAttempts.delete(ip); else registerAttempts.set(ip, f); }
}, 30 * 60 * 1000);

// POST /api/auth/login
router.post('/login', (req: AuthRequest, res: Response): void => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkIpRate(loginAttempts, ip, 5, 15 * 60 * 1000)) {
    res.status(429).json({ error: 'too many login attempts. chill for 15 min, hacker.' });
    return;
  }

  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const user = db.prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?').get(username) as
    | { id: number; username: string; password_hash: string; role: string; created_at: string }
    | undefined;

  if (!user) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server misconfigured: missing JWT_SECRET' });
    return;
  }

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    secret,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, created_at: user.created_at },
  });
});

// POST /api/auth/logout
router.post('/logout', (_req: AuthRequest, res: Response): void => {
  res.json({ ok: true });
});

// GET /api/auth/session
router.get('/session', authMiddleware, (req: AuthRequest, res: Response): void => {
  const row = db.prepare('SELECT id, username, role, created_at, code_id FROM users WHERE id = ?').get(req.user!.userId) as
    | { id: number; username: string; role: string; created_at: string; code_id: number | null }
    | undefined;

  if (!row) {
    res.status(401).json({ error: 'User not found. ghost account?' });
    return;
  }

  // For code users, include permissions from their access code
  const result: Record<string, unknown> = {
    id: row.id,
    username: row.username,
    role: row.role,
    created_at: row.created_at,
  };

  if (row.role === 'code' && row.code_id) {
    result.permissions = req.user!.permissions ?? [];
  }

  res.json({ user: result });
});

// POST /api/auth/register — register via invite link
router.post('/register', (req: AuthRequest, res: Response): void => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkIpRate(registerAttempts, ip, 3, 60 * 60 * 1000)) {
    res.status(429).json({ error: 'too many registrations. what are you, a bot farm?' });
    return;
  }

  const { token, username, password } = req.body;

  if (!token || !username || !password) {
    res.status(400).json({ error: 'token, username, and password are required.' });
    return;
  }

  if (typeof username !== 'string' || username.length < 2 || username.length > 64) {
    res.status(400).json({ error: 'username must be 2-64 characters. even we have standards.' });
    return;
  }

  if (typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'password must be at least 6 characters. we have standards. low ones, but still.' });
    return;
  }

  // Validate invite token
  const invite = db.prepare(
    "SELECT id, role, expires_at, used_by FROM invite_links WHERE id = ?"
  ).get(token) as { id: string; role: string; expires_at: string; used_by: number | null } | undefined;

  if (!invite) {
    res.status(404).json({ error: 'invalid invite link. nice try tho.' });
    return;
  }

  if (invite.used_by !== null) {
    res.status(410).json({ error: 'this invite already got claimed. you snooze you lose.' });
    return;
  }

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;
  if (now > invite.expires_at) {
    res.status(410).json({ error: 'invite expired. shoulda been faster.' });
    return;
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 10);

    const insertUser = db.prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    );
    const insertFilesystem = db.prepare(
      "INSERT INTO user_filesystems (user_id, filesystem) VALUES (?, '{}')"
    );
    const insertSettings = db.prepare(
      "INSERT INTO user_settings (user_id, theme_name, command_history) VALUES (?, 'claude', '[]')"
    );
    const markUsed = db.prepare(
      "UPDATE invite_links SET used_by = ?, used_at = datetime('now') WHERE id = ?"
    );

    const registerUser = db.transaction(() => {
      const result = insertUser.run(username, passwordHash, invite.role);
      const userId = result.lastInsertRowid as number;
      insertFilesystem.run(userId);
      insertSettings.run(userId);
      markUsed.run(userId, token);
      return userId;
    });

    const userId = registerUser();

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'Server misconfigured: missing JWT_SECRET' });
      return;
    }

    const jwtToken = jwt.sign(
      { userId, username, role: invite.role },
      secret,
      { expiresIn: '7d' }
    );

    const user = db.prepare(
      'SELECT id, username, role, created_at FROM users WHERE id = ?'
    ).get(userId) as { id: number; username: string; role: string; created_at: string };

    res.status(201).json({
      token: jwtToken,
      user: { id: user.id, username: user.username, role: user.role, created_at: user.created_at },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: `"${username}" is already taken. be more creative.` });
    } else {
      res.status(500).json({ error: 'registration failed. shit happens.' });
    }
  }
});

// PUT /api/auth/password — change own password
router.put('/password', authMiddleware, (req: AuthRequest, res: Response): void => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required.' });
    return;
  }

  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    res.status(400).json({ error: 'new password must be at least 6 characters. we have standards. low ones, but still.' });
    return;
  }

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.userId) as
    | { password_hash: string }
    | undefined;

  if (!user) {
    res.status(401).json({ error: 'user not found. are you a ghost?' });
    return;
  }

  const valid = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!valid) {
    res.status(403).json({ error: 'wrong current password. nice try tho.' });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hash, req.user!.userId);

  res.json({ ok: true });
});

// POST /api/auth/invite — any logged-in non-guest user can create a user-role invite
router.post('/invite', authMiddleware, (req: AuthRequest, res: Response): void => {
  if (req.user!.role === 'guest') {
    res.status(403).json({ error: 'guests can\'t invite people. upgrade first, freeloader.' });
    return;
  }

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${req.user!.username}-inv-${String(crypto.randomInt(100000, 999999))}`;
    try {
      db.prepare(
        'INSERT INTO invite_links (id, created_by, role, expires_at) VALUES (?, ?, ?, ?)'
      ).run(code, req.user!.userId, 'user', expiresAt);

      res.status(201).json({
        invite: {
          id: code,
          role: 'user',
          expires_at: expiresAt,
          url: `https://mynig.ga/?invite=${code}`,
        },
      });
      return;
    } catch {
      if (attempt === 4) {
        res.status(500).json({ error: 'failed to generate invite code. try again.' });
        return;
      }
    }
  }
});

export default router;
