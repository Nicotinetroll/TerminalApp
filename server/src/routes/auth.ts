import { Router, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { authMiddleware, AuthRequest } from '../middleware.js';
import { getSetting } from '../constants.js';

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

/** Create the side-tables that make a pending user "real" */
export function activateUser(userId: number, localPart: string, role: string): void {
  db.prepare("INSERT OR IGNORE INTO user_filesystems (user_id, filesystem) VALUES (?, '{}')").run(userId);
  db.prepare("INSERT OR IGNORE INTO user_settings (user_id, theme_name, command_history) VALUES (?, 'claude', '[]')").run(userId);
  try {
    db.prepare('INSERT INTO email_addresses (user_id, address) VALUES (?, ?)').run(userId, localPart.split("@")[0]!);
  } catch { /* address may already exist */ }
  db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(role, userId);
}

// POST /api/auth/login — email + password
router.post('/login', (req: AuthRequest, res: Response): void => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkIpRate(loginAttempts, ip, 5, 15 * 60 * 1000)) {
    res.status(429).json({ error: 'too many login attempts. chill for 15 min, hacker.' });
    return;
  }

  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required.' });
    return;
  }

  // Accept local part or full email — always resolve to @mynig.ga
  const fullEmail = typeof email === 'string' && !email.includes('@')
    ? `${email.toLowerCase().trim()}@mynig.ga`
    : String(email).toLowerCase().trim();

  const user = db.prepare('SELECT id, email, password_hash, role, created_at FROM users WHERE email = ?').get(fullEmail) as
    | { id: number; email: string; password_hash: string | null; role: string; created_at: string }
    | undefined;

  if (!user) {
    res.status(401).json({ error: 'invalid email or password.' });
    return;
  }

  if (user.role === 'pending') {
    res.status(403).json({ error: 'account setup incomplete. finish registration first.' });
    return;
  }

  if (!user.password_hash) {
    res.status(403).json({ error: 'account setup incomplete. finish registration first.' });
    return;
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'invalid email or password.' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server misconfigured: missing JWT_SECRET' });
    return;
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    secret,
    { expiresIn: '7d' }
  );

  // Check if user has an active subscription
  const sub = db.prepare(
    'SELECT id FROM subscriptions WHERE user_id = ? AND is_active = 1 LIMIT 1'
  ).get(user.id);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      created_at: user.created_at,
      has_subscription: !!sub,
    },
  });
});

// POST /api/auth/logout
router.post('/logout', (_req: AuthRequest, res: Response): void => {
  res.json({ ok: true });
});

// GET /api/auth/session
router.get('/session', authMiddleware, (req: AuthRequest, res: Response): void => {
  const row = db.prepare('SELECT id, email, role, created_at FROM users WHERE id = ?').get(req.user!.userId) as
    | { id: number; email: string; role: string; created_at: string }
    | undefined;

  if (!row) {
    res.status(401).json({ error: 'User not found. ghost account?' });
    return;
  }

  if (row.role === 'pending') {
    res.status(403).json({ error: 'account setup incomplete. finish registration first.' });
    return;
  }

  // Check if user has an active subscription
  const sub = db.prepare(
    'SELECT id FROM subscriptions WHERE user_id = ? AND is_active = 1 LIMIT 1'
  ).get(row.id);

  // Fetch saved theme from user_settings (for cross-device persistence)
  const settingsRow = db.prepare('SELECT theme_name FROM user_settings WHERE user_id = ?').get(row.id) as
    | { theme_name: string | null } | undefined;

  const result: Record<string, unknown> = {
    id: row.id,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
    has_subscription: !!sub,
    theme_name: settingsRow?.theme_name ?? null,
  };

  // Auto-refresh token if role changed in DB (e.g. subscription upgrade/downgrade)
  if (row.role !== req.user!.role) {
    const secret = process.env.JWT_SECRET;
    if (secret) {
      const newToken = jwt.sign(
        { userId: row.id, email: row.email, role: row.role },
        secret,
        { expiresIn: '7d' }
      );
      result.token = newToken;
    }
  }

  res.json({ user: result });
});

