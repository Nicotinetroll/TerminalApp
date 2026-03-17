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
    classic: {
      '1m': getSetting('sub_classic_1m_eur', 2.99),
      '3m': getSetting('sub_classic_3m_eur', 2.69),
      '12m': getSetting('sub_classic_12m_eur', 1.99),
    },
    club: {
      '1m': getSetting('sub_club_1m_eur', 5.99),
      '3m': getSetting('sub_club_3m_eur', 4.99),
      '12m': getSetting('sub_club_12m_eur', 3.99),
    },
  };

  // Subscription benefits
  let freeBenefits: string[];
  let classicBenefits: string[];
  let clubBenefits: string[];
  try {
    freeBenefits = JSON.parse(getStringSetting('sub_free_benefits', '["terminal access","50MB cloud storage","basic apps","vibes only"]')) as string[];
  } catch { freeBenefits = []; }
  try {
    classicBenefits = JSON.parse(getStringSetting('sub_classic_benefits', '["@mynig.ga email","500MB cloud storage","priority support"]')) as string[];
  } catch { classicBenefits = []; }
  try {
    clubBenefits = JSON.parse(getStringSetting('sub_club_benefits', '["everything in Member","all apps unlocked","unlimited features","flex on the poors"]')) as string[];
  } catch { clubBenefits = []; }

  const subscriptionBenefits = {
    free: freeBenefits,
    classic: classicBenefits,
    club: clubBenefits,
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
  sub_classic_1m:  { settingKey: 'sub_classic_1m_eur',  fallback: 2.99, months: 1,  role: 'classic', days: 30  },
  sub_classic_3m:  { settingKey: 'sub_classic_3m_eur',  fallback: 2.69, months: 3,  role: 'classic', days: 90  },
  sub_classic_12m: { settingKey: 'sub_classic_12m_eur', fallback: 1.99, months: 12, role: 'classic', days: 365 },
  sub_club_1m:     { settingKey: 'sub_club_1m_eur',     fallback: 5.99, months: 1,  role: 'club',    days: 30  },
  sub_club_3m:     { settingKey: 'sub_club_3m_eur',     fallback: 4.99, months: 3,  role: 'club',    days: 90  },
  sub_club_12m:    { settingKey: 'sub_club_12m_eur',    fallback: 3.99, months: 12, role: 'club',    days: 365 },
};

router.post('/subscribe', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { type } = req.body as { type?: string };

  if (!type || !SUB_PRICE_MAP[type]) {
    res.status(400).json({ error: "invalid subscription type." });
    return;
  }

  const info = SUB_PRICE_MAP[type]!;
  const perMonth = getSetting(info.settingKey, info.fallback);
  const nbPrice = Math.ceil(perMonth * info.months); // 1 NB = 1 EUR, round up

  const result = db.transaction(() => {
    // Prevent downgrade (e.g. buying Classic when you have Club)
    const roleLevel: Record<string, number> = { guest: 0, code: 0, user: 1, classic: 2, club: 3, admin: 4 };
    const activeSub = db.prepare(
      'SELECT type FROM subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(userId) as { type: string } | undefined;

    if (activeSub) {
      const currentSubRole = activeSub.type.includes('club') ? 'club' : activeSub.type.includes('classic') ? 'classic' : 'user';
      const displayRole = currentSubRole === 'club' ? 'club member' : currentSubRole === 'classic' ? 'member' : currentSubRole;
      const currentSubLevel = roleLevel[currentSubRole] ?? 0;
      const newSubLevel = roleLevel[info.role] ?? 0;
      if (newSubLevel < currentSubLevel) {
        return { error: `you already have ${displayRole}. why would you downgrade? that's embarrassing.` } as const;
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

    const newBal = (db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number }).bytebucks;

    return {
      ok: true as const,
      message: `${info.role === 'club' ? 'club member' : 'member'} subscription activated for ${nbPrice} NB. welcome aboard.`,
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

export default router;
