import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { authMiddleware, adminMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';
import { logAudit } from '../audit.js';

const router = Router();
router.use(authMiddleware);
router.use(adminMiddleware);

// GET /api/casino/admin/players — unified player list
router.get('/admin/players', (_req: AuthRequest, res: Response): void => {
  const rows = db.prepare(`
    SELECT
      u.id as user_id,
      u.username,
      u.role,
      COALESCE(sb.bytebucks, 0) as bytebucks,
      COALESCE(sb.bonus_bytes, 0) as bonus_bytes,
      COALESCE(sb.spins, 0) as spins,
      COALESCE(ss.wins, 0) as slots_wins,
      COALESCE(ss.total, 0) as slots_total,
      COALESCE(cf.flips, 0) as cf_flips,
      COALESCE(cf.wins, 0) as cf_wins
    FROM users u
    LEFT JOIN slots_balance sb ON sb.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
        COUNT(*) as total,
        SUM(CASE WHEN result != 'lose' THEN 1 ELSE 0 END) as wins
      FROM slots_history GROUP BY user_id
    ) ss ON ss.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
        COUNT(*) as flips,
        SUM(CASE WHEN payout_bytes > 0 THEN 1 ELSE 0 END) as wins
      FROM coinflip_history GROUP BY user_id
    ) cf ON cf.user_id = u.id
    WHERE COALESCE(sb.spins, 0) > 0 OR COALESCE(cf.flips, 0) > 0
    ORDER BY COALESCE(sb.spins, 0) + COALESCE(cf.flips, 0) DESC
  `).all() as {
    user_id: number; username: string; role: string;
    bytebucks: number; bonus_bytes: number; spins: number;
    slots_wins: number; slots_total: number;
    cf_flips: number; cf_wins: number;
  }[];

  const players = rows.map(r => ({
    userId: r.user_id,
    username: r.username,
    role: r.role,
    niggabytes: r.bytebucks,
    bonus_bytes: r.bonus_bytes,
    slots_spins: r.spins,
    slots_wr: r.slots_total > 0 ? r.slots_wins / r.slots_total : 0,
    cf_flips: r.cf_flips,
    cf_wr: r.cf_flips > 0 ? r.cf_wins / r.cf_flips : 0,
  }));

  res.json({ players });
});

// GET /api/casino/admin/config — both configs
router.get('/admin/config', (_req: AuthRequest, res: Response): void => {
  // Slots RTP
  let slotsRtp = 92;
  try {
    const row = db.prepare("SELECT value FROM global_settings WHERE key = 'slots_rtp_target'").get() as { value: string } | undefined;
    if (row) slotsRtp = Math.max(80, Math.min(99, parseFloat(row.value) || 92));
  } catch { /* default */ }

  // Coinflip win chance
  let coinflipWc = 50;
  try {
    const row = db.prepare("SELECT value FROM global_settings WHERE key = 'coinflip_win_chance'").get() as { value: string } | undefined;
    if (row) coinflipWc = Math.max(5, Math.min(80, parseInt(row.value, 10) || 50));
  } catch { /* default */ }

  // Payout factor uses same formula as slots.ts
  const NEUTRAL_RTP = 92;
  const deviation = (slotsRtp - NEUTRAL_RTP) / (99 - NEUTRAL_RTP);
  const payoutFactor = Math.round((1 + deviation * 0.15) * 1000) / 1000;
  const houseEdge = (100 - slotsRtp).toFixed(1);

  res.json({
    slots_rtp_target: slotsRtp,
    slots_payout_factor: payoutFactor,
    slots_house_edge: houseEdge,
    coinflip_win_chance: coinflipWc,
  });
});

// PUT /api/casino/admin/config — update either/both
router.put('/admin/config', (req: AuthRequest, res: Response): void => {
  const { slots_rtp_target, coinflip_win_chance } = req.body as { slots_rtp_target?: number; coinflip_win_chance?: number };

  if (slots_rtp_target !== undefined) {
    if (typeof slots_rtp_target !== 'number' || slots_rtp_target < 80 || slots_rtp_target > 99) {
      res.status(400).json({ error: 'slots_rtp_target must be 80-99.' });
      return;
    }
    const rounded = Math.round(slots_rtp_target * 10) / 10;
    db.prepare(
      `INSERT INTO global_settings (key, value, updated_at) VALUES ('slots_rtp_target', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(String(rounded));
  }

  if (coinflip_win_chance !== undefined) {
    if (typeof coinflip_win_chance !== 'number' || coinflip_win_chance < 5 || coinflip_win_chance > 80) {
      res.status(400).json({ error: 'coinflip_win_chance must be 5-80.' });
      return;
    }
    db.prepare(
      `INSERT INTO global_settings (key, value, updated_at) VALUES ('coinflip_win_chance', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(String(Math.round(coinflip_win_chance)));
  }

  logAudit({
    adminId: req.user!.userId, adminUsername: req.user!.username,
    action: 'casino.config', details: { slots_rtp_target, coinflip_win_chance },
  });

  res.json({ ok: true });
});

// POST /api/casino/admin/grant-nb — grant/deduct NiggaBytes
router.post('/admin/grant-nb', (req: AuthRequest, res: Response): void => {
  const { userId, amount } = req.body as { userId?: number; amount?: number };

  if (!userId || typeof amount !== 'number') {
    res.status(400).json({ error: 'need userId and amount.' });
    return;
  }

  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found.' });
    return;
  }

  // Ensure balance row exists
  db.prepare(`
    INSERT INTO slots_balance (user_id, bonus_bytes, total_won, total_lost, spins, free_spins, bytebucks, updated_at)
    VALUES (?, 0, 0, 0, 0, 0, 0, datetime('now'))
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId);

  const current = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as { bytebucks: number };
  const newNB = Math.max(0, current.bytebucks + amount);

  db.prepare('UPDATE slots_balance SET bytebucks = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(newNB, userId);

  logAudit({
    adminId: req.user!.userId, adminUsername: req.user!.username,
    action: 'casino.grant_nb', targetType: 'user', targetId: userId, targetName: user.username,
    details: { amount, newBalance: newNB },
  });

  // Easter eggs
  let easter = '';
  if (newNB === 69) easter = 'nice.';
  else if (newNB === 420) easter = 'blaze it.';
  else if (amount === 69) easter = 'nice amount.';
  else if (amount === 420) easter = 'blaze grant.';

  res.json({
    ok: true,
    username: user.username,
    niggabytes: newNB,
    message: easter || `${user.username} now has ${newNB} NB.`,
  });
});

// GET /api/casino/admin/players/:userId — player detail with history
router.get('/admin/players/:userId', (req: AuthRequest, res: Response): void => {
  const targetId = parseInt(req.params['userId'] as string, 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: 'invalid user id.' });
    return;
  }

  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId) as
    { id: number; username: string; role: string } | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found. maybe they never existed.' });
    return;
  }

  const bal = db.prepare(
    'SELECT bonus_bytes, total_won, total_lost, spins, free_spins, bytebucks FROM slots_balance WHERE user_id = ?'
  ).get(targetId) as {
    bonus_bytes: number; total_won: number; total_lost: number;
    spins: number; free_spins: number; bytebucks: number;
  } | undefined;

  // Coinflip stats
  const cfStats = db.prepare(
    'SELECT COUNT(*) as flips, SUM(CASE WHEN payout_bytes > 0 THEN 1 ELSE 0 END) as wins FROM coinflip_history WHERE user_id = ?'
  ).get(targetId) as { flips: number; wins: number };

  // Slots wins count
  const slotsWins = db.prepare(
    "SELECT COUNT(*) as wins FROM slots_history WHERE user_id = ? AND result != 'lose'"
  ).get(targetId) as { wins: number };

  const player = {
    userId: user.id,
    username: user.username,
    role: user.role,
    niggabytes: bal?.bytebucks ?? 0,
    bonus_bytes: bal?.bonus_bytes ?? 0,
    total_won: bal?.total_won ?? 0,
    total_lost: bal?.total_lost ?? 0,
    slots_spins: bal?.spins ?? 0,
    slots_wins: slotsWins.wins,
    cf_flips: cfStats.flips,
    cf_wins: cfStats.wins ?? 0,
    free_spins: bal?.free_spins ?? 0,
  };

  // Combined history (UNION ALL slots + coinflip), newest first, limit 200
  const history = db.prepare(`
    SELECT * FROM (
      SELECT
        'slots' as type,
        bet_bytes as bet,
        payout_bytes as payout,
        CASE WHEN result = 'jackpot' THEN 'win' ELSE result END as result,
        result as detail,
        created_at
      FROM slots_history WHERE user_id = ?
      UNION ALL
      SELECT
        'coinflip' as type,
        bet_bytes as bet,
        payout_bytes as payout,
        CASE WHEN payout_bytes > 0 THEN 'win' ELSE 'lose' END as result,
        choice || '→' || outcome as detail,
        created_at
      FROM coinflip_history WHERE user_id = ?
    ) ORDER BY created_at DESC LIMIT 200
  `).all(targetId, targetId) as {
    type: string; bet: number; payout: number;
    result: string; detail: string; created_at: string;
  }[];

  // Reconstruct NB balance history by walking backwards from current balance
  // This is approximate — works perfectly for NB-only players
  const currentNB = bal?.bytebucks ?? 0;
  const balancePoints: { nb: number; ts: string }[] = [];
  let nb = currentNB;

  // Walk newest→oldest, undo each change
  for (const entry of history) {
    balancePoints.push({ nb, ts: entry.created_at });
    const betNB = Math.round(entry.bet / (1024 * 1024));
    const payoutNB = Math.round(entry.payout / (1024 * 1024));
    if (entry.result === 'win') {
      // Undo win: subtract net gain
      nb -= (payoutNB - betNB);
    } else {
      // Undo loss: add bet back
      nb += betNB;
    }
  }

  // Add starting point
  if (history.length > 0) {
    balancePoints.push({ nb, ts: history[history.length - 1]!.created_at });
  }

  // Reverse to get chronological order
  balancePoints.reverse();

  res.json({ player, history, balance_history: balancePoints });
});

// DELETE /api/casino/admin/reset/:userId — reset ALL casino data
router.delete('/admin/reset/:userId', (req: AuthRequest, res: Response): void => {
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

  const resetTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO slots_balance (user_id, bonus_bytes, total_won, total_lost, spins, free_spins, bytebucks, updated_at)
      VALUES (?, 0, 0, 0, 0, 0, 0, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        bonus_bytes = 0, total_won = 0, total_lost = 0, spins = 0, free_spins = 0, bytebucks = 0, updated_at = datetime('now')
    `).run(targetId);
    db.prepare('DELETE FROM slots_history WHERE user_id = ?').run(targetId);
    db.prepare('DELETE FROM coinflip_history WHERE user_id = ?').run(targetId);
  });
  resetTx();

  res.json({ ok: true, message: `${user.username}'s entire casino career has been erased. clean slate.` });
});

export default router;
