import { Router, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware.js';
import { getLogs } from '../logger.js';

const router = Router();

// All admin routes require auth + admin role
router.use(authMiddleware);
router.use(adminMiddleware);

interface UserRow {
  id: number;
  username: string;
  role: string;
  created_at: string;
  updated_at: string;
}

// GET /api/admin/users
router.get('/users', (_req: AuthRequest, res: Response): void => {
  const users = db.prepare(
    'SELECT id, username, role, created_at, updated_at FROM users ORDER BY id'
  ).all() as UserRow[];

  res.json({ users });
});

// POST /api/admin/users
router.post('/users', (req: AuthRequest, res: Response): void => {
  const { username, password, role } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  if (typeof username !== 'string' || username.length < 2 || username.length > 64) {
    res.status(400).json({ error: 'username must be 2-64 characters. even admins have standards.' });
    return;
  }

  if (typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'password must be at least 6 characters. come on.' });
    return;
  }

  const validRoles = ['admin', 'user', 'guest'];
  const userRole = validRoles.includes(role) ? role : 'user';

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

    const createUser = db.transaction(() => {
      const result = insertUser.run(username, passwordHash, userRole);
      const userId = result.lastInsertRowid;
      insertFilesystem.run(userId);
      insertSettings.run(userId);
      return userId;
    });

    const userId = createUser();

    const user = db.prepare(
      'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?'
    ).get(userId) as UserRow;

    res.status(201).json({ user });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: `Username "${username}" already exists.` });
    } else {
      res.status(500).json({ error: 'Failed to create user.' });
    }
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', (req: AuthRequest, res: Response): void => {
  const targetId = parseInt(req.params['id'] as string ?? '', 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: 'Invalid user ID.' });
    return;
  }

  const { username, password, role } = req.body;

  // Cannot change own role
  if (req.user!.userId === targetId && role && role !== req.user!.role) {
    res.status(400).json({ error: "You can't change your own role, dumbass." });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!existing) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  try {
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (username) {
      updates.push('username = ?');
      values.push(username);
    }
    if (password) {
      updates.push('password_hash = ?');
      values.push(bcrypt.hashSync(password, 10));
    }
    if (role) {
      updates.push('role = ?');
      values.push(role);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update.' });
      return;
    }

    updates.push("updated_at = datetime('now')");
    values.push(targetId);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const user = db.prepare(
      'SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?'
    ).get(targetId) as UserRow;

    res.json({ user });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: `Username "${username}" already exists.` });
    } else {
      res.status(500).json({ error: 'Failed to update user.' });
    }
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req: AuthRequest, res: Response): void => {
  const targetId = parseInt(req.params['id'] as string ?? '', 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: 'Invalid user ID.' });
    return;
  }

  // Cannot delete self
  if (req.user!.userId === targetId) {
    res.status(400).json({ error: "You can't delete yourself, dumbass." });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!existing) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  try {
    const deleteUser = db.transaction(() => {
      db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM user_filesystems WHERE user_id = ?').run(targetId);
      db.prepare('UPDATE invite_links SET used_by = NULL, used_at = NULL WHERE used_by = ?').run(targetId);
      db.prepare('DELETE FROM invite_links WHERE created_by = ?').run(targetId);
      db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    });

    deleteUser();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete user. something is clinging on.' });
  }
});

// ── Invite Links ──

interface InviteRow {
  id: string;
  created_by: number;
  role: string;
  expires_at: string;
  used_by: number | null;
  used_at: string | null;
  created_at: string;
  created_by_username: string;
  used_by_username: string | null;
}

// POST /api/admin/invites — create invite link
router.post('/invites', (req: AuthRequest, res: Response): void => {
  const validRoles = ['admin', 'user', 'guest'];
  const role = validRoles.includes(req.body.role) ? req.body.role : 'user';

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

  db.prepare(
    'INSERT INTO invite_links (id, created_by, role, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, req.user!.userId, role, expiresAt);

  res.status(201).json({
    invite: {
      id: token,
      role,
      expires_at: expiresAt,
      url: `https://mynig.ga/?invite=${token}`,
    },
  });
});

// GET /api/admin/invites — list all invite links
router.get('/invites', (_req: AuthRequest, res: Response): void => {
  const invites = db.prepare(`
    SELECT
      i.id, i.role, i.expires_at, i.used_by, i.used_at, i.created_at,
      c.username AS created_by_username,
      u.username AS used_by_username
    FROM invite_links i
    JOIN users c ON c.id = i.created_by
    LEFT JOIN users u ON u.id = i.used_by
    ORDER BY i.created_at DESC
  `).all() as InviteRow[];

  res.json({ invites });
});

// DELETE /api/admin/invites/:id — revoke an invite link
router.delete('/invites/:id', (req: AuthRequest, res: Response): void => {
  const token = req.params['id'] as string;
  const existing = db.prepare('SELECT id FROM invite_links WHERE id = ?').get(token);
  if (!existing) {
    res.status(404).json({ error: 'Invite not found.' });
    return;
  }
  db.prepare('DELETE FROM invite_links WHERE id = ?').run(token);
  res.json({ ok: true });
});

// ── Stats Dashboard ──

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]!}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface RoleCount { role: string; count: number }
interface RecentUser { username: string; role: string; created_at: string }
interface StorageUser { username: string; bytes: number }
interface GameCount { game: string; count: number }

