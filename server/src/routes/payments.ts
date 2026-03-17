import { Router } from 'express';
import type { Response } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { authMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';
import { getSetting, getStringSetting } from '../constants.js';

const router = Router();

const VALID_TYPES = [
  'nb',
  'sub_classic_1m', 'sub_classic_3m', 'sub_classic_12m',
  'sub_club_1m', 'sub_club_3m', 'sub_club_12m',
] as const;
type PaymentType = typeof VALID_TYPES[number];

function isSandbox(): boolean {
  return process.env['NOWPAYMENTS_SANDBOX'] === 'true';
}

function getApiBase(): string {
  return isSandbox() ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';
}

// ── POST /api/payments/create (auth) ──
router.post('/create', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { type, nb_amount } = req.body as { type?: string; nb_amount?: number };

  if (!type || !VALID_TYPES.includes(type as PaymentType)) {
    res.status(400).json({ error: "invalid payment type. what are you trying to buy?" });
    return;
  }

  const paymentType = type as PaymentType;

  // Prevent subscription downgrade (e.g. buying Classic when you have Club)
  if (paymentType !== 'nb') {
    const activeSub = db.prepare(
      'SELECT type FROM subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(userId) as { type: string } | undefined;

    if (activeSub) {
      const roleLevel: Record<string, number> = { classic: 2, club: 3 };
      const currentSubRole = activeSub.type.includes('club') ? 'club' : activeSub.type.includes('classic') ? 'classic' : '';
      const newSubRole = paymentType.includes('club') ? 'club' : 'classic';
      const displayRole = currentSubRole === 'club' ? 'club member' : 'member';
      if ((roleLevel[currentSubRole] ?? 0) > (roleLevel[newSubRole] ?? 0)) {
        res.status(400).json({ error: `you already have ${displayRole}. downgrading is not a thing.` });
        return;
      }
    }
  }

  // Calculate price
  let amountEur: number;
  let nbToCredit = 0;
  let description: string;

  if (paymentType === 'nb') {
    const validPacks = getStringSetting('nb_pack_amounts', '10,50,100,500')
      .split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
    if (!nb_amount || !validPacks.includes(nb_amount)) {
      res.status(400).json({ error: `invalid NB pack. pick one of: ${validPacks.join(', ')}` });
      return;
    }
    amountEur = nb_amount; // 1:1 ratio
    nbToCredit = nb_amount;
    description = `${nb_amount} NiggaBytes`;
  } else {
    // settingKey, fallback per-month price, months, label
    const priceMap: Record<string, [string, number, number, string]> = {
      sub_classic_1m:  ['sub_classic_1m_eur',  2.99, 1,  'Member 1 Month'],
      sub_classic_3m:  ['sub_classic_3m_eur',  2.69, 3,  'Member 3 Months'],
      sub_classic_12m: ['sub_classic_12m_eur', 1.99, 12, 'Member 12 Months'],
      sub_club_1m:     ['sub_club_1m_eur',     5.99, 1,  'Club Member 1 Month'],
      sub_club_3m:     ['sub_club_3m_eur',     4.99, 3,  'Club Member 3 Months'],
      sub_club_12m:    ['sub_club_12m_eur',    3.99, 12, 'Club Member 12 Months'],
    };
    const [settingKey, fallback, months, label] = priceMap[paymentType]!;
    const perMonth = getSetting(settingKey!, fallback!);
    amountEur = Math.round(perMonth * months! * 100) / 100;
    description = `${label} Subscription`;
  }

  const paymentId = crypto.randomUUID();
  const apiKey = process.env['NOWPAYMENTS_API_KEY'];
  if (!apiKey) {
    res.status(500).json({ error: "payments not configured yet. bug the admin." });
    return;
  }

  try {
    const callbackUrl = `https://mynig.ga/api/payments/ipn`;
    const successUrl = `https://mynig.ga/?payment=success`;
    const cancelUrl = `https://mynig.ga/?payment=cancel`;

    const invoiceRes = await fetch(`${getApiBase()}/invoice`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_amount: amountEur,
        price_currency: 'eur',
        order_id: paymentId,
        order_description: description,
        ipn_callback_url: callbackUrl,
        success_url: successUrl,
        cancel_url: cancelUrl,
      }),
    });

    if (!invoiceRes.ok) {
      const errBody = await invoiceRes.text();
      console.error('[payments] NOWPayments invoice error:', invoiceRes.status, errBody);
      res.status(502).json({ error: "payment provider said no. try again later." });
      return;
    }

    const invoiceData = await invoiceRes.json() as { id: string; invoice_url: string };

    // Store payment in DB
    db.prepare(`
      INSERT INTO payments (id, user_id, nowpayments_id, type, amount_eur, nb_amount, status, invoice_url)
      VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?)
    `).run(paymentId, userId, invoiceData.id, paymentType, amountEur, nbToCredit, invoiceData.invoice_url);

    res.json({
      payment_id: paymentId,
      invoice_url: invoiceData.invoice_url,
    });
  } catch (err) {
    console.error('[payments] create error:', err);
    res.status(500).json({ error: "something broke. try again." });
  }
});

