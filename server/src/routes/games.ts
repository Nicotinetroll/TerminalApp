import { Router, Response } from 'express';
import db from '../db.js';
import { authMiddleware, AuthRequest } from '../middleware.js';
import { broadcastEvent } from '../socket.js';

const router = Router();

// Rate limit tracking: userId -> timestamps[]
const submitTimestamps = new Map<number, number[]>();

function isRateLimited(userId: number): boolean {
  const now = Date.now();
  const hourAgo = now - 3600_000;
  const timestamps = submitTimestamps.get(userId) ?? [];
  const recent = timestamps.filter(t => t > hourAgo);
  submitTimestamps.set(userId, recent);
  return recent.length >= 10;
}

function recordSubmit(userId: number): void {
  const timestamps = submitTimestamps.get(userId) ?? [];
  timestamps.push(Date.now());
  submitTimestamps.set(userId, timestamps);
}

// Easter eggs for specific scores
function getEasterEgg(score: number): string | undefined {
  if (score === 69) return 'nice.';
  if (score === 420) return 'blaze it.';
  if (score === 1337) return 'h4x0r detected.';
  if (score === 0) return "bro... you didn't even try.";
  if (score === 666) return 'the devil plays games too.';
  if (score === 42) return 'the answer to life, the universe, and everything.';
  if (score === 9001) return "it's over 9000!!!!";
  if (score === 80085) return 'heh. classic.';
  return undefined;
}

const VALID_GAMES = ['snake', '2048', 'minesweeper', 'flappy', 'racing', 'invaders', 'breakout'];

// GET /api/games/leaderboard?game=snake&limit=10
router.get('/leaderboard', (req: AuthRequest, res: Response): void => {
  const game = req.query.game as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

  if (!game || !VALID_GAMES.includes(game)) {
    res.status(400).json({ error: 'invalid game. pick a real one, genius.' });
    return;
  }

  const rows = db.prepare(`
    SELECT username, MAX(score) as score, metadata, created_at
    FROM game_scores
    WHERE game = ?
    GROUP BY user_id
    ORDER BY score DESC
    LIMIT ?
  `).all(game, limit);

  res.json({ scores: rows });
});

// GET /api/games/leaderboard/all — top 5 for each game
router.get('/leaderboard/all', (_req: AuthRequest, res: Response): void => {
  const result: Record<string, unknown[]> = {};

  for (const game of VALID_GAMES) {
    const rows = db.prepare(`
      SELECT username, MAX(score) as score, created_at
      FROM game_scores
      WHERE game = ?
      GROUP BY user_id
      ORDER BY score DESC
      LIMIT 5
    `).all(game);
    result[game] = rows;
  }

  res.json({ leaderboards: result });
});

// POST /api/games/scores — submit a score (auth required)
router.post('/scores', authMiddleware, (req: AuthRequest, res: Response): void => {
  const user = req.user!;

  if (user.role === 'guest') {
    res.status(403).json({ error: "guests can look but can't touch the leaderboard. log in, scrub." });
    return;
  }

  if (isRateLimited(user.userId)) {
    res.status(429).json({ error: 'slow down gamer. 10 submissions per hour max. go outside.' });
    return;
  }

  const { game, score, metadata } = req.body;

  if (!game || !VALID_GAMES.includes(game)) {
    res.status(400).json({ error: 'invalid game name. are you hacking or just stupid?' });
    return;
  }

  if (typeof score !== 'number' || score < 0 || !Number.isFinite(score)) {
    res.status(400).json({ error: 'score must be a non-negative number. nice try though.' });
    return;
  }

  const metadataStr = JSON.stringify(metadata ?? {});

  const result = db.prepare(`
    INSERT INTO game_scores (user_id, username, game, score, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.userId, user.username, game, Math.floor(score), metadataStr);

  // Calculate rank (by personal bests, not total rows)
  const rankRow = db.prepare(`
    SELECT COUNT(*) as rank FROM (
      SELECT user_id, MAX(score) as best
      FROM game_scores WHERE game = ?
      GROUP BY user_id
      HAVING best > ?
    )
  `).get(game, Math.floor(score)) as { rank: number };

  const rank = rankRow.rank + 1;

  recordSubmit(user.userId);

  const easter_egg = getEasterEgg(Math.floor(score));

  const response: Record<string, unknown> = {
    ok: true,
    id: result.lastInsertRowid,
    rank,
  };

  if (easter_egg) {
    response.easter_egg = easter_egg;
  }

  // Broadcast new #1 record
  if (rank === 1) {
    broadcastEvent({ type: 'record', message: `🏆 new all-time record in ${game}! someone is built different.` });
  }

  // Bonus roasts based on rank
  if (rank === 1) {
    response.message = "you're #1. for now.";
  } else if (rank <= 3) {
    response.message = `rank #${rank}. podium material.`;
  } else if (rank <= 10) {
    response.message = `rank #${rank}. top 10 baby.`;
  }

  res.json(response);
});

// GET /api/games/my-scores — personal bests per game
router.get('/my-scores', authMiddleware, (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const rows = db.prepare(`
    SELECT game, MAX(score) as best_score,
           COUNT(*) as total_games,
           created_at as last_played
    FROM game_scores
    WHERE user_id = ?
    GROUP BY game
    ORDER BY game
  `).all(userId);

  res.json({ scores: rows });
});

export default router;