// GET /api/admin/stats
router.get('/stats', (_req: AuthRequest, res: Response): void => {
  // Server info
  const mem = process.memoryUsage();
  const uptimeSec = process.uptime();
  const server = {
    uptime_seconds: Math.floor(uptimeSec),
    uptime_human: formatUptime(uptimeSec),
    memory_rss_mb: Math.round(mem.rss / 1048576 * 10) / 10,
    memory_heap_used_mb: Math.round(mem.heapUsed / 1048576 * 10) / 10,
    memory_heap_total_mb: Math.round(mem.heapTotal / 1048576 * 10) / 10,
    node_version: process.version,
    platform: process.platform,
    pid: process.pid,
  };

  // Users
  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const byRole = db.prepare('SELECT role, COUNT(*) as count FROM users GROUP BY role').all() as RoleCount[];
  const roleMap: Record<string, number> = {};
  for (const r of byRole) roleMap[r.role] = r.count;
  const recentUsers = db.prepare(
    'SELECT username, role, created_at FROM users ORDER BY id DESC LIMIT 5'
  ).all() as RecentUser[];

  // Storage (filesystem sizes)
  const storageRows = db.prepare(`
    SELECT u.username, LENGTH(uf.filesystem) as bytes
    FROM user_filesystems uf
    JOIN users u ON u.id = uf.user_id
    ORDER BY bytes DESC
    LIMIT 5
  `).all() as StorageUser[];
  const totalStorage = (db.prepare('SELECT COALESCE(SUM(LENGTH(filesystem)), 0) as total FROM user_filesystems').get() as { total: number }).total;

  // Chat
  const totalRooms = (db.prepare('SELECT COUNT(*) as c FROM chat_rooms').get() as { c: number }).c;
  const totalMessages = (db.prepare('SELECT COUNT(*) as c FROM chat_messages').get() as { c: number }).c;
  const activeRooms24h = (db.prepare(
    "SELECT COUNT(DISTINCT room_id) as c FROM chat_messages WHERE created_at >= datetime('now', '-1 day')"
  ).get() as { c: number }).c;

  // Mail
  const totalAddresses = (db.prepare('SELECT COUNT(*) as c FROM email_addresses').get() as { c: number }).c;
  const totalEmails = (db.prepare('SELECT COUNT(*) as c FROM emails').get() as { c: number }).c;
  const emailsToday = (db.prepare(
    "SELECT COUNT(*) as c FROM emails WHERE created_at >= date('now')"
  ).get() as { c: number }).c;

  // Games
  const totalScores = (db.prepare('SELECT COUNT(*) as c FROM game_scores').get() as { c: number }).c;
  const byGame = db.prepare(
    'SELECT game, COUNT(*) as count FROM game_scores GROUP BY game ORDER BY count DESC'
  ).all() as GameCount[];

  // Health
  const health = server.memory_rss_mb > 512 ? 'degraded' : 'ok';

  res.json({
    server,
    users: {
      total: totalUsers,
      by_role: roleMap,
      recent: recentUsers,
    },
    storage: {
      total_bytes: totalStorage,
      total_human: formatBytes(totalStorage),
      top_users: storageRows.map(r => ({
        username: r.username,
        bytes: r.bytes,
        human: formatBytes(r.bytes),
      })),
    },
    chat: {
      total_rooms: totalRooms,
      total_messages: totalMessages,
      active_rooms_24h: activeRooms24h,
    },
    mail: {
      total_addresses: totalAddresses,
      total_emails: totalEmails,
      emails_today: emailsToday,
    },
    games: {
      total_scores: totalScores,
      by_game: byGame,
    },
    health,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/admin/logs — real-time server logs
router.get('/logs', (req: AuthRequest, res: Response): void => {
  const since = parseInt(req.query['since'] as string || '0', 10);
  res.json({ logs: getLogs(isNaN(since) ? 0 : since) });
});

export default router;
