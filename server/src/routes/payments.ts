import { Router } from 'express';
import type { Response } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { authMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';
import { getSetting, getStringSetting } from '../constants.js';
import { activateUser } from './auth.js';

const router = Router();

const VALID_TYPES = [
  'nb',
  'sub_basic_1m', 'sub_basic_3m', 'sub_basic_12m',
  'sub_premium_1m', 'sub_premium_3m', 'sub_premium_12m',
] as const;
type PaymentType = typeof VALID_TYPES[number];

function isSandbox(): boolean {
  return process.env['NOWPAYMENTS_SANDBOX'] === 'true';
}

function getApiBase(): string {
  return isSandbox() ? 'https://api-sandbox.nowpayments.io/v1' : 'https://api.nowpayments.io/v1';
}

interface PromoRow {
  code: string; type: string; value: number; sub_tier: string | null;
  max_uses: number; use_count: number; expires_at: string | null; active: number;
}

function validatePromoForPayment(code: string, userId: number, planTier: string): { valid: true; promo: PromoRow } | { valid: false; error: string } {
  const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code) as PromoRow | undefined;
  if (!promo) return { valid: false, error: "promo code doesn't exist." };
  if (!promo.active) return { valid: false, error: "promo code is deactivated." };
  if (promo.type !== 'discount_pct') return { valid: false, error: "this code isn't a discount." };
  if (promo.expires_at && new Date(promo.expires_at + 'Z') < new Date()) {
    return { valid: false, error: "promo code expired." };
  }
  if (promo.max_uses > 0 && promo.use_count >= promo.max_uses) {
    return { valid: false, error: "promo code is maxed out." };
  }
  if (promo.sub_tier && promo.sub_tier !== planTier) {
    return { valid: false, error: `this code only works for ${promo.sub_tier} plans.` };
  }
  const used = db.prepare('SELECT id FROM promo_uses WHERE promo_code = ? AND user_id = ?').get(code, userId);
  if (used) return { valid: false, error: "you already used this code." };
  return { valid: true, promo };
}