// ── POST /api/payments/ipn (NO auth — webhook from NOWPayments) ──
router.post('/ipn', async (req: AuthRequest, res: Response): Promise<void> => {
  const ipnSecret = process.env['NOWPAYMENTS_IPN_SECRET'];
  if (!ipnSecret) {
    console.error('[payments] IPN secret not configured');
    res.status(500).json({ error: 'not configured' });
    return;
  }

  // Verify HMAC-SHA512
  const receivedSig = req.headers['x-nowpayments-sig'] as string | undefined;
  if (!receivedSig) {
    res.status(400).json({ error: 'missing signature' });
    return;
  }

  const body = req.body as Record<string, unknown>;

  // Sort keys alphabetically and stringify for HMAC
  const sortedKeys = Object.keys(body).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of sortedKeys) sorted[k] = body[k];
  const hmac = crypto.createHmac('sha512', ipnSecret).update(JSON.stringify(sorted)).digest('hex');

  if (hmac !== receivedSig) {
    console.error('[payments] IPN signature mismatch');
    res.status(400).json({ error: 'invalid signature' });
    return;
  }

  const orderId = body['order_id'] as string | undefined;
  const paymentStatus = body['payment_status'] as string | undefined;

  if (!orderId || !paymentStatus) {
    res.status(400).json({ error: 'missing fields' });
    return;
  }

  console.log(`[payments] IPN: order=${orderId} status=${paymentStatus}`);

  // Map NOWPayments status to our status
  const statusMap: Record<string, string> = {
    waiting: 'waiting',
    confirming: 'confirming',
    confirmed: 'confirmed',
    sending: 'confirmed',
    partially_paid: 'waiting',
    finished: 'finished',
    failed: 'failed',
    refunded: 'failed',
    expired: 'expired',
  };

  const ourStatus = statusMap[paymentStatus] ?? paymentStatus;

  // Get payment from DB
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(orderId) as {
    id: string; user_id: number; type: string; amount_eur: number; nb_amount: number;
    status: string; nowpayments_id: string;
  } | undefined;

  if (!payment) {
    console.error('[payments] IPN: payment not found:', orderId);
    res.status(404).json({ error: 'payment not found' });
    return;
  }

  // Update status
  db.prepare("UPDATE payments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(ourStatus, orderId);

  // Process finished payments
  if (ourStatus === 'finished' && payment.status !== 'finished') {
    processPayment(payment);
  }

  res.json({ ok: true });
});

