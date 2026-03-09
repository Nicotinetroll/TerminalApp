import { Router, type Response, type RequestHandler } from 'express';
import multer from 'multer';
import db from '../db.js';
import { authMiddleware, type AuthRequest } from '../middleware.js';

const router = Router();

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const PAGE_SIZE = 20;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`file type ${file.mimetype} not allowed — images only bitch`));
  },
});

// Optional auth — sets req.user if token present, but doesn't reject
const optionalAuth: RequestHandler = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }
  (authMiddleware as (req: AuthRequest, res: Response, next: () => void) => void)(req as AuthRequest, res, next);
};

// ── Helpers ──

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function getUserVotes(userId: number, memeIds: number[]): Map<number, number> {
  if (memeIds.length === 0) return new Map();
  const ph = memeIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT meme_id, value FROM meme_votes WHERE user_id = ? AND meme_id IN (${ph})`).all(userId, ...memeIds) as { meme_id: number; value: number }[];
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.meme_id, r.value);
  return m;
}

// ── GET / — list memes ──
router.get('/', optionalAuth, (req: AuthRequest, res: Response) => {
  try {
    const sort = (req.query['sort'] as string) || 'hot';
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    let orderClause: string;
    switch (sort) {
      case 'top':
        orderClause = '(m.upvotes - m.downvotes) DESC, m.created_at DESC';
        break;
      case 'new':
        orderClause = 'm.created_at DESC';
        break;
      case 'hot':
      default:
        orderClause = `CAST((m.upvotes - m.downvotes) AS REAL) / POWER((JULIANDAY('now') - JULIANDAY(m.created_at)) * 24.0 + 2.0, 1.5) DESC, m.created_at DESC`;
        break;
    }

    const rows = db.prepare(`
      SELECT m.id, m.user_id, m.username, m.upvotes, m.downvotes,
             (m.upvotes - m.downvotes) as score, m.created_at
      FROM memes m
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
    `).all(PAGE_SIZE + 1, offset) as { id: number; user_id: number; username: string; upvotes: number; downvotes: number; score: number; created_at: string }[];

    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE);
    const memeIds = items.map(r => r.id);
    const userId = req.user?.userId;
    const votes = userId ? getUserVotes(userId, memeIds) : new Map<number, number>();

    const memes = items.map(r => ({
      id: r.id,
      username: r.username,
      upvotes: r.upvotes,
      downvotes: r.downvotes,
      score: r.score,
      my_vote: votes.get(r.id) ?? 0,
      time_ago: timeAgo(r.created_at),
      created_at: r.created_at,
      image_url: `/api/memes/${r.id}/image`,
    }));

    res.json({ memes, has_more: hasMore });
  } catch (err) {
    console.error('[memes] list error:', err);
    res.status(500).json({ error: 'failed to load memes' });
  }
});

// ── GET /:id/image — serve raw image ──
router.get('/:id/image', (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }

    const row = db.prepare('SELECT data, mime_type, filename FROM memes WHERE id = ?').get(id) as { data: Buffer; mime_type: string; filename: string } | undefined;
    if (!row) { res.status(404).json({ error: 'meme not found — it died' }); return; }

    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Disposition', `inline; filename="${row.filename}"`);
    res.send(row.data);
  } catch (err) {
    console.error('[memes] image error:', err);
    res.status(500).json({ error: 'image serving failed' });
  }
});

// ── POST / — upload meme (auth required) ──
router.post('/', authMiddleware as RequestHandler, upload.single('image'), (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
    if (user.role === 'guest') { res.status(403).json({ error: 'guests can\'t post memes. get an account.' }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: 'no image uploaded. where\'s the meme bro?' }); return; }

    const result = db.prepare(`
      INSERT INTO memes (user_id, username, filename, mime_type, size, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(user.userId, user.username, file.originalname, file.mimetype, file.size, file.buffer);

    res.json({
      ok: true,
      meme: {
        id: result.lastInsertRowid,
        username: user.username,
        upvotes: 0,
        downvotes: 0,
        score: 0,
        my_vote: 0,
        image_url: `/api/memes/${result.lastInsertRowid}/image`,
      },
    });
  } catch (err) {
    console.error('[memes] upload error:', err);
    res.status(500).json({ error: 'upload failed' });
  }
});

