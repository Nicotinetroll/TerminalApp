import { Router } from 'express';
import { randomUUID, randomBytes } from 'crypto';
import { Chess } from 'chess.js';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import type { AuthRequest } from '../middleware.js';
import { authMiddleware } from '../middleware.js';

const router = Router();

function gameId(): string {
  return randomBytes(6).toString('hex');
}

function playerToken(): string {
  return randomUUID();
}

interface ChessGameRow {
  id: string;
  white_token: string;
  black_token: string | null;
  white_user_id: number | null;
  black_user_id: number | null;
  white_name: string;
  black_name: string | null;
  status: string;
  fen: string;
  pgn: string;
  moves: string;
  result: string | null;
  result_reason: string | null;
  draw_offer_by: string | null;
  is_bot: number;
  bot_level: number | null;
  time_control: number | null;
  white_time_left: number | null;
  black_time_left: number | null;
  last_move_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MoveEntry {
  from: string;
  to: string;
  san: string;
  ts: number;
}

const BOT_NAMES = [
  'Drunk Intern',
  'Script Kiddie',
  'Mid Dev',
  'Senior Engineer',
  'Tech Lead',
  'Stockfish Daddy',
];

function tryExtractUser(authHeader: string | undefined): { userId: number; userName: string } | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const decoded = jwt.verify(authHeader.slice(7), secret) as { userId: number; email: string };
    return { userId: decoded.userId, userName: decoded.email.split('@')[0] || 'Anonymous' };
  } catch {
    return null;
  }
}

function sanitizeGame(game: ChessGameRow) {
  const moves = JSON.parse(game.moves) as MoveEntry[];
  return {
    id: game.id,
    whiteName: game.white_name,
    blackName: game.black_name,
    status: game.status,
    fen: game.fen,
    pgn: game.pgn,
    moves,
    moveCount: moves.length,
    result: game.result,
    resultReason: game.result_reason,
    drawOfferBy: game.draw_offer_by,
    isBot: !!game.is_bot,
    botLevel: game.bot_level,
    timeControl: game.time_control,
    whiteTimeLeft: game.white_time_left,
    blackTimeLeft: game.black_time_left,
    lastMoveAt: game.last_move_at,
    createdAt: game.created_at,
  };
}

// ── GET /my/games — Get user's games (requires auth) ──
// MUST be before /:id to avoid matching "my" as an id
router.get('/my/games', authMiddleware, (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const games = db.prepare(`
    SELECT * FROM chess_games
    WHERE (white_user_id = ? OR black_user_id = ?) AND status IN ('waiting', 'active')
    ORDER BY created_at DESC LIMIT 20
  `).all(userId, userId) as ChessGameRow[];

  res.json({
    games: games.map(g => ({
      ...sanitizeGame(g),
      myToken: g.white_user_id === userId ? g.white_token : g.black_token,
      myColor: g.white_user_id === userId ? 'white' : 'black',
    })),
  });
});

// ── POST /create — Create a new game ──
router.post('/create', (req, res) => {
  const user = tryExtractUser(req.headers.authorization);
  const userId = user?.userId ?? null;
  const userName = user?.userName ?? 'Anonymous';

  const { color, timeControl, botLevel } = req.body as {
    color?: 'white' | 'black' | 'random';
    timeControl?: number;
    botLevel?: number;
  };

  const id = gameId();
  const wToken = playerToken();
  const bToken = playerToken();

  let creatorColor: 'white' | 'black' = 'white';
  if (color === 'black') creatorColor = 'black';
  else if (color === 'random') creatorColor = Math.random() < 0.5 ? 'white' : 'black';

  const isBot = botLevel !== undefined && Number.isInteger(botLevel) && botLevel >= 0 && botLevel <= 5;
  const botName = isBot ? BOT_NAMES[botLevel!] ?? 'Bot' : null;
  const tc = timeControl && timeControl > 0 ? Math.min(timeControl, 3600) : null;
  const timeMs = tc ? tc * 1000 : null;
  const startTime = isBot ? new Date().toISOString() : null;

  if (creatorColor === 'white') {
    db.prepare(`
      INSERT INTO chess_games (id, white_token, black_token, white_user_id, white_name, black_name, status, is_bot, bot_level, time_control, white_time_left, black_time_left, last_move_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, wToken, bToken, userId, userName, botName, isBot ? 'active' : 'waiting', isBot ? 1 : 0, isBot ? botLevel : null, tc, timeMs, timeMs, startTime);

    res.json({ gameId: id, token: wToken, botToken: isBot ? bToken : undefined, color: 'white', shareUrl: `/c/${id}` });
  } else {
    db.prepare(`
      INSERT INTO chess_games (id, white_token, black_token, black_user_id, black_name, white_name, status, is_bot, bot_level, time_control, white_time_left, black_time_left, last_move_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, wToken, bToken, userId, userName, botName ?? 'Waiting...', isBot ? 'active' : 'waiting', isBot ? 1 : 0, isBot ? botLevel : null, tc, timeMs, timeMs, startTime);

    res.json({ gameId: id, token: bToken, botToken: isBot ? wToken : undefined, color: 'black', shareUrl: `/c/${id}` });
  }
});

// ── POST /join/:id — Join an existing game ──
router.post('/join/:id', (req, res) => {
  const game = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(req.params.id) as ChessGameRow | undefined;
  if (!game) { res.status(404).json({ error: 'game not found' }); return; }
  if (game.status !== 'waiting') { res.status(400).json({ error: 'game already started or finished' }); return; }

  const user = tryExtractUser(req.headers.authorization);
  const userId = user?.userId ?? null;
  const userName = user?.userName ?? (req.body as { name?: string }).name ?? 'Anonymous';

  if (userId && (userId === game.white_user_id || userId === game.black_user_id)) {
    res.status(400).json({ error: "you can't play against yourself, weirdo" });
    return;
  }

  const now = new Date().toISOString();

  // Atomic update with WHERE status='waiting' to prevent double-join race condition
  if (!game.black_name || game.black_name === 'Waiting...') {
    const result = db.prepare(`UPDATE chess_games SET black_user_id = ?, black_name = ?, status = 'active', last_move_at = ?, updated_at = datetime('now') WHERE id = ? AND status = 'waiting'`).run(userId, userName, now, game.id);
    if (result.changes === 0) { res.status(400).json({ error: 'game already started or finished' }); return; }
    const updated = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id) as ChessGameRow;
    res.json({ token: game.black_token, color: 'black', game: sanitizeGame(updated) });
  } else {
    const result = db.prepare(`UPDATE chess_games SET white_user_id = ?, white_name = ?, status = 'active', last_move_at = ?, updated_at = datetime('now') WHERE id = ? AND status = 'waiting'`).run(userId, userName, now, game.id);
    if (result.changes === 0) { res.status(400).json({ error: 'game already started or finished' }); return; }
    const updated = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id) as ChessGameRow;
    res.json({ token: game.white_token, color: 'white', game: sanitizeGame(updated) });
  }
});

