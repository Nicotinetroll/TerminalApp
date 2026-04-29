import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';
import { getSetting, getStringSetting, getDefaultMailSlots } from '../constants.js';
const router = Router();

// Price for the Nth mail slot purchase (0-indexed)
// 1st address is free, these are prices for additional slots
const MAIL_SLOT_PRICES = [5, 7, 12, 20, 35, 50, 75, 100];

function getMailSlotPrice(purchaseIndex: number): number {
  const maxSlots = getSetting('shop_max_mail_slots', 9);
  if (purchaseIndex >= maxSlots) return -1; // no more available
  if (purchaseIndex >= MAIL_SLOT_PRICES.length) return MAIL_SLOT_PRICES[MAIL_SLOT_PRICES.length - 1]!;
  return MAIL_SLOT_PRICES[purchaseIndex]!;
}

router.use(authMiddleware);

// ── GET /api/shop/items ──
router.get('/items', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  // Count user's mail slot purchases
  const mailSlotCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM shop_purchases WHERE user_id = ? AND item_type = 'mail_slot'"
  ).get(userId) as { cnt: number }).cnt;

  // Get NB balance
  const balRow = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number } | undefined;
  const nbBalance = balRow?.bytebucks ?? 0;

  const nextPrice = getMailSlotPrice(mailSlotCount);
  const maxMailSlots = getSetting('shop_max_mail_slots', 9);
  const freeSlots = getDefaultMailSlots(req.user!.role);
  const maxSlots = freeSlots + maxMailSlots; // free for role + max purchases

  // Build full price schedule for display
  const priceSchedule: number[] = [];
  for (let i = 0; i < maxMailSlots; i++) {
    priceSchedule.push(getMailSlotPrice(i));
  }

  // NB packs (1 EUR = 1 NB)
  const packAmountsStr = getStringSetting('nb_pack_amounts', '10,50,100,500');
  const nbPacks = packAmountsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);

  // Subscription prices (EUR per month)
  const subscriptionPrices = {
    basic: {
      '1m': getSetting('sub_basic_1m_eur', 2.99),
      '3m': getSetting('sub_basic_3m_eur', 2.49),
      '12m': getSetting('sub_basic_12m_eur', 1.99),
    },
    premium: {
      '1m': getSetting('sub_premium_1m_eur', 6.69),
      '3m': getSetting('sub_premium_3m_eur', 5.49),
      '12m': getSetting('sub_premium_12m_eur', 4.49),
    },
  };

  // Subscription benefits
  let basicBenefits: string[];
  let premiumBenefits: string[];
  try {
    basicBenefits = JSON.parse(getStringSetting('sub_basic_benefits', '["@mynig.ga email","10GB cloud storage","1GB upload links","core apps"]')) as string[];
  } catch { basicBenefits = []; }
  try {
    premiumBenefits = JSON.parse(getStringSetting('sub_premium_benefits', '["30GB cloud storage","5GB upload links","all apps unlocked","priority support","flex on the poors"]')) as string[];
  } catch { premiumBenefits = []; }

  const subscriptionBenefits = {
    basic: basicBenefits,
    premium: premiumBenefits,
  };

  // Active subscription
  const activeSub = db.prepare(
    "SELECT id, type, starts_at, expires_at, is_active, auto_renew FROM subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1"
  ).get(userId) as { id: number; type: string; starts_at: string; expires_at: string | null; is_active: number; auto_renew: number } | undefined;

  res.json({
    items: [
      {
        id: 'mail_slot',
        name: 'mail slot',
        description: 'unlock another @mynig.ga email address',
        price: nextPrice === -1 ? null : nextPrice,
        owned: mailSlotCount,
        max_purchases: maxMailSlots,
        free_slots: freeSlots,
        total_slots: freeSlots + mailSlotCount,
        max_slots: maxSlots,
        sold_out: nextPrice === -1,
        price_schedule: priceSchedule,
      },
    ],
    nb_balance: nbBalance,
    nb_packs: nbPacks,
    subscription_prices: subscriptionPrices,
    subscription_benefits: subscriptionBenefits,
    active_subscription: activeSub ?? null,
  });
});

