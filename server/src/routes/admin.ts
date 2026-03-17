import { Router, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { execSync } from 'child_process';
import db from '../db.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware.js';
import { getLogs } from '../logger.js';
import { logAudit } from '../audit.js';

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

  const validRoles = ['admin', 'club', 'classic', 'user', 'guest'];
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

    logAudit({
      adminId: req.user!.userId, adminUsername: req.user!.username,
      action: 'user.create', targetType: 'user', targetId: Number(userId), targetName: username,
      details: { role: userRole },
    });

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
      const validRoles = ['admin', 'club', 'classic', 'user', 'guest'];
      if (!validRoles.includes(role)) { res.status(400).json({ error: 'invalid role.' }); return; }
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

    logAudit({
      adminId: req.user!.userId, adminUsername: req.user!.username,
      action: 'user.update', targetType: 'user', targetId: targetId, targetName: user.username,
      details: { username, role, passwordChanged: !!password },
    });

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
      // Clean up all user-associated data
      db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM user_filesystems WHERE user_id = ?').run(targetId);
      db.prepare('UPDATE invite_links SET used_by = NULL, used_at = NULL WHERE used_by = ?').run(targetId);
      db.prepare('DELETE FROM invite_links WHERE created_by = ?').run(targetId);
      // Casino
      db.prepare('DELETE FROM slots_balance WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM slots_history WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM coinflip_history WHERE user_id = ?').run(targetId);
      // Games
      db.prepare('DELETE FROM game_scores WHERE user_id = ?').run(targetId);
      // AI
      db.prepare("DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE user_id = ?)").run(targetId);
      db.prepare('DELETE FROM ai_conversations WHERE user_id = ?').run(targetId);
      // Mail
      db.prepare("DELETE FROM email_attachments WHERE email_id IN (SELECT id FROM emails WHERE owner_id = ?)").run(targetId);
      db.prepare('DELETE FROM emails WHERE owner_id = ?').run(targetId);
      db.prepare('DELETE FROM email_addresses WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM contacts WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM mail_folders WHERE user_id = ?').run(targetId);
      // Nigdit
      db.prepare("DELETE FROM nigdit_votes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM nigdit_comments WHERE user_id = ?)").run(targetId);
      db.prepare("DELETE FROM nigdit_votes WHERE target_type = 'post' AND target_id IN (SELECT id FROM nigdit_posts WHERE user_id = ?)").run(targetId);
      db.prepare('DELETE FROM nigdit_votes WHERE user_id = ?').run(targetId);
      db.prepare("DELETE FROM nigdit_awards WHERE comment_id IN (SELECT id FROM nigdit_comments WHERE user_id = ?)").run(targetId);
      db.prepare("DELETE FROM nigdit_awards WHERE post_id IN (SELECT id FROM nigdit_posts WHERE user_id = ?)").run(targetId);
      db.prepare('DELETE FROM nigdit_awards WHERE from_user_id = ?').run(targetId);
      db.prepare('DELETE FROM nigdit_bookmarks WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM nigdit_notifications WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM nigdit_poll_votes WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM nigdit_attachments WHERE post_id IN (SELECT id FROM nigdit_posts WHERE user_id = ?)').run(targetId);
      db.prepare('DELETE FROM nigdit_comments WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM nigdit_posts WHERE user_id = ?').run(targetId);
      db.prepare('DELETE FROM nigdit_aura WHERE user_id = ?').run(targetId);
      // Memes
      db.prepare('DELETE FROM meme_votes WHERE user_id = ?').run(targetId);
      db.prepare("DELETE FROM meme_votes WHERE meme_id IN (SELECT id FROM memes WHERE user_id = ?)").run(targetId);
      db.prepare('DELETE FROM memes WHERE user_id = ?').run(targetId);
      // Chat
      db.prepare('DELETE FROM chat_messages WHERE sender_id = ?').run(targetId);
      db.prepare('DELETE FROM chat_participants WHERE user_id = ?').run(targetId);
      // Pastes
      db.prepare('DELETE FROM pastes WHERE user_id = ?').run(targetId);
      // Shop
      db.prepare('DELETE FROM shop_purchases WHERE user_id = ?').run(targetId);
      // Sessions
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
      // Finally, the user
      db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    });

    deleteUser();

    logAudit({
      adminId: req.user!.userId, adminUsername: req.user!.username,
      action: 'user.delete', targetType: 'user', targetId: targetId,
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete user. something is clinging on.' });
  }
});