// ── POST /api/payments/create (auth) ──
router.post('/create', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { type, nb_amount, promo_code } = req.body as { type?: string; nb_amount?: number; promo_code?: string };

  if (!type || !VALID_TYPES.includes(type as PaymentType)) {
    res.status(400).json({ error: "invalid payment type. what are you trying to buy?" });
    return;
  }

  const paymentType = type as PaymentType;

  // Prevent subscription downgrade (e.g. buying Basic when you have Pro)
  if (paymentType !== 'nb') {
    const activeSub = db.prepare(
      'SELECT type FROM subscriptions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1'
    ).get(userId) as { type: string } | undefined;

    if (activeSub) {
      const roleLevel: Record<string, number> = { basic: 2, premium: 3 };
      const currentSubRole = activeSub.type.includes('premium') ? 'premium' : activeSub.type.includes('basic') ? 'basic' : '';
      const newSubRole = paymentType.includes('premium') ? 'premium' : 'basic';
      if ((roleLevel[currentSubRole] ?? 0) > (roleLevel[newSubRole] ?? 0)) {
        res.status(400).json({ error: `you already have premium. downgrading is not a thing.` });
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
    const priceMap: Record<string, [string, number, number, string]> = {
      sub_basic_1m:  ['sub_basic_1m_eur',  2.99, 1,  'Basic 1 Month'],
      sub_basic_3m:  ['sub_basic_3m_eur',  2.49, 3,  'Basic 3 Months'],
      sub_basic_12m: ['sub_basic_12m_eur', 1.99, 12, 'Basic 12 Months'],
      sub_premium_1m:    ['sub_premium_1m_eur',    6.69, 1,  'Premium 1 Month'],
      sub_premium_3m:    ['sub_premium_3m_eur',    5.49, 3,  'Premium 3 Months'],
      sub_premium_12m:   ['sub_premium_12m_eur',   4.49, 12, 'Premium 12 Months'],
    };
    const [settingKey, fallback, months, label] = priceMap[paymentType]!;
    const perMonth = getSetting(settingKey!, fallback!);
    amountEur = Math.round(perMonth * months! * 100) / 100;
    description = `${label} Subscription`;
  }

  // Apply promo discount if provided
  let appliedPromo: string | null = null;
  if (promo_code && paymentType !== 'nb') {
    const planTier = paymentType.includes('premium') ? 'premium' : 'basic';
    const promoResult = validatePromoForPayment(promo_code.toUpperCase().trim(), userId, planTier);
    if (!promoResult.valid) {
      res.status(400).json({ error: promoResult.error });
      return;
    }
    const discount = promoResult.promo.value / 100;
    amountEur = Math.round(amountEur * (1 - discount) * 100) / 100;
    if (amountEur < 0.50) amountEur = 0.50; // min payment floor
    appliedPromo = promo_code.toUpperCase().trim();
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

    // Store payment in DB + track promo usage atomically
    db.transaction(() => {
      db.prepare(`
        INSERT INTO payments (id, user_id, nowpayments_id, type, amount_eur, nb_amount, status, invoice_url, promo_code)
        VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?)
      `).run(paymentId, userId, invoiceData.id, paymentType, amountEur, nbToCredit, invoiceData.invoice_url, appliedPromo);

      if (appliedPromo) {
        db.prepare('UPDATE promo_codes SET use_count = use_count + 1 WHERE code = ?').run(appliedPromo);
        db.prepare('INSERT INTO promo_uses (promo_code, user_id) VALUES (?, ?)').run(appliedPromo, userId);
      }
    })();

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

  // Subscription — duration-based
  const subTypeMap: Record<string, { role: string; days: number }> = {
    sub_basic_1m:  { role: 'basic', days: 30 },
    sub_basic_3m:  { role: 'basic', days: 90 },
    sub_basic_12m: { role: 'basic', days: 365 },
    sub_premium_1m:    { role: 'premium',   days: 30 },
    sub_premium_3m:    { role: 'premium',   days: 90 },
    sub_premium_12m:   { role: 'premium',   days: 365 },
  };

  const subInfo = subTypeMap[payment.type];
  if (!subInfo) return;

  // Atomic: deactivate old sub + create new + upgrade role + activate pending user
  db.transaction(() => {
    db.prepare('UPDATE subscriptions SET is_active = 0 WHERE user_id = ? AND is_active = 1').run(payment.user_id);

    const subType = payment.type.replace('sub_', '');
    const expiresAt = new Date(Date.now() + subInfo.days * 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').replace('Z', '').split('.')[0]!;

    db.prepare(`
      INSERT INTO subscriptions (user_id, type, payment_id, starts_at, expires_at, is_active)
      VALUES (?, ?, ?, datetime('now'), ?, 1)
    `).run(payment.user_id, subType, payment.id, expiresAt);

    const currentUser = db.prepare('SELECT role, email FROM users WHERE id = ?').get(payment.user_id) as { role: string; email: string } | undefined;
    const currentRole = currentUser?.role ?? 'user';

    // If user is pending, activate them (create filesystem, settings, email address)
    if (currentRole === 'pending') {
      const localPart = (currentUser?.email ?? '').split('@')[0] ?? '';
      activateUser(payment.user_id, localPart, subInfo.role);
      console.log(`[payments] activated pending user ${payment.user_id} as ${subInfo.role}`);
    } else {
      const roleLevel: Record<string, number> = { user: 1, basic: 2, premium: 3, admin: 4 };
      const currentLevel = roleLevel[currentRole] ?? 0;
      const newLevel = roleLevel[subInfo.role] ?? 0;

      if (newLevel > currentLevel) {
        db.prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(subInfo.role, payment.user_id);
        console.log(`[payments] upgraded user ${payment.user_id} from ${currentRole} to ${subInfo.role}`);
      }
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

const RENEW_MAP: Record<string, { settingKey: string; fallback: number; months: number; role: string; days: number }> = {
  basic_1m:  { settingKey: 'sub_basic_1m_eur',  fallback: 2.99, months: 1,  role: 'basic', days: 30  },
  basic_3m:  { settingKey: 'sub_basic_3m_eur',  fallback: 2.49, months: 3,  role: 'basic', days: 90  },
  basic_12m: { settingKey: 'sub_basic_12m_eur', fallback: 1.99, months: 12, role: 'basic', days: 365 },
  premium_1m:    { settingKey: 'sub_premium_1m_eur',    fallback: 6.69, months: 1,  role: 'premium',   days: 30  },
  premium_3m:    { settingKey: 'sub_premium_3m_eur',    fallback: 5.49, months: 3,  role: 'premium',   days: 90  },
  premium_12m:   { settingKey: 'sub_premium_12m_eur',   fallback: 4.49, months: 12, role: 'premium',   days: 365 },
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
  const roleLevel: Record<string, number> = { user: 1, basic: 2, premium: 3, admin: 4 };

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
      if (renewed) continue;
    }

    db.prepare('UPDATE subscriptions SET is_active = 0 WHERE id = ?').run(sub.id);

    // Check if user has any other active subscription
    const otherActive = db.prepare(
      'SELECT type FROM subscriptions WHERE user_id = ? AND is_active = 1 AND id != ? ORDER BY id DESC LIMIT 1'
    ).get(sub.user_id, sub.id) as { type: string } | undefined;

    if (otherActive) continue;

    // Downgrade to "user" (but don't downgrade admin)
    const currentRole = (db.prepare('SELECT role FROM users WHERE id = ?').get(sub.user_id) as { role: string } | undefined)?.role ?? 'user';
    const currentLevel = roleLevel[currentRole] ?? 0;

    if (currentLevel >= 2 && currentLevel < 4) {
      db.prepare("UPDATE users SET role = 'user', updated_at = datetime('now') WHERE id = ?").run(sub.user_id);
      console.log(`[payments] downgraded user ${sub.user_id} from ${currentRole} to user (sub expired)`);
    }
  }
}

// ── Cleanup stale pending users (no payment after 1 hour) ──

export function cleanupPendingUsers(): void {
  const stale = db.prepare(
    "SELECT id FROM users WHERE role = 'pending' AND created_at < datetime('now', '-1 hour')"
  ).all() as { id: number }[];

  if (stale.length === 0) return;

  db.transaction(() => {
    for (const u of stale) {
      db.prepare('DELETE FROM payments WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    }
  })();

  console.log(`[payments] cleaned up ${stale.length} stale pending user(s)`);
}

export default router;