// ── POST /api/shop/purchase ──
router.post('/purchase', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { item } = req.body as { item?: string };

  if (!item || item !== 'mail_slot') {
    res.status(400).json({ error: "what are you trying to buy? we only got mail slots rn." });
    return;
  }

  // All checks + purchase in one transaction to prevent race conditions
  const result = db.transaction(() => {
    const mailSlotCount = (db.prepare(
      "SELECT COUNT(*) as cnt FROM shop_purchases WHERE user_id = ? AND item_type = 'mail_slot'"
    ).get(userId) as { cnt: number }).cnt;

    const price = getMailSlotPrice(mailSlotCount);
    if (price === -1) {
      return { error: "you've maxed out at 10 addresses. what are you, a spy agency?" } as const;
    }

    const balRow = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number } | undefined;
    const nbBalance = balRow?.bytebucks ?? 0;

    if (nbBalance < price) {
      return { error: `you need ${price} NB but you only have ${nbBalance}. go gamble or something.` } as const;
    }

    db.prepare('UPDATE slots_balance SET bytebucks = bytebucks - ? WHERE user_id = ?').run(price, userId);
    db.prepare("INSERT INTO shop_purchases (user_id, item_type, price_nb) VALUES (?, 'mail_slot', ?)").run(userId, price);
    const newBal = (db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number }).bytebucks;

    const newSlotCount = mailSlotCount + 1;
    const nextPrice = getMailSlotPrice(newSlotCount);

    return {
      ok: true as const,
      message: `mail slot #${newSlotCount + 1} unlocked for ${price} NB. go claim that address.`,
      nb_balance: newBal,
      total_slots: getDefaultMailSlots(req.user!.role) + newSlotCount,
      next_price: nextPrice === -1 ? null : nextPrice,
    };
  })();

  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json(result);
});

// ── POST /api/shop/subscribe (pay with NB) ──
const SUB_PRICE_MAP: Record<string, { settingKey: string; fallback: number; months: number; role: string; days: number }> = {
  sub_basic_1m:  { settingKey: 'sub_basic_1m_eur',  fallback: 2.99, months: 1,  role: 'basic', days: 30  },
  sub_basic_3m:  { settingKey: 'sub_basic_3m_eur',  fallback: 2.49, months: 3,  role: 'basic', days: 90  },
  sub_basic_12m: { settingKey: 'sub_basic_12m_eur', fallback: 1.99, months: 12, role: 'basic', days: 365 },
  sub_premium_1m:    { settingKey: 'sub_premium_1m_eur',    fallback: 6.69, months: 1,  role: 'premium',   days: 30  },
  sub_premium_3m:    { settingKey: 'sub_premium_3m_eur',    fallback: 5.49, months: 3,  role: 'premium',   days: 90  },
  sub_premium_12m:   { settingKey: 'sub_premium_12m_eur',   fallback: 4.49, months: 12, role: 'premium',   days: 365 },
};

