import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { authMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';

const router = Router();

// Price for the Nth mail slot purchase (0-indexed)
// 1st address is free, these are prices for additional slots
const MAIL_SLOT_PRICES = [5, 7, 12, 20, 35, 50, 75, 100];
const MAX_MAIL_SLOTS = 9; // 9 purchases = 10 total addresses (1 free + 9 bought)

function getMailSlotPrice(purchaseIndex: number): number {
  if (purchaseIndex >= MAX_MAIL_SLOTS) return -1; // no more available
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
  const maxSlots = 1 + MAX_MAIL_SLOTS; // 1 free + max purchases

  // Build full price schedule for display
  const priceSchedule: number[] = [];
  for (let i = 0; i < MAX_MAIL_SLOTS; i++) {
    priceSchedule.push(getMailSlotPrice(i));
  }

  res.json({
    items: [
      {
        id: 'mail_slot',
        name: 'mail slot',
        description: 'unlock another @mynig.ga email address',
        price: nextPrice === -1 ? null : nextPrice,
        owned: mailSlotCount,
        max_purchases: MAX_MAIL_SLOTS,
        total_slots: 1 + mailSlotCount,
        max_slots: maxSlots,
        sold_out: nextPrice === -1,
        price_schedule: priceSchedule,
      },
    ],
    nb_balance: nbBalance,
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
      total_slots: 1 + newSlotCount,
      next_price: nextPrice === -1 ? null : nextPrice,
    };
  })();

  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json(result);
});

export default router;
