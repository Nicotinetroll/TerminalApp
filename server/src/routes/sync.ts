import { Router, Response } from 'express';
import db from '../db.js';
import { authMiddleware, AuthRequest } from '../middleware.js';

const router = Router();

// Storage limits per role (bytes). 0 = unlimited
const STORAGE_LIMITS: Record<string, number> = {
  admin: 0,
  user: 500 * 1024 * 1024,   // 500 MB
  guest: 50 * 1024 * 1024,   // 50 MB
};

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

  const serialized = JSON.stringify(filesystem);

  // Role-based storage limit
  const role = req.user!.role;
  const limit = STORAGE_LIMITS[role] ?? STORAGE_LIMITS['guest']!;
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');

  if (limit > 0 && sizeBytes > limit) {
    const limitMB = Math.round(limit / (1024 * 1024));
    const usedMB = (sizeBytes / (1024 * 1024)).toFixed(1);
    const roasts = [
      `you're trying to stuff ${usedMB}MB into a ${limitMB}MB hole. that's what she said.`,
      `${limitMB}MB limit exceeded. you a digital hoarder or something?`,
      `bro you hit the ${limitMB}MB cap. delete some shit or cry about it.`,
      `storage full at ${limitMB}MB. your files are not that important, trust me.`,
    ];
    const roast = roasts[Math.floor(Math.random() * roasts.length)]!;
    res.status(413).json({ error: roast });
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

  const row = db.prepare('SELECT theme_name, command_history FROM user_settings WHERE user_id = ?').get(userId) as
    | { theme_name: string; command_history: string }
    | undefined;

  if (!row) {
    res.json({ theme_name: 'claude', command_history: [] });
    return;
  }

  let commandHistory: unknown[];
  try {
    commandHistory = JSON.parse(row.command_history);
  } catch {
    commandHistory = [];
  }

  res.json({
    theme_name: row.theme_name,
    command_history: commandHistory,
  });
});

// PUT /api/sync/settings
router.put('/settings', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { theme_name, command_history } = req.body;

  // Get current settings or defaults
  const existing = db.prepare('SELECT theme_name, command_history FROM user_settings WHERE user_id = ?').get(userId) as
    | { theme_name: string; command_history: string }
    | undefined;

  const newThemeName = theme_name ?? existing?.theme_name ?? 'claude';
  const newCommandHistory = command_history !== undefined
    ? JSON.stringify(command_history)
    : existing?.command_history ?? '[]';

  db.prepare(`
    INSERT INTO user_settings (user_id, theme_name, command_history, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      theme_name = excluded.theme_name,
      command_history = excluded.command_history,
      updated_at = excluded.updated_at
  `).run(userId, newThemeName, newCommandHistory);

  res.json({ ok: true });
});

// GET /api/sync/stats — storage usage statistics
router.get('/stats', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  const row = db.prepare('SELECT filesystem FROM user_filesystems WHERE user_id = ?').get(userId) as
    | { filesystem: string }
    | undefined;

  const used = row ? Buffer.byteLength(row.filesystem, 'utf8') : 0;
  const limit = STORAGE_LIMITS[role] ?? STORAGE_LIMITS['guest']!;

  res.json({ used, limit, role });
});

export default router;