function processPayment(payment: { id: string; user_id: number; type: string; nb_amount: number }): void {
  console.log(`[payments] processing: ${payment.type} for user ${payment.user_id}`);

  if (payment.type === 'nb') {
    // Credit NiggaBytes — atomic upsert
    db.transaction(() => {
      const existing = db.prepare('SELECT user_id FROM slots_balance WHERE user_id = ?').get(payment.user_id);
      if (existing) {
        db.prepare('UPDATE slots_balance SET bytebucks = bytebucks + ? WHERE user_id = ?').run(payment.nb_amount, payment.user_id);
      } else {
        db.prepare('INSERT INTO slots_balance (user_id, bytebucks) VALUES (?, ?)').run(payment.user_id, payment.nb_amount);
      }
    })();
    console.log(`[payments] credited ${payment.nb_amount} NB to user ${payment.user_id}`);
    return;
  }

  // Subscription — duration-based (no lifetime)
  const subTypeMap: Record<string, { role: string; days: number }> = {
    sub_classic_1m:  { role: 'classic', days: 30 },
    sub_classic_3m:  { role: 'classic', days: 90 },
    sub_classic_12m: { role: 'classic', days: 365 },
    sub_club_1m:     { role: 'club',    days: 30 },
    sub_club_3m:     { role: 'club',    days: 90 },
    sub_club_12m:    { role: 'club',    days: 365 },
  };

  const subInfo = subTypeMap[payment.type];
  if (!subInfo) return;

  // Atomic: deactivate old sub + create new + upgrade role
  db.transaction(() => {
    db.prepare('UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(payment.user_id);

    const subType = payment.type.replace('sub_', '');
    const expiresAt = new Date(Date.now() + subInfo.days * 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

    db.prepare(`
      INSERT INTO subscriptions (user_id, type, payment_id, starts_at, expires_at, is_active)
      VALUES (?, ?, ?, datetime('now'), ?, 1)
    `).run(payment.user_id, subType, payment.id, expiresAt);

    const roleLevel: Record<string, number> = { guest: 0, code: 0, user: 1, classic: 2, club: 3, admin: 4 };
    const currentRole = (db.prepare('SELECT role FROM users WHERE id = ?').get(payment.user_id) as { role: string } | undefined)?.role ?? 'user';
    const currentLevel = roleLevel[currentRole] ?? 0;
    const newLevel = roleLevel[subInfo.role] ?? 0;

    if (newLevel > currentLevel) {
      db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(subInfo.role, payment.user_id);
      console.log(`[payments] upgraded user ${payment.user_id} from ${currentRole} to ${subInfo.role}`);
    }
  })();
}

// ── GET /api/payments/mine (auth) ──
router.get('/mine', authMiddleware, (req: AuthRequest, res: Response): void => {
  const payments = db.prepare(
    'SELECT id, type, amount_eur, nb_amount, status, invoice_url, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user!.userId);

  res.json({ payments });
});

// ── GET /api/payments/subscription (auth) ──
router.get('/subscription', authMiddleware, (req: AuthRequest, res: Response): void => {
  const sub = db.prepare(
    'SELECT id, type, starts_at, expires_at, is_active, auto_renew FROM subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
  ).get(req.user!.userId);

  res.json({ subscription: sub ?? null });
});

// ── Subscription expiry cron ──

// Map sub type (e.g. 'classic_1m') back to pricing info
const RENEW_MAP: Record<string, { settingKey: string; fallback: number; months: number; role: string; days: number }> = {
  classic_1m:  { settingKey: 'sub_classic_1m_eur',  fallback: 2.99, months: 1,  role: 'classic', days: 30  },
  classic_3m:  { settingKey: 'sub_classic_3m_eur',  fallback: 2.69, months: 3,  role: 'classic', days: 90  },
  classic_12m: { settingKey: 'sub_classic_12m_eur', fallback: 1.99, months: 12, role: 'classic', days: 365 },
  club_1m:     { settingKey: 'sub_club_1m_eur',     fallback: 5.99, months: 1,  role: 'club',    days: 30  },
  club_3m:     { settingKey: 'sub_club_3m_eur',     fallback: 4.99, months: 3,  role: 'club',    days: 90  },
  club_12m:    { settingKey: 'sub_club_12m_eur',    fallback: 3.99, months: 12, role: 'club',    days: 365 },
};

function tryAutoRenew(sub: { id: number; user_id: number; type: string }): boolean {
  const info = RENEW_MAP[sub.type];
  if (!info) return false;

  const perMonth = getSetting(info.settingKey, info.fallback);
  const nbPrice = Math.ceil(perMonth * info.months);

  // Wrap in transaction so NB deduction + sub creation are atomic
  const result = db.transaction(() => {
    const balRow = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(sub.user_id) as { bytebucks: number } | undefined;
    const nbBalance = balRow?.bytebucks ?? 0;

    if (nbBalance < nbPrice) {
      return { ok: false as const, reason: `needs ${nbPrice} NB, has ${nbBalance}` };
    }

    // Deduct NB
    db.prepare('UPDATE slots_balance SET bytebucks = bytebucks - ? WHERE user_id = ?').run(nbPrice, sub.user_id);

    // Deactivate old sub
    db.prepare('UPDATE subscriptions SET is_active = 0 WHERE id = ?').run(sub.id);

    // Create new sub with same type and auto_renew = 1
    const expiresAt = new Date(Date.now() + info.days * 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

    db.prepare(`
      INSERT INTO subscriptions (user_id, type, starts_at, expires_at, is_active, auto_renew)
      VALUES (?, ?, datetime('now'), ?, 1, 1)
    `).run(sub.user_id, sub.type, expiresAt);

    return { ok: true as const };
  })();

  if (!result.ok) {
    console.log(`[payments] auto-renew failed for user ${sub.user_id}: ${result.reason}`);
    return false;
  }

  console.log(`[payments] auto-renewed ${sub.type} for user ${sub.user_id} (${nbPrice} NB deducted)`);
  return true;
}

export function checkExpiredSubscriptions(): void {
  const roleLevel: Record<string, number> = { guest: 0, code: 0, user: 1, classic: 2, club: 3, admin: 4 };

  const expired = db.prepare(`
    SELECT s.id, s.user_id, s.type, s.auto_renew FROM subscriptions s
    WHERE s.is_active = 1 AND s.expires_at IS NOT NULL AND s.expires_at < datetime('now')
  `).all() as { id: number; user_id: number; type: string; auto_renew: number }[];

  if (expired.length === 0) return;

  console.log(`[payments] checking ${expired.length} expired subscription(s)`);

  for (const sub of expired) {
    // Try auto-renew if enabled
    if (sub.auto_renew === 1) {
      const renewed = tryAutoRenew(sub);
      if (renewed) continue; // Successfully renewed, skip expiry
    }

    db.prepare('UPDATE subscriptions SET is_active = 0 WHERE id = ?').run(sub.id);

    // Check if user has any other active subscription
    const otherActive = db.prepare(
      'SELECT type FROM subscriptions WHERE user_id = ? AND is_active = 1 AND id != ? ORDER BY id DESC LIMIT 1'
    ).get(sub.user_id, sub.id) as { type: string } | undefined;

    if (otherActive) continue; // Still has another active sub

    // Downgrade to "user" (but don't downgrade admin)
    const currentRole = (db.prepare('SELECT role FROM users WHERE id = ?').get(sub.user_id) as { role: string } | undefined)?.role ?? 'user';
    const currentLevel = roleLevel[currentRole] ?? 0;

    if (currentLevel >= 2 && currentLevel < 4) {
      db.prepare("UPDATE users SET role = 'user', updated_at = datetime('now') WHERE id = ?").run(sub.user_id);
      console.log(`[payments] downgraded user ${sub.user_id} from ${currentRole} to user (sub expired)`);
    }
  }
}

export default router;
