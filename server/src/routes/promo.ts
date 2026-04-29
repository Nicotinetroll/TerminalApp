import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';
import { activateUser } from './auth.js';

const router = Router();
router.use(authMiddleware);

interface PromoRow {
  code: string;
  type: string;
  value: number;
  sub_tier: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  active: number;
}

function validatePromoCode(code: string, userId: number): { valid: true; promo: PromoRow } | { valid: false; error: string } {
  const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code) as PromoRow | undefined;
  if (!promo) return { valid: false, error: "code doesn't exist. nice try though." };
  if (!promo.active) return { valid: false, error: "this code is dead. rip." };
  if (promo.expires_at && new Date(promo.expires_at + 'Z') < new Date()) {
    return { valid: false, error: "expired. you're too slow." };
  }
  if (promo.max_uses > 0 && promo.use_count >= promo.max_uses) {
    return { valid: false, error: "all used up. should've been faster." };
  }
  const alreadyUsed = db.prepare(
    'SELECT id FROM promo_uses WHERE promo_code = ? AND user_id = ?'
  ).get(code, userId);
  if (alreadyUsed) return { valid: false, error: "you already used this one. no double dipping." };

  return { valid: true, promo };
}

// POST /api/promo/validate
router.post('/validate', (req: AuthRequest, res: Response): void => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== 'string') {
    res.status(400).json({ valid: false, error: 'give me a code.' });
    return;
  }

  const result = validatePromoCode(code.toUpperCase().trim(), req.user!.userId);
  if (!result.valid) {
    res.json({ valid: false, error: result.error });
    return;
  }

  res.json({
    valid: true,
    type: result.promo.type,
    value: result.promo.value,
    sub_tier: result.promo.sub_tier,
  });
});

// POST /api/promo/redeem — only for free_sub type
router.post('/redeem', (req: AuthRequest, res: Response): void => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== 'string') {
    res.status(400).json({ ok: false, error: 'give me a code.' });
    return;
  }

  const cleanCode = code.toUpperCase().trim();
  const userId = req.user!.userId;
  const result = validatePromoCode(cleanCode, userId);

  if (!result.valid) {
    res.status(400).json({ ok: false, error: result.error });
    return;
  }

  const { promo } = result;
  if (promo.type !== 'free_sub') {
    res.status(400).json({ ok: false, error: "this code is a discount, not a free pass. use it at checkout." });
    return;
  }

  const days = Math.floor(promo.value);
  const tier = promo.sub_tier ?? 'basic';
  const role = tier === 'premium' ? 'premium' : 'basic';

  // Map tier to a subscription type string
  const subType = days <= 30 ? `${role}_1m` : days <= 90 ? `${role}_3m` : `${role}_12m`;

  db.transaction(() => {
    // Deactivate old subs
    db.prepare('UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(userId);

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

    db.prepare(`
      INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active)
      VALUES (?, ?, datetime('now'), ?, 1)
    `).run(userId, subType, expiresAt);

    // Upgrade role if needed
    const currentUser = db.prepare('SELECT role, email FROM users WHERE id = ?').get(userId) as { role: string; email: string } | undefined;
    const currentRole = currentUser?.role ?? 'user';

    if (currentRole === 'pending') {
      const localPart = (currentUser?.email ?? '').split('@')[0] ?? '';
      activateUser(userId, localPart, role);
    } else {
      const roleLevel: Record<string, number> = { user: 1, basic: 2, premium: 3, admin: 4 };
      const currentLevel = roleLevel[currentRole] ?? 0;
      const newLevel = roleLevel[role] ?? 0;
      if (newLevel > currentLevel) {
        db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(role, userId);
      }
    }

    // Track usage
    db.prepare('UPDATE promo_codes SET use_count = use_count + 1 WHERE code = ?').run(cleanCode);
    db.prepare('INSERT INTO promo_uses (promo_code, user_id) VALUES (?, ?)').run(cleanCode, userId);
  })();

  res.json({
    ok: true,
    sub_tier: role,
    days,
    message: `${role} subscription activated for ${days} days. you're welcome.`,
  });
});

export default router;