router.post('/subscribe', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { type, promo_code } = req.body as { type?: string; promo_code?: string };

  if (!type || !SUB_PRICE_MAP[type]) {
    res.status(400).json({ error: "invalid subscription type." });
    return;
  }

  const info = SUB_PRICE_MAP[type]!;
  const perMonth = getSetting(info.settingKey, info.fallback);
  let nbPrice = Math.ceil(perMonth * info.months); // 1 NB = 1 EUR, round up

  // Validate promo code if provided
  let appliedPromo: string | null = null;
  if (promo_code && typeof promo_code === 'string') {
    const cleanCode = promo_code.toUpperCase().trim();
    const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(cleanCode) as {
      code: string; type: string; value: number; sub_tier: string | null;
      max_uses: number; use_count: number; expires_at: string | null; active: number;
    } | undefined;

    if (!promo || !promo.active || promo.type !== 'discount_pct') {
      res.status(400).json({ error: "invalid promo code." });
      return;
    }
    if (promo.expires_at && new Date(promo.expires_at + 'Z') < new Date()) {
      res.status(400).json({ error: "promo code expired." });
      return;
    }
    if (promo.max_uses > 0 && promo.use_count >= promo.max_uses) {
      res.status(400).json({ error: "promo code maxed out." });
      return;
    }
    const planTier = info.role;
    if (promo.sub_tier && promo.sub_tier !== planTier) {
      res.status(400).json({ error: `code only works for ${promo.sub_tier} plans.` });
      return;
    }
    const used = db.prepare('SELECT id FROM promo_uses WHERE promo_code = ? AND user_id = ?').get(cleanCode, userId);
    if (used) {
      res.status(400).json({ error: "you already used this code." });
      return;
    }
    nbPrice = Math.max(1, Math.ceil(nbPrice * (1 - promo.value / 100)));
    appliedPromo = cleanCode;
  }

  const result = db.transaction(() => {
    // Prevent downgrade (e.g. buying Classic when you have Club)
    const roleLevel: Record<string, number> = { user: 1, basic: 2, premium: 3, admin: 4 };
    const activeSub = db.prepare(
      'SELECT type FROM subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(userId) as { type: string } | undefined;

    if (activeSub) {
      const currentSubRole = activeSub.type.includes('premium') ? 'premium' : activeSub.type.includes('basic') ? 'basic' : 'user';
      const currentSubLevel = roleLevel[currentSubRole] ?? 0;
      const newSubLevel = roleLevel[info.role] ?? 0;
      if (newSubLevel < currentSubLevel) {
        return { error: `you already have ${currentSubRole}. why would you downgrade? that's embarrassing.` } as const;
      }
    }

    const balRow = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number } | undefined;
    const nbBalance = balRow?.bytebucks ?? 0;

    if (nbBalance < nbPrice) {
      return { error: `you need ${nbPrice} NB but only have ${nbBalance}. skill issue.` } as const;
    }

    // Deduct NB
    db.prepare('UPDATE slots_balance SET bytebucks = bytebucks - ? WHERE user_id = ?').run(nbPrice, userId);

    // Deactivate existing sub
    db.prepare('UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(userId);

    // Create subscription
    const subType = type.replace('sub_', '');
    const expiresAt = new Date(Date.now() + info.days * 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

    db.prepare(`
      INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active, auto_renew)
      VALUES (?, ?, datetime('now'), ?, 1, 1)
    `).run(userId, subType, expiresAt);

    // Upgrade role (don't downgrade admin)
    const currentRole = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined)?.role ?? 'user';
    const currentLevel = roleLevel[currentRole] ?? 0;
    const newLevel = roleLevel[info.role] ?? 0;

    if (newLevel > currentLevel) {
      db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(info.role, userId);
    }

    // Track promo usage
    if (appliedPromo) {
      db.prepare('UPDATE promo_codes SET use_count = use_count + 1 WHERE code = ?').run(appliedPromo);
      db.prepare('INSERT INTO promo_uses (promo_code, user_id) VALUES (?, ?)').run(appliedPromo, userId);
    }

    const newBal = (db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number }).bytebucks;

    return {
      ok: true as const,
      message: `${info.role} subscription activated for ${nbPrice} NB. welcome aboard.`,
      nb_balance: newBal,
    };
  })();

  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json(result);
});

// ── PUT /api/shop/auto-renew ──
router.put('/auto-renew', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { enabled } = req.body as { enabled?: boolean };

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: "send { enabled: true/false } you donut." });
    return;
  }

  const activeSub = db.prepare(
    'SELECT id, auto_renew FROM subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(userId) as { id: number; auto_renew: number } | undefined;

  if (!activeSub) {
    res.status(400).json({ error: "you don't have an active subscription to toggle." });
    return;
  }

  db.prepare('UPDATE subscriptions SET auto_renew = ? WHERE id = ?').run(enabled ? 1 : 0, activeSub.id);

  res.json({
    ok: true,
    auto_renew: enabled,
    message: enabled
      ? "auto-renew enabled. we'll charge your NiggaBytes when it expires."
      : "auto-renew disabled. your sub will expire and you'll be a peasant again.",
  });
});

// ── GET /api/shop/balance ──
router.get('/balance', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const row = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number } | undefined;
  res.json({ nb_balance: row?.bytebucks ?? 0 });
});

export default router;