// ── GET /:id — Get game state (public) ──
router.get('/:id', (req, res) => {
  const game = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(req.params.id) as ChessGameRow | undefined;
  if (!game) { res.status(404).json({ error: 'game not found' }); return; }
  res.json({ game: sanitizeGame(game) });
});

// ── GET /:id/poll — Poll for updates ──
router.get('/:id/poll', (req, res) => {
  const { token, since } = req.query as { token?: string; since?: string };
  if (!token) { res.status(401).json({ error: 'token required' }); return; }

  const game = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(req.params.id) as ChessGameRow | undefined;
  if (!game) { res.status(404).json({ error: 'game not found' }); return; }

  if (token !== game.white_token && token !== game.black_token) {
    res.status(403).json({ error: 'invalid token' }); return;
  }

  const moves = JSON.parse(game.moves) as MoveEntry[];
  const sinceNum = parseInt(since || '0', 10) || 0;
  const sinceDraw = (req.query as Record<string, string>).draw || '';

  // Return update if moves changed, game ended, or draw offer changed
  const gameEnded = game.status !== 'active';
  const drawChanged = (game.draw_offer_by || '') !== sinceDraw;
  if (moves.length > sinceNum || gameEnded || drawChanged) {
    res.json({ game: sanitizeGame(game), updated: true });
  } else {
    res.json({ updated: false });
  }
});

