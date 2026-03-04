import { Router, Response } from 'express';
import db from '../db.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware.js';

const router = Router();

router.use(authMiddleware);

// ── GET /api/settings — returns all settings as Record<string, string> ──
router.get('/', (_req: AuthRequest, res: Response): void => {
  const rows = db.prepare('SELECT key, value FROM global_settings').all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json({ settings });
});

// ── PUT /api/settings — bulk update (admin only) ──
router.put('/', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const { settings } = req.body as { settings?: Record<string, string> };

  if (!settings || typeof settings !== 'object') {
    res.status(400).json({ error: "settings object required. what are you even sending?" });
    return;
  }

  const upsert = db.prepare(
    `INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );

  const updateMany = db.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) {
      upsert.run(key, String(value));
    }
  });

  updateMany(Object.entries(settings));

  // Return updated settings
  const rows = db.prepare('SELECT key, value FROM global_settings').all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }

  res.json({ settings: result });
});

export default router;
