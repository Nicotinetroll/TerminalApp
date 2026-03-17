import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { authMiddleware, adminMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';
import { broadcastEvent } from '../socket.js';
import { getEffectiveLimit } from '../constants.js';

const router = Router();

const MIN_BET_MB = 1;
const MAX_BET_MB = 999;

function getWinChance(): number {
  try {
    const row = db.prepare("SELECT value FROM global_settings WHERE key = 'coinflip_win_chance'").get() as { value: string } | undefined;
    const val = row ? parseInt(row.value, 10) : 50;
    return Math.max(5, Math.min(80, val || 50));
  } catch { return 50; }
}

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

const WIN_MESSAGES = [
  "called it.", "ez call.", "prophet.", "big brain.", "W flip.",
  "you guessed... right.", "coin respects you.", "clean read.",
  "the coin has spoken.", "you win this round.", "correct.",
];

const LOSE_MESSAGES = [
  "wrong side.", "the coin said no.", "L.", "cope.", "not your coin.",
  "imagine losing a coinflip.", "tragic.", "50/50 btw.", "rip.",
  "shoulda picked the other one.", "coin hates you.", "bad read.",
  "the universe disagrees.", "flipped off.", "coin said sike.",
];

const BROKE_MESSAGES = [
  "you're broke.", "can't afford that.", "empty pockets.", "go play slots first.",
  "touch grass.", "your balance is crying.", "stop gambling.",
];

const STREAK_MESSAGES = [
  "on a heater.", "can't stop winning.", "is the coin rigged??",
  "absolute unit.", "STREAK.", "coin whisperer.",
];

router.use(authMiddleware);

// GET /api/coinflip/balance — shared with slots
router.get('/balance', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  if (role === 'guest') {
    res.status(403).json({ error: "guests can't flip. log in first." });
    return;
  }

  const balance = db.prepare(
    'SELECT bonus_bytes, bytebucks FROM slots_balance WHERE user_id = ?'
  ).get(userId) as { bonus_bytes: number; bytebucks: number } | undefined;

  const bonusBytes = balance?.bonus_bytes ?? 0;
  const baseLimit = getEffectiveLimit(role, 0);
  const effectiveLimit = getEffectiveLimit(role, bonusBytes);

  const fsRow = db.prepare('SELECT filesystem FROM user_filesystems WHERE user_id = ?').get(userId) as
    | { filesystem: string } | undefined;
  const used = fsRow ? Buffer.byteLength(fsRow.filesystem, 'utf8') : 0;
  const availableBytes = baseLimit === 0 ? 999 * 1024 * 1024 : Math.max(0, effectiveLimit - used);

  // Coinflip stats
  const stats = db.prepare(
    `SELECT COUNT(*) as total_flips,
            COALESCE(SUM(CASE WHEN payout_bytes > 0 THEN 1 ELSE 0 END), 0) as wins,
            COALESCE(SUM(CASE WHEN payout_bytes > 0 THEN payout_bytes ELSE 0 END), 0) as total_won,
            COALESCE(SUM(CASE WHEN payout_bytes = 0 THEN bet_bytes ELSE 0 END), 0) as total_lost
     FROM coinflip_history WHERE user_id = ?`
  ).get(userId) as { total_flips: number; wins: number; total_won: number; total_lost: number };

  // Current streak
  const recentFlips = db.prepare(
    'SELECT payout_bytes FROM coinflip_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(userId) as { payout_bytes: number }[];

  let streak = 0;
  let streakType: 'win' | 'lose' | null = null;
  for (const flip of recentFlips) {
    const isWin = flip.payout_bytes > 0;
    if (streakType === null) {
      streakType = isWin ? 'win' : 'lose';
      streak = 1;
    } else if ((isWin && streakType === 'win') || (!isWin && streakType === 'lose')) {
      streak++;
    } else {
      break;
    }
  }

  res.json({
    bonus_bytes: bonusBytes,
    niggabytes: balance?.bytebucks ?? 0,
    base_limit: baseLimit,
    effective_limit: effectiveLimit,
    used,
    available_to_bet: availableBytes,
    stats: {
      total_flips: stats.total_flips,
      wins: stats.wins,
      total_won: stats.total_won,
      total_lost: stats.total_lost,
      win_rate: stats.total_flips > 0 ? stats.wins / stats.total_flips : 0,
    },
    streak: streakType === 'win' ? streak : 0,
  });
});

// POST /api/coinflip/flip
router.post('/flip', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const username = req.user!.username;
  const role = req.user!.role;

  if (role === 'guest') {
    res.status(403).json({ error: "nice try freeloader." });
    return;
  }

  const { bet_mb, choice, currency: currencyInput } = req.body as { bet_mb?: number; choice?: string; currency?: string };

  if (!bet_mb || typeof bet_mb !== 'number' || bet_mb < MIN_BET_MB || bet_mb > MAX_BET_MB || !Number.isInteger(bet_mb)) {
    res.status(400).json({ error: `bet must be ${MIN_BET_MB}-${MAX_BET_MB} MB (whole numbers).` });
    return;
  }

  const normalizedChoice = (choice ?? '').toLowerCase();
  if (normalizedChoice !== 'heads' && normalizedChoice !== 'tails') {
    res.status(400).json({ error: "pick heads or tails, genius." });
    return;
  }

  const currency = currencyInput === 'niggabytes' ? 'niggabytes' : 'storage';
  const betBytes = bet_mb * 1024 * 1024;
  const baseLimit = getEffectiveLimit(role, 0);

  // Entire flip in a transaction to prevent race conditions (double-spend)
  const doFlipTx = db.transaction(() => {
    const balance = db.prepare(
      'SELECT bonus_bytes, bytebucks FROM slots_balance WHERE user_id = ?'
    ).get(userId) as { bonus_bytes: number; bytebucks: number } | undefined;

    const bonusBytes = balance?.bonus_bytes ?? 0;
    const currentNB = balance?.bytebucks ?? 0;

    // Affordability check
    if (currency === 'niggabytes') {
      if (currentNB < bet_mb) {
        return { error: "not enough NiggaBytes. you're NB broke." } as const;
      }
    } else if (baseLimit > 0) {
      const effectiveLimit = getEffectiveLimit(role, bonusBytes);
      const fsRow = db.prepare('SELECT filesystem FROM user_filesystems WHERE user_id = ?').get(userId) as
        | { filesystem: string } | undefined;
      const used = fsRow ? Buffer.byteLength(fsRow.filesystem, 'utf8') : 0;
      const available = Math.max(0, effectiveLimit - used);
      if (betBytes > available) {
        return { error: pickRandom(BROKE_MESSAGES) } as const;
      }
    }

    // Coin flip with configurable win chance
    const winChance = getWinChance();
    const won = Math.random() * 100 < winChance;
    const outcome: 'heads' | 'tails' = won ? normalizedChoice as 'heads' | 'tails'
      : (normalizedChoice === 'heads' ? 'tails' : 'heads');
    const payoutBytes = won ? betBytes * 2 : 0;

    // Update balance based on currency
    let newBonusBytes = bonusBytes;
    let newNB = currentNB;

    if (currency === 'niggabytes') {
      newNB = won ? currentNB + bet_mb : currentNB - bet_mb;
      newNB = Math.max(0, newNB);
    } else {
      newBonusBytes = won ? bonusBytes + betBytes : bonusBytes - betBytes;
    }

    db.prepare(`
      INSERT INTO slots_balance (user_id, bonus_bytes, total_won, total_lost, spins, bytebucks, updated_at)
      VALUES (?, ?, 0, 0, 0, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        bonus_bytes = ?,
        bytebucks = ?,
        updated_at = datetime('now')
    `).run(userId, newBonusBytes, newNB, newBonusBytes, newNB);

    // Record in coinflip history
    db.prepare(`
      INSERT INTO coinflip_history (user_id, bet_bytes, choice, outcome, payout_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(userId, betBytes, normalizedChoice, outcome, payoutBytes);

    // Calculate streak after this flip
    const recentFlips = db.prepare(
      'SELECT payout_bytes FROM coinflip_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(userId) as { payout_bytes: number }[];

    let streak = 0;
    for (const flip of recentFlips) {
      if (flip.payout_bytes > 0) streak++;
      else break;
    }

    // Pick message
    let message: string;
    if (won && streak >= 5) {
      message = pickRandom(STREAK_MESSAGES);
    } else if (won) {
      message = pickRandom(WIN_MESSAGES);
    } else {
      message = pickRandom(LOSE_MESSAGES);
    }

    // Easter eggs
    const flipCount = db.prepare('SELECT COUNT(*) as c FROM coinflip_history WHERE user_id = ?').get(userId) as { c: number };
    if (flipCount.c === 69) message = "nice.";
    if (flipCount.c === 420) message = "blaze the flip.";
    if (flipCount.c === 666) message = "the devil flips.";
    if (flipCount.c === 1000) message = "1000 flips. seek help.";

    // Return updated balance
    const newEffectiveLimit = getEffectiveLimit(role, newBonusBytes);
    const fsRow2 = db.prepare('SELECT filesystem FROM user_filesystems WHERE user_id = ?').get(userId) as
      | { filesystem: string } | undefined;
    const usedNow = fsRow2 ? Buffer.byteLength(fsRow2.filesystem, 'utf8') : 0;

    return {
      choice: normalizedChoice,
      outcome,
      won,
      bet_bytes: betBytes,
      payout_bytes: payoutBytes,
      message,
      streak,
      currency,
      nb_balance: newNB,
      balance: {
        bonus_bytes: newBonusBytes,
        effective_limit: newEffectiveLimit,
        used: usedNow,
        available_to_bet: baseLimit === 0 ? 999 * 1024 * 1024 : Math.max(0, newEffectiveLimit - usedNow),
      },
    } as const;
  });

  const result = doFlipTx();

  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  // Broadcast on 5+ win streak (outside transaction)
  if (result.won && result.streak >= 5) {
    broadcastEvent({
      type: 'big_win',
      message: `🪙 ${username} is on a ${result.streak}-flip win streak in coinflip. someone stop them.`,
    });
  }

  res.json(result);
});

// GET /api/coinflip/history
router.get('/history', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const rows = db.prepare(
    'SELECT id, bet_bytes, choice, outcome, payout_bytes, created_at FROM coinflip_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(userId) as { id: number; bet_bytes: number; choice: string; outcome: string; payout_bytes: number; created_at: string }[];

  res.json({ history: rows });
});

// ── Admin ──

router.get('/admin/players', adminMiddleware, (_req: AuthRequest, res: Response): void => {
  const rows = db.prepare(`
    SELECT
      u.id as user_id,
      u.username,
      u.role,
      COALESCE(sb.bonus_bytes, 0) as bonus_bytes,
      COALESCE(cf.flips, 0) as flips,
      COALESCE(cf.wins, 0) as wins,
      COALESCE(cf.total_won, 0) as total_won,
      COALESCE(cf.total_lost, 0) as total_lost
    FROM users u
    LEFT JOIN slots_balance sb ON sb.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
        COUNT(*) as flips,
        SUM(CASE WHEN payout_bytes > 0 THEN 1 ELSE 0 END) as wins,
        COALESCE(SUM(CASE WHEN payout_bytes > 0 THEN payout_bytes ELSE 0 END), 0) as total_won,
        COALESCE(SUM(CASE WHEN payout_bytes = 0 THEN bet_bytes ELSE 0 END), 0) as total_lost
      FROM coinflip_history
      GROUP BY user_id
    ) cf ON cf.user_id = u.id
    WHERE COALESCE(cf.flips, 0) > 0
    ORDER BY COALESCE(cf.flips, 0) DESC
  `).all() as {
    user_id: number; username: string; role: string;
    bonus_bytes: number; flips: number; wins: number;
    total_won: number; total_lost: number;
  }[];

  const players = rows.map(r => ({
    userId: r.user_id,
    username: r.username,
    role: r.role,
    bonus_bytes: r.bonus_bytes,
    flips: r.flips,
    wins: r.wins,
    total_won: r.total_won,
    total_lost: r.total_lost,
    win_rate: r.flips > 0 ? r.wins / r.flips : 0,
  }));

  res.json({ players });
});

router.delete('/admin/reset/:userId', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const targetId = parseInt(req.params['userId'] as string, 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: 'invalid user id.' });
    return;
  }
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(targetId) as { username: string } | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found.' });
    return;
  }
  db.prepare('DELETE FROM coinflip_history WHERE user_id = ?').run(targetId);
  res.json({ ok: true, message: `${user.username}'s coinflip history wiped.` });
});

router.get('/admin/config', adminMiddleware, (_req: AuthRequest, res: Response): void => {
  res.json({ win_chance: getWinChance() });
});

router.put('/admin/config', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const { win_chance } = req.body as { win_chance?: number };

  if (typeof win_chance !== 'number' || win_chance < 5 || win_chance > 80) {
    res.status(400).json({ error: 'win_chance must be 5-80.' });
    return;
  }

  db.prepare(
    `INSERT INTO global_settings (key, value, updated_at) VALUES ('coinflip_win_chance', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(String(Math.round(win_chance)));

  res.json({ ok: true, win_chance: Math.round(win_chance) });
});

export default router;