// GET /api/auth/check-email/:localPart — check if email is available
router.get('/check-email/:localPart', (req: AuthRequest, res: Response): void => {
  const raw = req.params.localPart;
  if (!raw || typeof raw !== 'string') {
    res.status(400).json({ available: false, error: 'missing local part' });
    return;
  }

  const localPart = raw.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (localPart.length < 2 || localPart.length > 30) {
    res.status(400).json({ available: false, error: localPart.length < 2 ? 'too short (min 2 chars)' : 'too long (max 30 chars)' });
    return;
  }
  if (/^[._-]|[._-]$/.test(localPart)) {
    res.status(400).json({ available: false, error: "can't start or end with . _ -" });
    return;
  }

  const email = `${localPart}@mynig.ga`;
  const existing = db.prepare('SELECT id, role, created_at FROM users WHERE email = ?').get(email) as
    | { id: number; role: string; created_at: string }
    | undefined;

  if (!existing) {
    res.json({ available: true, localPart });
    return;
  }

  // Stale pending users (older than 1 hour) — clean up and treat as available
  if (existing.role === 'pending') {
    const createdAt = new Date(existing.created_at + 'Z').getTime();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    if (createdAt < oneHourAgo) {
      db.prepare('DELETE FROM payments WHERE user_id = ?').run(existing.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
      res.json({ available: true, localPart });
      return;
    }
  }

  res.json({ available: false, localPart });
});

// POST /api/auth/register — create account (pending until payment or invite-with-sub)
router.post('/register', (req: AuthRequest, res: Response): void => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkIpRate(registerAttempts, ip, 3, 60 * 60 * 1000)) {
    res.status(429).json({ error: 'too many registrations. what are you, a bot farm?' });
    return;
  }

  const { email, invite } = req.body;

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email is required.' });
    return;
  }

  // Accept either just localPart or full @mynig.ga email
  const localPart = email.includes('@')
    ? email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '')
    : email.toLowerCase().replace(/[^a-z0-9._-]/g, '');

  if (localPart.length < 2 || localPart.length > 30) {
    res.status(400).json({ error: localPart.length < 2 ? 'name too short (min 2 chars)' : 'name too long (max 30 chars)' });
    return;
  }
  if (/^[._-]|[._-]$/.test(localPart)) {
    res.status(400).json({ error: "name can't start or end with . _ -" });
    return;
  }

  const fullEmail = `${localPart}@mynig.ga`;

  // Validate invite if provided
  let inviteRow: {
    id: string; role: string; max_uses: number; use_count: number;
    expires_at: string; subscription_type: string | null; subscription_days: number | null;
  } | undefined;

  if (invite && typeof invite === 'string') {
    inviteRow = db.prepare(
      'SELECT id, role, max_uses, use_count, expires_at, subscription_type, subscription_days FROM invite_links WHERE id = ?'
    ).get(invite) as typeof inviteRow;

    if (!inviteRow) {
      res.status(400).json({ error: 'invalid invite code.' });
      return;
    }

    const expiresAt = new Date(inviteRow.expires_at + 'Z').getTime();
    if (Date.now() > expiresAt) {
      res.status(400).json({ error: 'invite code expired.' });
      return;
    }

    if (inviteRow.use_count >= inviteRow.max_uses) {
      res.status(400).json({ error: 'invite code fully used.' });
      return;
    }
  }

  try {
    // Clean up stale pending user with same email first
    const stalePending = db.prepare(
      "SELECT id FROM users WHERE email = ? AND role = 'pending' AND created_at < datetime('now', '-1 hour')"
    ).get(fullEmail) as { id: number } | undefined;
    if (stalePending) {
      db.prepare('DELETE FROM payments WHERE user_id = ?').run(stalePending.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(stalePending.id);
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'Server misconfigured: missing JWT_SECRET' });
      return;
    }

    // Invite with subscription info → activate immediately
    if (inviteRow && inviteRow.subscription_type && inviteRow.subscription_days) {
      const subRole = inviteRow.subscription_type.includes('premium') ? 'premium' : 'basic';

      const userId = db.transaction(() => {
        const result = db.prepare(
          'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
        ).run(localPart, fullEmail, null, subRole);
        const uid = result.lastInsertRowid as number;

        // Activate: create filesystem, settings, email address
        activateUser(uid, localPart, subRole);

        // Create subscription
        const expiresAt = new Date(Date.now() + inviteRow!.subscription_days! * 24 * 60 * 60 * 1000)
          .toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

        db.prepare(`
          INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active)
          VALUES (?, ?, datetime('now'), ?, 1)
        `).run(uid, inviteRow!.subscription_type!.replace('sub_', ''), expiresAt);

        // Increment invite use_count
        db.prepare('UPDATE invite_links SET use_count = use_count + 1 WHERE id = ?').run(inviteRow!.id);

        return uid;
      })();

      const jwtToken = jwt.sign(
        { userId, email: fullEmail, role: subRole },
        secret,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        token: jwtToken,
        user: {
          id: userId,
          email: fullEmail,
          role: subRole,
          has_subscription: true,
        },
      });
      return;
    }

    // Default: create pending user (no filesystem, settings, or email address yet)
    const insertUser = db.prepare(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)'
    );

    const userId = db.transaction(() => {
      const result = insertUser.run(localPart, fullEmail, null, 'pending');
      const uid = result.lastInsertRowid as number;

      // If invite exists (but no subscription), increment use_count
      if (inviteRow) {
        db.prepare('UPDATE invite_links SET use_count = use_count + 1 WHERE id = ?').run(inviteRow.id);
      }

      return uid;
    })();

    const jwtToken = jwt.sign(
      { userId, email: fullEmail, role: 'pending' },
      secret,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token: jwtToken,
      user: {
        id: userId,
        email: fullEmail,
        role: 'pending',
        has_subscription: false,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      if (err.message.includes('users.email')) {
        res.status(409).json({ error: 'this name is already taken. try another one.' });
      } else {
        res.status(409).json({ error: 'name already taken. try something else.' });
      }
    } else {
      console.error('[auth] register error:', err);
      res.status(500).json({ error: 'registration failed. shit happens.' });
    }
  }
});

