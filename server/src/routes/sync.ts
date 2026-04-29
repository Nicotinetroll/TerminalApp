import { Router, Response } from 'express';
import db from '../db.js';
import { authMiddleware, AuthRequest } from '../middleware.js';
import { getStorageLimits, getEffectiveLimit } from '../constants.js';

const router = Router();

// All sync routes require authentication
router.use(authMiddleware);

// GET /api/sync/filesystem
router.get('/filesystem', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const row = db.prepare('SELECT filesystem FROM user_filesystems WHERE user_id = ?').get(userId) as
    | { filesystem: string }
    | undefined;

  if (!row) {
    res.json({ filesystem: {} });
    return;
  }

  try {
    res.json({ filesystem: JSON.parse(row.filesystem) });
  } catch {
    res.json({ filesystem: {} });
  }
});

// PUT /api/sync/filesystem
router.put('/filesystem', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { filesystem } = req.body;

  if (filesystem === undefined || filesystem === null) {
    res.status(400).json({ error: 'filesystem field is required.' });
    return;
  }

  // Strip content from S3-backed nodes to keep tree lightweight
  function stripS3Content(node: Record<string, unknown>): void {
    const children = node['children'] as Record<string, Record<string, unknown>> | undefined;
    if (!children) return;
    for (const child of Object.values(children)) {
      if (child['type'] === 'directory') {
        stripS3Content(child);
      } else if (child['s3Key'] && child['content']) {
        // S3-backed file should not have inline content
        delete child['content'];
      }
    }
  }
  stripS3Content(filesystem as Record<string, unknown>);

  const serialized = JSON.stringify(filesystem);

  // Tree-only size limit: 10MB max for the lightweight metadata tree
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  const treeLimit = 10 * 1024 * 1024;
  if (sizeBytes > treeLimit) {
    res.status(413).json({ error: 'filesystem tree too large. something is wrong — are you storing file contents inline?' });
    return;
  }

  db.prepare(`
    INSERT INTO user_filesystems (user_id, filesystem, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      filesystem = excluded.filesystem,
      updated_at = excluded.updated_at
  `).run(userId, serialized);

  res.json({ ok: true });
});

// GET /api/sync/settings
router.get('/settings', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const row = db.prepare('SELECT theme_name, command_history, auto_open_apps, window_layouts FROM user_settings WHERE user_id = ?').get(userId) as
    | { theme_name: string; command_history: string; auto_open_apps: string; window_layouts: string }
    | undefined;

  if (!row) {
    res.json({ theme_name: 'claude', command_history: [], auto_open_apps: [], window_layouts: {} });
    return;
  }

  let commandHistory: unknown[];
  try {
    commandHistory = JSON.parse(row.command_history);
  } catch {
    commandHistory = [];
  }

  let autoOpenApps: unknown[];
  try {
    autoOpenApps = JSON.parse(row.auto_open_apps);
  } catch {
    autoOpenApps = [];
  }

  let windowLayouts: unknown;
  try {
    windowLayouts = JSON.parse(row.window_layouts);
  } catch {
    windowLayouts = {};
  }

  res.json({
    theme_name: row.theme_name,
    command_history: commandHistory,
    auto_open_apps: autoOpenApps,
    window_layouts: windowLayouts,
  });
});

// PUT /api/sync/settings
router.put('/settings', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { theme_name, command_history, auto_open_apps, window_layouts } = req.body;

  // Get current settings or defaults
  const existing = db.prepare('SELECT theme_name, command_history, auto_open_apps, window_layouts FROM user_settings WHERE user_id = ?').get(userId) as
    | { theme_name: string; command_history: string; auto_open_apps: string; window_layouts: string }
    | undefined;

  const newThemeName = theme_name ?? existing?.theme_name ?? 'claude';
  const newCommandHistory = command_history !== undefined
    ? JSON.stringify(command_history)
    : existing?.command_history ?? '[]';
  const newAutoOpenApps = auto_open_apps !== undefined
    ? JSON.stringify(auto_open_apps)
    : existing?.auto_open_apps ?? '[]';
  const newWindowLayouts = window_layouts !== undefined
    ? JSON.stringify(window_layouts)
    : existing?.window_layouts ?? '{}';

  db.prepare(`
    INSERT INTO user_settings (user_id, theme_name, command_history, auto_open_apps, window_layouts, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      theme_name = excluded.theme_name,
      command_history = excluded.command_history,
      auto_open_apps = excluded.auto_open_apps,
      window_layouts = excluded.window_layouts,
      updated_at = excluded.updated_at
  `).run(userId, newThemeName, newCommandHistory, newAutoOpenApps, newWindowLayouts);

  res.json({ ok: true });
});

// GET /api/sync/stats — storage usage statistics (uses cloud_files for real storage)
router.get('/stats', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  // Storage used = cloud files + S3-backed email attachments
  const cloudRow = db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM cloud_files WHERE user_id = ?').get(userId) as { total: number };
  const mailAttRow = db.prepare(`
    SELECT COALESCE(SUM(a.size), 0) as total FROM email_attachments a
    JOIN emails e ON e.id = a.email_id WHERE a.s3_key IS NOT NULL AND e.owner_id = ?
  `).get(userId) as { total: number };
  const used = cloudRow.total + mailAttRow.total;

  const slotsRow = db.prepare('SELECT bonus_bytes, bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as
    | { bonus_bytes: number; bytebucks: number } | undefined;
  const bonusBytes = slotsRow?.bonus_bytes ?? 0;
  const limit = getEffectiveLimit(role, bonusBytes);

  res.json({ used, limit, role, bonus_bytes: bonusBytes, niggabytes: slotsRow?.bytebucks ?? 0 });
});

export default router;