// ── DELETE /:id — delete own meme (or admin) ──
router.delete('/:id', authMiddleware as RequestHandler, (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }

    const id = parseInt(req.params['id'] as string);
    if (isNaN(id)) { res.status(400).json({ error: 'invalid id' }); return; }

    const meme = db.prepare('SELECT user_id FROM memes WHERE id = ?').get(id) as { user_id: number } | undefined;
    if (!meme) { res.status(404).json({ error: 'meme not found' }); return; }

    if (meme.user_id !== user.userId && user.role !== 'admin') {
      res.status(403).json({ error: 'you can only delete your own memes, dickhead' });
      return;
    }

    db.prepare('DELETE FROM memes WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[memes] delete error:', err);
    res.status(500).json({ error: 'delete failed' });
  }
});

// ── POST /vote — vote on a meme ──
router.post('/vote', authMiddleware as RequestHandler, (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }

    const { meme_id, value } = req.body as { meme_id: number; value: number };
    if (!meme_id || (value !== 1 && value !== -1)) {
      res.status(400).json({ error: 'need meme_id and value (1 or -1)' });
      return;
    }

    const meme = db.prepare('SELECT id, user_id, upvotes, downvotes FROM memes WHERE id = ?').get(meme_id) as { id: number; user_id: number; upvotes: number; downvotes: number } | undefined;
    if (!meme) { res.status(404).json({ error: 'meme not found' }); return; }

    const txn = db.transaction(() => {
      const existing = db.prepare('SELECT value FROM meme_votes WHERE user_id = ? AND meme_id = ?').get(user.userId, meme_id) as { value: number } | undefined;

      if (existing) {
        if (existing.value === value) {
          // Toggle off
          db.prepare('DELETE FROM meme_votes WHERE user_id = ? AND meme_id = ?').run(user.userId, meme_id);
          if (value === 1) db.prepare('UPDATE memes SET upvotes = upvotes - 1 WHERE id = ?').run(meme_id);
          else db.prepare('UPDATE memes SET downvotes = downvotes - 1 WHERE id = ?').run(meme_id);
        } else {
          // Swing by 2
          db.prepare('UPDATE meme_votes SET value = ? WHERE user_id = ? AND meme_id = ?').run(value, user.userId, meme_id);
          if (value === 1) {
            db.prepare('UPDATE memes SET upvotes = upvotes + 1, downvotes = downvotes - 1 WHERE id = ?').run(meme_id);
          } else {
            db.prepare('UPDATE memes SET downvotes = downvotes + 1, upvotes = upvotes - 1 WHERE id = ?').run(meme_id);
          }
        }
      } else {
        // New vote
        db.prepare('INSERT INTO meme_votes (user_id, meme_id, value) VALUES (?, ?, ?)').run(user.userId, meme_id, value);
        if (value === 1) db.prepare('UPDATE memes SET upvotes = upvotes + 1 WHERE id = ?').run(meme_id);
        else db.prepare('UPDATE memes SET downvotes = downvotes + 1 WHERE id = ?').run(meme_id);
      }
    });

    txn();

    // Read updated state
    const updated = db.prepare('SELECT upvotes, downvotes FROM memes WHERE id = ?').get(meme_id) as { upvotes: number; downvotes: number };
    const myVote = db.prepare('SELECT value FROM meme_votes WHERE user_id = ? AND meme_id = ?').get(user.userId, meme_id) as { value: number } | undefined;
    const finalVote = myVote?.value ?? 0;

    // Notify meme owner on upvote (not self, not toggle-off)
    if (finalVote === 1 && meme.user_id !== user.userId) {
      const score = updated.upvotes - updated.downvotes;
      const msg = score === 69 ? 'upvoted your meme (nice.)' :
                  score === 420 ? 'upvoted your meme (blazed)' :
                  'upvoted your meme';
      db.prepare(
        'INSERT INTO nigdit_notifications (user_id, type, from_username, meme_id, message) VALUES (?, ?, ?, ?, ?)'
      ).run(meme.user_id, 'meme_upvote', user.username, meme_id, msg);
    }

    res.json({
      ok: true,
      my_vote: finalVote,
      score: updated.upvotes - updated.downvotes,
    });
  } catch (err) {
    console.error('[memes] vote error:', err);
    res.status(500).json({ error: 'vote failed' });
  }
});

export default router;