// POST /api/auth/setup-password — set password for newly registered users (no current password)
router.post('/setup-password', authMiddleware, (req: AuthRequest, res: Response): void => {
  const { password } = req.body;

  if (!password || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'password must be at least 6 characters.' });
    return;
  }

  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.user!.userId) as
    | { id: number; password_hash: string | null }
    | undefined;

  if (!user) {
    res.status(404).json({ error: 'user not found.' });
    return;
  }

  if (user.password_hash !== null) {
    res.status(400).json({ error: 'password already set. use the change password feature instead.' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, user.id);

  res.json({ ok: true });
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

// POST /api/auth/invite — any logged-in subscribed user can create a user-role invite
router.post('/invite', authMiddleware, (req: AuthRequest, res: Response): void => {
  if (req.user!.role === 'user') {
    res.status(403).json({ error: 'you need a subscription to invite people.' });
    return;
  }

  const { max_uses: rawMax } = req.body as { max_uses?: number };
  const maxUses = Math.min(Math.max(1, Math.floor(Number(rawMax) || 1)), 100);

  const inviteExpiryHours = getSetting('invite_expiry_hours', 1);
  const expiresAt = new Date(Date.now() + inviteExpiryHours * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = crypto.randomBytes(8).toString('hex');
    try {
      db.prepare(
        'INSERT INTO invite_links (id, created_by, role, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)'
      ).run(code, req.user!.userId, 'user', expiresAt, maxUses);

      res.status(201).json({
        invite: {
          id: code,
          role: 'user',
          expires_at: expiresAt,
          max_uses: maxUses,
          use_count: 0,
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

// GET /api/auth/stats — public user count
router.get('/stats', (_req: AuthRequest, res: Response): void => {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number } | undefined;
  res.json({ total_users: row?.count ?? 0 });
});

export default router;