// ── POST /:id/move — Make a move ──
router.post('/:id/move', (req, res) => {
  const { token, from, to, promotion } = req.body as {
    token: string; from: string; to: string; promotion?: string;
  };

  if (!token || !from || !to) {
    res.status(400).json({ error: 'token, from, and to are required' }); return;
  }

  const game = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(req.params.id) as ChessGameRow | undefined;
  if (!game) { res.status(404).json({ error: 'game not found' }); return; }
  if (game.status !== 'active') { res.status(400).json({ error: 'game is not active' }); return; }

  let playerColor: 'w' | 'b';
  if (token === game.white_token) playerColor = 'w';
  else if (token === game.black_token) playerColor = 'b';
  else { res.status(403).json({ error: 'invalid token' }); return; }

  const chess = new Chess(game.fen);
  if (chess.turn() !== playerColor) {
    res.status(400).json({ error: "not your turn, chill" }); return;
  }

  const now = new Date().toISOString();

  // Check time BEFORE accepting the move
  let whiteTime = game.white_time_left;
  let blackTime = game.black_time_left;
  if (game.time_control && game.last_move_at) {
    const elapsed = Date.now() - new Date(game.last_move_at).getTime();
    if (playerColor === 'w' && whiteTime !== null) {
      whiteTime = Math.max(0, whiteTime - elapsed);
      if (whiteTime <= 0) {
        db.prepare(`UPDATE chess_games SET status = 'finished', result = '0-1', result_reason = 'timeout', white_time_left = 0, updated_at = datetime('now') WHERE id = ?`).run(game.id);
        const updated = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id) as ChessGameRow;
        res.json({ ok: true, ...sanitizeGame(updated) }); return;
      }
    } else if (playerColor === 'b' && blackTime !== null) {
      blackTime = Math.max(0, blackTime - elapsed);
      if (blackTime <= 0) {
        db.prepare(`UPDATE chess_games SET status = 'finished', result = '1-0', result_reason = 'timeout', black_time_left = 0, updated_at = datetime('now') WHERE id = ?`).run(game.id);
        const updated = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id) as ChessGameRow;
        res.json({ ok: true, ...sanitizeGame(updated) }); return;
      }
    }
  }

  const moveResult = chess.move({ from, to, promotion: promotion || undefined });
  if (!moveResult) {
    res.status(400).json({ error: 'illegal move. nice try though.' }); return;
  }

  const moves = JSON.parse(game.moves) as MoveEntry[];
  moves.push({ from, to, san: moveResult.san, ts: Date.now() });

  // Check end conditions
  let status = 'active';
  let result: string | null = null;
  let resultReason: string | null = null;

  if (chess.isCheckmate()) {
    status = 'finished';
    result = playerColor === 'w' ? '1-0' : '0-1';
    resultReason = 'checkmate';
  } else if (chess.isStalemate()) {
    status = 'finished';
    result = '1/2-1/2';
    resultReason = 'stalemate';
  } else if (chess.isDraw()) {
    status = 'finished';
    result = '1/2-1/2';
    resultReason = chess.isThreefoldRepetition() ? 'repetition' : chess.isInsufficientMaterial() ? 'insufficient' : 'fifty_move';
  }

  db.prepare(`
    UPDATE chess_games SET fen = ?, pgn = ?, moves = ?, status = ?, result = ?, result_reason = ?,
    white_time_left = ?, black_time_left = ?, last_move_at = ?, draw_offer_by = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(chess.fen(), chess.pgn(), JSON.stringify(moves), status, result, resultReason, whiteTime, blackTime, now, game.id);

  const updated = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id) as ChessGameRow;
  res.json({ ok: true, ...sanitizeGame(updated) });
});

// ── POST /:id/resign ──
router.post('/:id/resign', (req, res) => {
  const { token } = req.body as { token: string };
  if (!token) { res.status(400).json({ error: 'token required' }); return; }

  const game = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(req.params.id) as ChessGameRow | undefined;
  if (!game) { res.status(404).json({ error: 'game not found' }); return; }
  if (game.status !== 'active') { res.status(400).json({ error: 'game is not active' }); return; }

  let result: string;
  if (token === game.white_token) result = '0-1';
  else if (token === game.black_token) result = '1-0';
  else { res.status(403).json({ error: 'invalid token' }); return; }

  db.prepare(`UPDATE chess_games SET status = 'finished', result = ?, result_reason = 'resign', updated_at = datetime('now') WHERE id = ? AND status = 'active'`).run(result, game.id);
  const updated = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id) as ChessGameRow;
  res.json({ ok: true, ...sanitizeGame(updated) });
});

// ── POST /:id/draw ──
router.post('/:id/draw', (req, res) => {
  const { token } = req.body as { token: string };
  if (!token) { res.status(400).json({ error: 'token required' }); return; }

  const game = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(req.params.id) as ChessGameRow | undefined;
  if (!game) { res.status(404).json({ error: 'game not found' }); return; }
  if (game.status !== 'active') { res.status(400).json({ error: 'game is not active' }); return; }

  let offerBy: 'white' | 'black';
  if (token === game.white_token) offerBy = 'white';
  else if (token === game.black_token) offerBy = 'black';
  else { res.status(403).json({ error: 'invalid token' }); return; }

  if (game.draw_offer_by && game.draw_offer_by !== offerBy) {
    db.prepare(`UPDATE chess_games SET status = 'finished', result = '1/2-1/2', result_reason = 'draw_agreement', draw_offer_by = NULL, updated_at = datetime('now') WHERE id = ?`).run(game.id);
    const updated = db.prepare('SELECT * FROM chess_games WHERE id = ?').get(game.id) as ChessGameRow;
    res.json({ ok: true, ...sanitizeGame(updated) });
  } else {
    db.prepare(`UPDATE chess_games SET draw_offer_by = ?, updated_at = datetime('now') WHERE id = ?`).run(offerBy, game.id);
    res.json({ ok: true, drawOffered: true });
  }
});

// ── Cleanup stale games on startup + every hour ──
function cleanupStaleGames() {
  // Abandon waiting games older than 1 hour
  db.prepare(`UPDATE chess_games SET status = 'abandoned' WHERE status = 'waiting' AND created_at < datetime('now', '-1 hour')`).run();
  // Abandon active games with no moves in 24 hours
  db.prepare(`UPDATE chess_games SET status = 'abandoned' WHERE status = 'active' AND updated_at < datetime('now', '-24 hours')`).run();
}
cleanupStaleGames();
setInterval(cleanupStaleGames, 3600_000);

export default router;