// GET /api/admin/users/:id/details — detailed user info (sub, NB, storage)
router.get('/users/:id/details', (req: AuthRequest, res: Response): void => {
  const targetId = parseInt(req.params['id'] as string ?? '', 10);
  if (isNaN(targetId)) { res.status(400).json({ error: 'Invalid user ID.' }); return; }

  const user = db.prepare('SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?').get(targetId) as UserRow | undefined;
  if (!user) { res.status(404).json({ error: 'User not found.' }); return; }

  // NB balance
  const balRow = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(targetId) as { bytebucks: number } | undefined;
  const niggabytes = balRow?.bytebucks ?? 0;

  // Active subscription
  const activeSub = db.prepare(
    'SELECT id, type, starts_at, expires_at, is_active, auto_renew, payment_id FROM subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(targetId) as { id: number; type: string; starts_at: string; expires_at: string | null; is_active: number; auto_renew: number; payment_id: string | null } | undefined;

  // Sub history
  const subHistory = db.prepare(
    'SELECT id, type, starts_at, expires_at, is_active, auto_renew FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 10'
  ).all(targetId) as { id: number; type: string; starts_at: string; expires_at: string | null; is_active: number; auto_renew: number }[];

  // Payment history
  const payments = db.prepare(
    'SELECT id, type, amount_eur, nb_amount, status, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
  ).all(targetId) as { id: string; type: string; amount_eur: number; nb_amount: number; status: string; created_at: string }[];

  // Storage
  const fsRow = db.prepare('SELECT LENGTH(filesystem) as bytes FROM user_filesystems WHERE user_id = ?').get(targetId) as { bytes: number } | undefined;
  const storageBytes = fsRow?.bytes ?? 0;

  // Email addresses
  const emails = db.prepare('SELECT address FROM email_addresses WHERE user_id = ?').all(targetId) as { address: string }[];

  res.json({
    user,
    niggabytes,
    active_subscription: activeSub ?? null,
    subscription_history: subHistory,
    payments,
    storage_bytes: storageBytes,
    email_addresses: emails.map(e => e.address),
  });
});

// PUT /api/admin/users/:id/subscription — admin manage subscription
router.put('/users/:id/subscription', (req: AuthRequest, res: Response): void => {
  const targetId = parseInt(req.params['id'] as string ?? '', 10);
  if (isNaN(targetId)) { res.status(400).json({ error: 'Invalid user ID.' }); return; }

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!existing) { res.status(404).json({ error: 'User not found.' }); return; }

  const { action, type, days } = req.body as { action?: string; type?: string; days?: number };

  if (action === 'grant') {
    // Grant a new subscription
    const validTypes = ['classic_1m', 'classic_3m', 'classic_12m', 'club_1m', 'club_3m', 'club_12m'];
    if (!type || !validTypes.includes(type)) {
      res.status(400).json({ error: 'invalid sub type' });
      return;
    }

    const daysMap: Record<string, number> = {
      classic_1m: 30, classic_3m: 90, classic_12m: 365,
      club_1m: 30, club_3m: 90, club_12m: 365,
    };
    const subDays = days ?? daysMap[type]!;
    const role = type.startsWith('club') ? 'club' : 'classic';

    const roleLevel: Record<string, number> = { guest: 0, code: 0, user: 1, classic: 2, club: 3, admin: 4 };

    db.transaction(() => {
      // Deactivate old subs
      db.prepare('UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(targetId);

      const expiresAt = new Date(Date.now() + subDays * 24 * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

      db.prepare(`
        INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active)
        VALUES (?, ?, datetime('now'), ?, 1)
      `).run(targetId, type, expiresAt);

      // Upgrade role if needed
      const currentRole = (db.prepare('SELECT role FROM users WHERE id = ?').get(targetId) as { role: string } | undefined)?.role ?? 'user';
      const currentLevel = roleLevel[currentRole] ?? 0;
      const newLevel = roleLevel[role] ?? 0;
      if (newLevel > currentLevel) {
        db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(role, targetId);
      }
    })();

    res.json({ ok: true, message: `granted ${type} subscription (${subDays} days)` });
  } else if (action === 'revoke') {
    // Revoke all active subs
    db.transaction(() => {
      db.prepare('UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(targetId);

      // Downgrade role if needed (don't touch admin)
      const roleLevel: Record<string, number> = { guest: 0, code: 0, user: 1, classic: 2, club: 3, admin: 4 };
      const currentRole = (db.prepare('SELECT role FROM users WHERE id = ?').get(targetId) as { role: string } | undefined)?.role ?? 'user';
      const level = roleLevel[currentRole] ?? 0;
      if (level >= 2 && level < 4) {
        db.prepare("UPDATE users SET role = 'user', updated_at = datetime('now') WHERE id = ?").run(targetId);
      }
    })();

    res.json({ ok: true, message: 'subscription revoked' });
  } else if (action === 'toggle_auto_renew') {
    const activeSub = db.prepare(
      'SELECT id, auto_renew FROM subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(targetId) as { id: number; auto_renew: number } | undefined;

    if (!activeSub) {
      res.status(400).json({ error: 'no active subscription' });
      return;
    }

    const newVal = activeSub.auto_renew ? 0 : 1;
    db.prepare('UPDATE subscriptions SET auto_renew = ? WHERE id = ?').run(newVal, activeSub.id);
    res.json({ ok: true, message: `auto-renew ${newVal ? 'enabled' : 'disabled'}` });
  } else {
    res.status(400).json({ error: 'invalid action. use grant, revoke, or toggle_auto_renew' });
  }
});

// PUT /api/admin/users/:id/niggabytes — set NB balance
router.put('/users/:id/niggabytes', (req: AuthRequest, res: Response): void => {
  const targetId = parseInt(req.params['id'] as string ?? '', 10);
  if (isNaN(targetId)) { res.status(400).json({ error: 'Invalid user ID.' }); return; }

  const { amount } = req.body as { amount?: number };
  if (amount == null || typeof amount !== 'number') {
    res.status(400).json({ error: 'amount required' });
    return;
  }

  const existing = db.prepare('SELECT user_id FROM slots_balance WHERE user_id = ?').get(targetId);
  if (existing) {
    db.prepare('UPDATE slots_balance SET bytebucks = ? WHERE user_id = ?').run(amount, targetId);
  } else {
    db.prepare('INSERT INTO slots_balance (user_id, bytebucks) VALUES (?, ?)').run(targetId, amount);
  }

  res.json({ ok: true, message: `NB balance set to ${amount}` });
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
  max_uses: number;
  use_count: number;
}

// POST /api/admin/invites — create invite link
router.post('/invites', (req: AuthRequest, res: Response): void => {
  const validRoles = ['admin', 'club', 'classic', 'user', 'guest'];
  const role = validRoles.includes(req.body.role) ? req.body.role : 'user';
  const rawMax = req.body.max_uses;
  const maxUses = Math.min(Math.max(1, Math.floor(Number(rawMax) || 1)), 1000);

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${req.user!.username}-inv-${String(crypto.randomInt(100000, 999999))}`;
    try {
      db.prepare(
        'INSERT INTO invite_links (id, created_by, role, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)'
      ).run(code, req.user!.userId, role, expiresAt, maxUses);

      res.status(201).json({
        invite: {
          id: code,
          role,
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

// GET /api/admin/invites — list all invite links
router.get('/invites', (_req: AuthRequest, res: Response): void => {
  const invites = db.prepare(`
    SELECT
      i.id, i.role, i.expires_at, i.used_by, i.used_at, i.created_at,
      i.max_uses, i.use_count,
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
  if (bytes < 0) return '-' + formatBytes(-bytes);
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
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

  // IMAP
  const imapTotal = (db.prepare("SELECT COUNT(*) as c FROM service_logs WHERE service = 'imap'").get() as { c: number }).c;
  const imapLogins = (db.prepare("SELECT COUNT(*) as c FROM service_logs WHERE service = 'imap' AND message LIKE 'login:%'").get() as { c: number }).c;
  const imapErrors = (db.prepare("SELECT COUNT(*) as c FROM service_logs WHERE service = 'imap' AND level = 'error'").get() as { c: number }).c;
  const imapLoginFails = (db.prepare("SELECT COUNT(*) as c FROM service_logs WHERE service = 'imap' AND message LIKE 'login failed:%'").get() as { c: number }).c;

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
    imap: {
      total_events: imapTotal,
      logins: imapLogins,
      login_fails: imapLoginFails,
      errors: imapErrors,
    },
    games: {
      total_scores: totalScores,
      by_game: byGame,
    },
    health,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/admin/logs — real-time server logs (API in-memory + service DB logs)
router.get('/logs', (req: AuthRequest, res: Response): void => {
  const since = parseInt(req.query['since'] as string || '0', 10);
  const sinceSvc = parseInt(req.query['since_svc'] as string || '0', 10);

  const apiLogs = getLogs(isNaN(since) ? 0 : since);

  // Service logs (IMAP, SMTP) from shared DB — filter by real DB id
  const svcMinId = isNaN(sinceSvc) ? 0 : (sinceSvc >= 900000 ? sinceSvc - 900000 : 0);
  const serviceLogs = db.prepare(
    'SELECT id, service, level, message, created_at FROM service_logs WHERE id > ? ORDER BY id ASC LIMIT 200'
  ).all(svcMinId) as { id: number; service: string; level: string; message: string; created_at: string }[];

  const svcEntries = serviceLogs.map(sl => ({
    id: 900000 + sl.id,
    ts: sl.created_at.endsWith('Z') ? sl.created_at : sl.created_at + 'Z',
    level: (sl.level === 'warn' ? 'warn' : sl.level === 'error' ? 'error' : 'info') as 'info' | 'warn' | 'error' | 'http',
    message: `[${sl.service.toUpperCase()}] ${sl.message}`,
  }));

  // Merge and sort by timestamp
  const all = [...apiLogs, ...svcEntries].sort((a, b) => a.ts.localeCompare(b.ts)).slice(-500);

  res.json({ logs: all });
});

// ── VPS Disk Monitoring ──

function collectDiskStats(): void {
  try {
    const output = execSync('df -B1 /', { encoding: 'utf8', timeout: 5000 });
    const lines = output.trim().split('\n');
    const dataLine = lines[1];
    if (!dataLine) return;
    const parts = dataLine.split(/\s+/);
    const total = parseInt(parts[1] ?? '0', 10);
    const used = parseInt(parts[2] ?? '0', 10);
    if (total <= 0 || used < 0) return;
    db.prepare('INSERT INTO vps_disk_stats (used_bytes, total_bytes) VALUES (?, ?)').run(used, total);
  } catch {
    // silently ignore — df might not be available in dev
  }
}

// Collect on startup + every 5 minutes
collectDiskStats();
setInterval(collectDiskStats, 5 * 60 * 1000);

interface DiskRow {
  used_bytes: number;
  total_bytes: number;
  collected_at: string;
}

// GET /api/admin/vps-stats?range=24h|7d|30d
router.get('/vps-stats', (req: AuthRequest, res: Response): void => {
  const range = (req.query['range'] as string) || '24h';
  const rangeMap: Record<string, string> = {
    '24h': '-1 day',
    '7d': '-7 days',
    '30d': '-30 days',
  };
  const sqlRange = rangeMap[range] ?? '-1 day';
  const validRange = rangeMap[range] ? range : '24h';

  // Get current (latest) reading
  const latest = db.prepare(
    'SELECT used_bytes, total_bytes, collected_at FROM vps_disk_stats ORDER BY id DESC LIMIT 1'
  ).get() as DiskRow | undefined;

  if (!latest) {
    res.json({
      current: null,
      history: [],
      range: validRange,
    });
    return;
  }

  const freeBytes = latest.total_bytes - latest.used_bytes;
  const usedPct = latest.total_bytes > 0 ? Math.round((latest.used_bytes / latest.total_bytes) * 1000) / 10 : 0;

  // History with downsampling
  const allRows = db.prepare(
    `SELECT used_bytes, total_bytes, collected_at FROM vps_disk_stats
     WHERE collected_at >= datetime('now', ?)
     ORDER BY collected_at ASC`
  ).all(sqlRange) as DiskRow[];

  // Downsample to ~200 points max
  const maxPoints = 200;
  let history: { used: number; total: number; ts: string }[];
  if (allRows.length <= maxPoints) {
    history = allRows.map(r => ({ used: r.used_bytes, total: r.total_bytes, ts: r.collected_at }));
  } else {
    const step = allRows.length / maxPoints;
    history = [];
    for (let i = 0; i < maxPoints; i++) {
      const r = allRows[Math.floor(i * step)]!;
      history.push({ used: r.used_bytes, total: r.total_bytes, ts: r.collected_at });
    }
    // Always include the last point
    const last = allRows[allRows.length - 1]!;
    history.push({ used: last.used_bytes, total: last.total_bytes, ts: last.collected_at });
  }

  res.json({
    current: {
      used_bytes: latest.used_bytes,
      total_bytes: latest.total_bytes,
      free_bytes: freeBytes,
      used_pct: usedPct,
      used_human: formatBytes(latest.used_bytes),
      total_human: formatBytes(latest.total_bytes),
      free_human: formatBytes(freeBytes),
    },
    history,
    range: validRange,
  });
});

// ── Audit Log ──

interface AuditRow {
  id: number;
  admin_username: string;
  action: string;
  target_type: string | null;
  target_id: number | null;
  target_name: string | null;
  details: string;
  created_at: string;
}

// GET /api/admin/audit-log
router.get('/audit-log', (req: AuthRequest, res: Response): void => {
  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 200);
  const offset = parseInt(req.query['offset'] as string) || 0;
  const action = (req.query['action'] as string)?.trim() || '';

  let query = 'SELECT id, admin_username, action, target_type, target_id, target_name, details, created_at FROM audit_log';
  const params: (string | number)[] = [];

  if (action) {
    query += ' WHERE action = ?';
    params.push(action);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as AuditRow[];
  const total = (db.prepare(
    action ? 'SELECT COUNT(*) as c FROM audit_log WHERE action = ?' : 'SELECT COUNT(*) as c FROM audit_log'
  ).get(...(action ? [action] : [])) as { c: number }).c;

  res.json({
    entries: rows.map(r => ({
      ...r,
      details: JSON.parse(r.details || '{}'),
    })),
    total,
    limit,
    offset,
  });
});

export default router;
