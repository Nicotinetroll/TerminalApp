import { Router, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware.js';

const router = Router();

// ── Rate limiting for code login ──
const codeAttempts = new Map<string, number[]>();

function checkIpRate(ip: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const attempts = (codeAttempts.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (attempts.length >= maxAttempts) return false;
  attempts.push(now);
  codeAttempts.set(ip, attempts);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of codeAttempts) {
    const f = times.filter((t) => now - t < 15 * 60 * 1000);
    if (f.length === 0) codeAttempts.delete(ip);
    else codeAttempts.set(ip, f);
  }
}, 30 * 60 * 1000);

// POST /api/auth/code-login — login via access code (no auth needed)
router.post('/auth/code-login', (req: AuthRequest, res: Response): void => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkIpRate(ip, 10, 15 * 60 * 1000)) {
    res.status(429).json({ error: 'too many attempts. chill for a bit, script kiddie.' });
    return;
  }

  const { code } = req.body;

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'code is required.' });
    return;
  }

  const accessCode = db.prepare(
    'SELECT id, code, name, permissions, expires_hours, is_active FROM access_codes WHERE code = ?'
  ).get(code.trim()) as {
    id: number;
    code: string;
    name: string;
    permissions: string;
    expires_hours: number;
    is_active: number;
  } | undefined;

  if (!accessCode) {
    res.status(401).json({ error: 'invalid code. you sure you got the right one?' });
    return;
  }

  if (!accessCode.is_active) {
    res.status(403).json({ error: 'this code got deactivated. rip.' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server misconfigured: missing JWT_SECRET' });
    return;
  }

  // Generate temp username
  const tempSuffix = crypto.randomBytes(2).toString('hex');
  const tempUsername = `temp_${tempSuffix}`;

  let permissions: string[];
  try {
    permissions = JSON.parse(accessCode.permissions) as string[];
  } catch {
    permissions = [];
  }

  try {
    // Create temp user
    const insertUser = db.prepare(
      'INSERT INTO users (username, password_hash, role, code_id) VALUES (?, ?, ?, ?)'
    );
    const insertFilesystem = db.prepare(
      "INSERT INTO user_filesystems (user_id, filesystem) VALUES (?, '{}')"
    );
    const insertSettings = db.prepare(
      "INSERT INTO user_settings (user_id, theme_name, command_history) VALUES (?, 'claude', '[]')"
    );

    const createTempUser = db.transaction(() => {
      // password_hash is empty — code users can't login with password
      const result = insertUser.run(tempUsername, '', 'code', accessCode.id);
      const userId = result.lastInsertRowid as number;
      insertFilesystem.run(userId);
      insertSettings.run(userId);
      return userId;
    });

    const userId = createTempUser();

    const token = jwt.sign(
      {
        userId,
        username: tempUsername,
        role: 'code',
        permissions,
        codeId: accessCode.id,
      },
      secret,
      { expiresIn: `${accessCode.expires_hours}h` }
    );

    res.json({
      token,
      user: {
        id: userId,
        username: tempUsername,
        role: 'code',
        permissions,
      },
    });
  } catch (err: unknown) {
    console.error('code-login error:', err);
    res.status(500).json({ error: 'failed to create temp user. shit happens.' });
  }
});

// ── Admin: Access Code CRUD ──

// GET /api/codes — list all codes with usage count
router.get('/codes', authMiddleware, adminMiddleware, (_req: AuthRequest, res: Response): void => {
  const codes = db.prepare(`
    SELECT ac.*,
      (SELECT COUNT(*) FROM users u WHERE u.code_id = ac.id AND u.role = 'code') as temp_user_count
    FROM access_codes ac
    ORDER BY ac.created_at DESC
  `).all() as Array<{
    id: number;
    code: string;
    name: string;
    permissions: string;
    expires_hours: number;
    is_active: number;
    created_by: number;
    created_at: string;
    temp_user_count: number;
  }>;

  res.json({ codes });
});

// POST /api/codes — create a new code
router.post('/codes', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response): void => {
  const { name, code, permissions, expires_hours } = req.body;

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required.' });
    return;
  }

  const finalCode = (code && typeof code === 'string' && code.trim())
    ? code.trim()
    : crypto.randomBytes(4).toString('hex');

  const finalPermissions = Array.isArray(permissions) ? JSON.stringify(permissions) : '[]';
  const finalExpires = typeof expires_hours === 'number' && expires_hours > 0 ? expires_hours : 24;

  try {
    const result = db.prepare(
      'INSERT INTO access_codes (code, name, permissions, expires_hours, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(finalCode, name.trim(), finalPermissions, finalExpires, req.user!.userId);

    const created = db.prepare('SELECT * FROM access_codes WHERE id = ?').get(result.lastInsertRowid) as Record<string, unknown>;

    res.status(201).json({ code: created });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'that code already exists. be more creative.' });
    } else {
      res.status(500).json({ error: 'failed to create code.' });
    }
  }
});

// PUT /api/codes/:id — update a code
router.put('/codes/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response): void => {
  const id = parseInt(req.params['id'] as string, 10);
  const { name, permissions, expires_hours, is_active } = req.body;

  const existing = db.prepare('SELECT id FROM access_codes WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'code not found.' });
    return;
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined && typeof name === 'string') {
    updates.push('name = ?');
    values.push(name.trim());
  }
  if (permissions !== undefined && Array.isArray(permissions)) {
    updates.push('permissions = ?');
    values.push(JSON.stringify(permissions));
  }
  if (expires_hours !== undefined && typeof expires_hours === 'number') {
    updates.push('expires_hours = ?');
    values.push(expires_hours);
  }
  if (is_active !== undefined) {
    updates.push('is_active = ?');
    values.push(is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'nothing to update.' });
    return;
  }

  values.push(id);
  db.prepare(`UPDATE access_codes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare(`
    SELECT ac.*,
      (SELECT COUNT(*) FROM users u WHERE u.code_id = ac.id AND u.role = 'code') as temp_user_count
    FROM access_codes ac WHERE ac.id = ?
  `).get(id);

  res.json({ code: updated });
});

// DELETE /api/codes/:id — delete code + cascade all temp users
router.delete('/codes/:id', authMiddleware, adminMiddleware, (req: AuthRequest, res: Response): void => {
  const id = parseInt(req.params['id'] as string, 10);

  const existing = db.prepare('SELECT id, name FROM access_codes WHERE id = ?').get(id) as { id: number; name: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'code not found.' });
    return;
  }

  const deletCodeAndUsers = db.transaction(() => {
    // Find all temp users with this code
    const tempUsers = db.prepare('SELECT id FROM users WHERE code_id = ? AND role = ?').all(id, 'code') as { id: number }[];

    for (const u of tempUsers) {
      db.prepare('DELETE FROM user_filesystems WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    }

    db.prepare('DELETE FROM access_codes WHERE id = ?').run(id);

    return tempUsers.length;
  });

  const deletedUsers = deletCodeAndUsers();

  res.json({ ok: true, deleted_users: deletedUsers });
});

export default router;
