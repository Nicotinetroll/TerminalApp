import { Router, Response } from 'express';
import multer from 'multer';
import db from '../db.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware.js';

const router = Router();
router.use(authMiddleware as import('express').RequestHandler);

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: MAX_ATTACHMENTS },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`file type ${file.mimetype} not allowed`));
  },
});

// Award definitions: type → { label, cost (NB in raw bytes), aura_delta }
const AWARD_TYPES: Record<string, { label: string; cost: number; aura: number }> = {
  based:      { label: 'based',              cost: 5 * 1024 * 1024,  aura: 3 },
  shitpost:   { label: 'certified shitpost', cost: 3 * 1024 * 1024,  aura: 2 },
  'l-take':   { label: 'L take',             cost: 2 * 1024 * 1024,  aura: -1 },
  fire:       { label: 'fire',               cost: 10 * 1024 * 1024, aura: 5 },
  skull:      { label: 'skull',              cost: 1 * 1024 * 1024,  aura: 1 },
};

// ── Helpers ──

function getBoards(): { id: number; name: string; description: string }[] {
  return db.prepare('SELECT id, name, description FROM nigdit_boards ORDER BY id ASC').all() as { id: number; name: string; description: string }[];
}
function getBoardNames(): string[] { return getBoards().map(b => b.name); }

function getAura(userId: number): { post_aura: number; comment_aura: number; total: number } {
  const row = db.prepare('SELECT post_aura, comment_aura FROM nigdit_aura WHERE user_id = ?').get(userId) as { post_aura: number; comment_aura: number } | undefined;
  if (!row) return { post_aura: 0, comment_aura: 0, total: 0 };
  return { ...row, total: row.post_aura + row.comment_aura };
}

function ensureAuraRow(userId: number, username?: string): void {
  const name = username || (db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined)?.username || 'unknown';
  db.prepare('INSERT OR IGNORE INTO nigdit_aura (user_id, username, post_aura, comment_aura) VALUES (?, ?, 0, 0)').run(userId, name);
}

function recalcAura(userId: number): void {
  const pa = db.prepare('SELECT COALESCE(SUM(upvotes - downvotes), 0) as a FROM nigdit_posts WHERE user_id = ?').get(userId) as { a: number };
  const ca = db.prepare('SELECT COALESCE(SUM(upvotes - downvotes), 0) as a FROM nigdit_comments WHERE user_id = ?').get(userId) as { a: number };

  // Build award aura CASE dynamically from AWARD_TYPES to keep them in sync
  const awardCaseExpr = Object.entries(AWARD_TYPES).map(([key, v]) => `WHEN '${key}' THEN ${v.aura}`).join(' ');
  const awardCase = `CASE award_type ${awardCaseExpr} ELSE 0 END`;

  const postAwardAura = db.prepare(`
    SELECT COALESCE(SUM(${awardCase}), 0) as a FROM nigdit_awards WHERE post_id IN (SELECT id FROM nigdit_posts WHERE user_id = ?)
  `).get(userId) as { a: number };
  const commentAwardAura = db.prepare(`
    SELECT COALESCE(SUM(${awardCase}), 0) as a FROM nigdit_awards WHERE comment_id IN (SELECT id FROM nigdit_comments WHERE user_id = ?)
  `).get(userId) as { a: number };

  db.prepare('UPDATE nigdit_aura SET post_aura = ?, comment_aura = ? WHERE user_id = ?')
    .run(pa.a + postAwardAura.a, ca.a + commentAwardAura.a, userId);
}

function getUserVotes(userId: number, targetType: string, targetIds: number[]): Map<number, number> {
  if (targetIds.length === 0) return new Map();
  const ph = targetIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT target_id, value FROM nigdit_votes WHERE user_id = ? AND target_type = ? AND target_id IN (${ph})`).all(userId, targetType, ...targetIds) as { target_id: number; value: number }[];
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.target_id, r.value);
  return m;
}

function getPostAttachments(postIds: number[]): Map<number, { id: number; filename: string; mime_type: string; size: number }[]> {
  if (postIds.length === 0) return new Map();
  const ph = postIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, post_id, filename, mime_type, size FROM nigdit_attachments WHERE post_id IN (${ph})`).all(...postIds) as { id: number; post_id: number; filename: string; mime_type: string; size: number }[];
  const m = new Map<number, { id: number; filename: string; mime_type: string; size: number }[]>();
  for (const r of rows) { const e = m.get(r.post_id) ?? []; e.push({ id: r.id, filename: r.filename, mime_type: r.mime_type, size: r.size }); m.set(r.post_id, e); }
  return m;
}

function getPostAwards(postIds: number[]): Map<number, { award_type: string; count: number }[]> {
  if (postIds.length === 0) return new Map();
  const ph = postIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT post_id, award_type, COUNT(*) as cnt FROM nigdit_awards WHERE post_id IN (${ph}) GROUP BY post_id, award_type`).all(...postIds) as { post_id: number; award_type: string; cnt: number }[];
  const m = new Map<number, { award_type: string; count: number }[]>();
  for (const r of rows) { const e = m.get(r.post_id) ?? []; e.push({ award_type: r.award_type, count: r.cnt }); m.set(r.post_id, e); }
  return m;
}

function getCommentAwards(commentIds: number[]): Map<number, { award_type: string; count: number }[]> {
  if (commentIds.length === 0) return new Map();
  const ph = commentIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT comment_id, award_type, COUNT(*) as cnt FROM nigdit_awards WHERE comment_id IN (${ph}) GROUP BY comment_id, award_type`).all(...commentIds) as { comment_id: number; award_type: string; cnt: number }[];
  const m = new Map<number, { award_type: string; count: number }[]>();
  for (const r of rows) { const e = m.get(r.comment_id) ?? []; e.push({ award_type: r.award_type, count: r.cnt }); m.set(r.comment_id, e); }
  return m;
}

function getUserBookmarks(userId: number, postIds: number[]): Set<number> {
  if (postIds.length === 0) return new Set();
  const ph = postIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT post_id FROM nigdit_bookmarks WHERE user_id = ? AND post_id IN (${ph})`).all(userId, ...postIds) as { post_id: number }[];
  return new Set(rows.map(r => r.post_id));
}

function getPollData(postIds: number[], userId: number): Map<number, { options: { id: number; label: string; vote_count: number }[]; my_vote: number | null; total_votes: number }> {
  if (postIds.length === 0) return new Map();
  const ph = postIds.map(() => '?').join(',');
  const opts = db.prepare(`SELECT id, post_id, label, vote_count FROM nigdit_poll_options WHERE post_id IN (${ph}) ORDER BY id ASC`).all(...postIds) as { id: number; post_id: number; label: string; vote_count: number }[];
  const myVotes = db.prepare(`SELECT post_id, option_id FROM nigdit_poll_votes WHERE user_id = ? AND post_id IN (${ph})`).all(userId, ...postIds) as { post_id: number; option_id: number }[];
  const myVoteMap = new Map<number, number>();
  for (const v of myVotes) myVoteMap.set(v.post_id, v.option_id);

  const m = new Map<number, { options: { id: number; label: string; vote_count: number }[]; my_vote: number | null; total_votes: number }>();
  for (const o of opts) {
    const existing = m.get(o.post_id) ?? { options: [], my_vote: myVoteMap.get(o.post_id) ?? null, total_votes: 0 };
    existing.options.push({ id: o.id, label: o.label, vote_count: o.vote_count });
    existing.total_votes += o.vote_count;
    m.set(o.post_id, existing);
  }
  return m;
}

function genAnonName(): string {
  return 'anon-' + Math.random().toString(16).slice(2, 6);
}

function relativeTime(dateStr: string): string {
  const diff = Math.max(0, Date.now() - new Date(dateStr + 'Z').getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function notify(userId: number, type: string, fromUsername: string, postId: number | null, commentId: number | null, message: string): void {
  if (userId <= 0) return;
  db.prepare('INSERT INTO nigdit_notifications (user_id, type, from_username, post_id, comment_id, message) VALUES (?, ?, ?, ?, ?, ?)').run(userId, type, fromUsername, postId, commentId, message);
}

type PostRow = {
  id: number; user_id: number; username: string; title: string; body: string;
  board: string; upvotes: number; downvotes: number; comment_count: number;
  is_pinned: number; is_edited: number; is_anonymous: number; anon_name: string | null;
  expires_at: string | null; post_type: string; created_at: string;
};

function enrichPost(p: PostRow, extras: {
  my_vote: number; author_aura: number;
  attachments: { id: number; filename: string; mime_type: string; size: number }[];
  awards: { award_type: string; count: number }[];
  bookmarked: boolean;
  poll?: { options: { id: number; label: string; vote_count: number }[]; my_vote: number | null; total_votes: number } | null;
}) {
  return {
    id: p.id, user_id: p.user_id,
    username: p.is_anonymous ? (p.anon_name ?? 'anon') : p.username,
    real_username: p.username,
    title: p.title, body: p.body,
    body_preview: p.body.length > 120 ? p.body.slice(0, 120) + '...' : p.body,
    board: p.board, upvotes: p.upvotes, downvotes: p.downvotes,
    score: p.upvotes - p.downvotes,
    comment_count: p.comment_count,
    is_pinned: !!p.is_pinned, is_edited: !!p.is_edited,
    is_anonymous: !!p.is_anonymous,
    post_type: p.post_type,
    expires_at: p.expires_at,
    time_remaining: p.expires_at ? Math.max(0, new Date(p.expires_at + 'Z').getTime() - Date.now()) : null,
    created_at: p.created_at,
    time_ago: relativeTime(p.created_at),
    my_vote: extras.my_vote,
    author_aura: extras.author_aura,
    attachments: extras.attachments,
    awards: extras.awards,
    bookmarked: extras.bookmarked,
    poll: extras.poll ?? null,
  };
}

// ── GET /boards ──
router.get('/boards', (_req: AuthRequest, res: Response) => {
  res.json({ boards: getBoards() });
});

// ── GET /award-types ──
router.get('/award-types', (_req: AuthRequest, res: Response) => {
  const types = Object.entries(AWARD_TYPES).map(([key, v]) => ({ key, label: v.label, cost: v.cost, aura: v.aura }));
  res.json({ award_types: types });
});

// ── GET /posts ──
router.get('/posts', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const board = (req.query.board as string) || 'all';
  const sort = (req.query.sort as string) || 'hot';
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const search = (req.query.search as string) || '';
  const bookmarksOnly = req.query.bookmarks === '1';
  const limit = 20;
  const offset = (page - 1) * limit;

  let orderBy: string;
  switch (sort) {
    case 'top': orderBy = '(upvotes - downvotes) DESC, created_at DESC'; break;
    case 'new': orderBy = 'created_at DESC'; break;
    default: orderBy = `CAST((upvotes - downvotes) AS REAL) / pow((JULIANDAY('now') - JULIANDAY(created_at)) * 24 + 2, 1.5) DESC, created_at DESC`; break;
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  // Expired filter
  conditions.push("(expires_at IS NULL OR datetime(expires_at) > datetime('now'))");

  if (board !== 'all') { conditions.push('board = ?'); params.push(board); }
  if (search) { conditions.push("(title LIKE ? OR body LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
  if (bookmarksOnly) { conditions.push('id IN (SELECT post_id FROM nigdit_bookmarks WHERE user_id = ?)'); params.push(user.userId); }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Pinned posts first, then sorted
  const posts = db.prepare(
    `SELECT * FROM nigdit_posts ${where} ORDER BY is_pinned DESC, ${orderBy} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as PostRow[];

  const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM nigdit_posts ${where}`).get(...params) as { cnt: number };

  const postIds = posts.map(p => p.id);
  const userVotes = getUserVotes(user.userId, 'post', postIds);
  const attachments = getPostAttachments(postIds);
  const awards = getPostAwards(postIds);
  const bookmarks = getUserBookmarks(user.userId, postIds);
  const polls = getPollData(postIds, user.userId);

  const authorIds = [...new Set(posts.map(p => p.user_id))];
  const auraMap = new Map<number, number>();
  for (const aid of authorIds) auraMap.set(aid, getAura(aid).total);

  const result = posts.map(p => enrichPost(p, {
    my_vote: userVotes.get(p.id) ?? 0,
    author_aura: auraMap.get(p.user_id) ?? 0,
    attachments: attachments.get(p.id) ?? [],
    awards: awards.get(p.id) ?? [],
    bookmarked: bookmarks.has(p.id),
    poll: polls.get(p.id) ?? null,
  }));

  res.json({ posts: result, page, total: totalRow.cnt, pages: Math.ceil(totalRow.cnt / limit) });
});

// ── GET /posts/:id ──
router.get('/posts/:id', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const postId = parseInt(req.params.id as string);

  const post = db.prepare('SELECT * FROM nigdit_posts WHERE id = ?').get(postId) as PostRow | undefined;
  if (!post) { res.status(404).json({ error: 'post not found. it probably got yeeted.' }); return; }

  const postVote = getUserVotes(user.userId, 'post', [post.id]);
  const attachments = getPostAttachments([post.id]);
  const postAwards = getPostAwards([post.id]);
  const bookmarks = getUserBookmarks(user.userId, [post.id]);
  const polls = getPollData([post.id], user.userId);
  const authorAura = getAura(post.user_id);

  const comments = db.prepare(
    'SELECT * FROM nigdit_comments WHERE post_id = ? ORDER BY created_at ASC'
  ).all(postId) as {
    id: number; post_id: number; parent_id: number | null; user_id: number; username: string;
    body: string; upvotes: number; downvotes: number; depth: number;
    is_edited: number; is_anonymous: number; anon_name: string | null; created_at: string;
  }[];

  const commentIds = comments.map(c => c.id);
  const commentVotes = getUserVotes(user.userId, 'comment', commentIds);
  const cAwards = getCommentAwards(commentIds);

  const commentAuthorIds = [...new Set(comments.map(c => c.user_id))];
  const cAuraMap = new Map<number, number>();
  for (const aid of commentAuthorIds) cAuraMap.set(aid, getAura(aid).total);

  const enrichedComments = comments.map(c => ({
    id: c.id, post_id: c.post_id, parent_id: c.parent_id, user_id: c.user_id,
    username: c.is_anonymous ? (c.anon_name ?? 'anon') : c.username,
    body: c.body, upvotes: c.upvotes, downvotes: c.downvotes,
    score: c.upvotes - c.downvotes, depth: c.depth,
    is_edited: !!c.is_edited, is_anonymous: !!c.is_anonymous,
    my_vote: commentVotes.get(c.id) ?? 0,
    author_aura: cAuraMap.get(c.user_id) ?? 0,
    is_op: c.user_id === post.user_id,
    time_ago: relativeTime(c.created_at), created_at: c.created_at,
    awards: cAwards.get(c.id) ?? [],
  }));

  res.json({
    post: enrichPost(post, {
      my_vote: postVote.get(post.id) ?? 0,
      author_aura: authorAura.total,
      attachments: attachments.get(post.id) ?? [],
      awards: postAwards.get(post.id) ?? [],
      bookmarked: bookmarks.has(post.id),
      poll: polls.get(post.id) ?? null,
    }),
    comments: enrichedComments,
  });
});

// ── POST /posts ──
router.post('/posts', upload.array('attachments', MAX_ATTACHMENTS), (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const title = (req.body.title as string | undefined);
  const body = (req.body.body as string | undefined);
  const board = (req.body.board as string | undefined);
  const postType = (req.body.post_type as string | undefined) || 'text';
  const isAnonymous = req.body.is_anonymous === 'true' || req.body.is_anonymous === '1';
  const pollOptionsRaw = req.body.poll_options as string | undefined;
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  if (!title || title.trim().length === 0) { res.status(400).json({ error: 'title is required. even shitposts need titles.' }); return; }
  if (title.trim().length > 200) { res.status(400).json({ error: 'title too long.' }); return; }
  if (body && body.length > 10000) { res.status(400).json({ error: 'body too long.' }); return; }

  const validBoards = getBoardNames();
  const selectedBoard = board && validBoards.includes(board) ? board : (validBoards[0] ?? 'general');
  const validTypes = ['text', 'poll', 'hottake'];
  const type = validTypes.includes(postType) ? postType : 'text';

  let expiresAt: string | null = null;
  if (type === 'hottake') {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expiresAt = d.toISOString().replace('T', ' ').slice(0, 19);
  }

  const anonName = isAnonymous ? genAnonName() : null;
  ensureAuraRow(user.userId, user.username);

  // Parse poll options
  let pollOptions: string[] = [];
  if (type === 'poll' && pollOptionsRaw) {
    try { pollOptions = JSON.parse(pollOptionsRaw) as string[]; } catch { /* ignore */ }
    pollOptions = pollOptions.filter(o => o.trim().length > 0).slice(0, 10);
    if (pollOptions.length < 2) { res.status(400).json({ error: 'polls need at least 2 options' }); return; }
  }

  const result = db.transaction(() => {
    const ins = db.prepare(
      'INSERT INTO nigdit_posts (user_id, username, title, body, board, post_type, is_anonymous, anon_name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user.userId, user.username, title.trim(), (body ?? '').trim(), selectedBoard, type, isAnonymous ? 1 : 0, anonName, expiresAt);
    const postId = ins.lastInsertRowid as number;

    // Attachments
    const attachRows: { id: number; filename: string; mime_type: string; size: number }[] = [];
    if (files.length > 0) {
      const stmt = db.prepare('INSERT INTO nigdit_attachments (post_id, filename, mime_type, size, data) VALUES (?, ?, ?, ?, ?)');
      for (const f of files) { const r = stmt.run(postId, f.originalname, f.mimetype, f.size, f.buffer); attachRows.push({ id: r.lastInsertRowid as number, filename: f.originalname, mime_type: f.mimetype, size: f.size }); }
    }

    // Poll options
    let pollData: { options: { id: number; label: string; vote_count: number }[]; my_vote: null; total_votes: number } | null = null;
    if (type === 'poll' && pollOptions.length >= 2) {
      const optStmt = db.prepare('INSERT INTO nigdit_poll_options (post_id, label) VALUES (?, ?)');
      const opts: { id: number; label: string; vote_count: number }[] = [];
      for (const label of pollOptions) {
        const r = optStmt.run(postId, label.trim());
        opts.push({ id: r.lastInsertRowid as number, label: label.trim(), vote_count: 0 });
      }
      pollData = { options: opts, my_vote: null, total_votes: 0 };
    }

    const post = db.prepare('SELECT * FROM nigdit_posts WHERE id = ?').get(postId) as PostRow;
    return { post, attachments: attachRows, poll: pollData };
  })();

  res.json({ ok: true, post: enrichPost(result.post, {
    my_vote: 0, author_aura: 0, attachments: result.attachments,
    awards: [], bookmarked: false, poll: result.poll,
  }) });
});

// ── PUT /posts/:id (edit) ──
router.put('/posts/:id', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const postId = parseInt(req.params.id as string);
  const { title, body } = req.body as { title?: string; body?: string };

  const post = db.prepare('SELECT user_id FROM nigdit_posts WHERE id = ?').get(postId) as { user_id: number } | undefined;
  if (!post) { res.status(404).json({ error: 'post not found' }); return; }
  if (post.user_id !== user.userId && user.role !== 'admin') { res.status(403).json({ error: 'not your post' }); return; }

  const updates: string[] = ['is_edited = 1'];
  const params: unknown[] = [];
  if (title !== undefined) { updates.push('title = ?'); params.push(title.trim()); }
  if (body !== undefined) { updates.push('body = ?'); params.push(body.trim()); }
  params.push(postId);

  db.prepare(`UPDATE nigdit_posts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// ── DELETE /posts/:id ──
router.delete('/posts/:id', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const postId = parseInt(req.params.id as string);
  const post = db.prepare('SELECT user_id FROM nigdit_posts WHERE id = ?').get(postId) as { user_id: number } | undefined;
  if (!post) { res.status(404).json({ error: 'post not found' }); return; }
  if (post.user_id !== user.userId && user.role !== 'admin') { res.status(403).json({ error: 'not your post' }); return; }

  db.transaction(() => {
    db.prepare("DELETE FROM nigdit_votes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM nigdit_comments WHERE post_id = ?)").run(postId);
    db.prepare("DELETE FROM nigdit_votes WHERE target_type = 'post' AND target_id = ?").run(postId);
    db.prepare('DELETE FROM nigdit_attachments WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM nigdit_awards WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM nigdit_awards WHERE comment_id IN (SELECT id FROM nigdit_comments WHERE post_id = ?)').run(postId);
    db.prepare('DELETE FROM nigdit_poll_votes WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM nigdit_poll_options WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM nigdit_bookmarks WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM nigdit_comments WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM nigdit_posts WHERE id = ?').run(postId);
    recalcAura(post.user_id);
  })();
  res.json({ ok: true });
});

// ── POST /comments ──
router.post('/comments', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const { post_id, parent_id, body, is_anonymous } = req.body as { post_id?: number; parent_id?: number; body?: string; is_anonymous?: boolean };

  if (!post_id) { res.status(400).json({ error: 'post_id required' }); return; }
  if (!body || body.trim().length === 0) { res.status(400).json({ error: 'say something, coward.' }); return; }
  if (body.length > 5000) { res.status(400).json({ error: 'comment too long.' }); return; }

  const post = db.prepare('SELECT id, user_id, username FROM nigdit_posts WHERE id = ?').get(post_id) as { id: number; user_id: number; username: string } | undefined;
  if (!post) { res.status(404).json({ error: 'post not found' }); return; }

  let depth = 0;
  let parentUserId: number | null = null;
  if (parent_id) {
    const parent = db.prepare('SELECT id, depth, user_id FROM nigdit_comments WHERE id = ? AND post_id = ?').get(parent_id, post_id) as { id: number; depth: number; user_id: number } | undefined;
    if (!parent) { res.status(404).json({ error: 'parent comment not found' }); return; }
    depth = parent.depth + 1;
    parentUserId = parent.user_id;
  }

  const anonName = is_anonymous ? genAnonName() : null;
  ensureAuraRow(user.userId, user.username);

  const result = db.transaction(() => {
    const ins = db.prepare(
      'INSERT INTO nigdit_comments (post_id, parent_id, user_id, username, body, depth, is_anonymous, anon_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(post_id, parent_id ?? null, user.userId, user.username, body.trim(), depth, is_anonymous ? 1 : 0, anonName);
    db.prepare('UPDATE nigdit_posts SET comment_count = comment_count + 1 WHERE id = ?').run(post_id);

    // Notifications
    const displayName = is_anonymous ? (anonName ?? 'anon') : user.username;
    if (parent_id && parentUserId && parentUserId !== user.userId) {
      notify(parentUserId, 'reply_comment', displayName, post_id, ins.lastInsertRowid as number, `replied to your comment`);
    } else if (!parent_id && post.user_id !== user.userId) {
      notify(post.user_id, 'reply_post', displayName, post_id, ins.lastInsertRowid as number, `commented on your post "${post.username}"`);
    }

    return ins;
  })();

  const inserted = db.prepare('SELECT id, post_id, parent_id, user_id, username, body, upvotes, downvotes, depth, is_anonymous, anon_name, created_at FROM nigdit_comments WHERE id = ?').get(result.lastInsertRowid) as {
    id: number; post_id: number; parent_id: number | null; user_id: number; username: string;
    body: string; upvotes: number; downvotes: number; depth: number;
    is_anonymous: number; anon_name: string | null; created_at: string;
  };

  res.json({
    ok: true,
    comment: {
      ...inserted,
      username: inserted.is_anonymous ? (inserted.anon_name ?? 'anon') : inserted.username,
      score: 0, my_vote: 0, author_aura: 0,
      is_op: user.userId === post.user_id,
      is_edited: false, is_anonymous: !!inserted.is_anonymous,
      time_ago: 'just now', awards: [],
    },
  });
});

// ── PUT /comments/:id (edit) ──
router.put('/comments/:id', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const commentId = parseInt(req.params.id as string);
  const { body } = req.body as { body?: string };

  const comment = db.prepare('SELECT user_id FROM nigdit_comments WHERE id = ?').get(commentId) as { user_id: number } | undefined;
  if (!comment) { res.status(404).json({ error: 'comment not found' }); return; }
  if (comment.user_id !== user.userId && user.role !== 'admin') { res.status(403).json({ error: 'not your comment' }); return; }
  if (!body || body.trim().length === 0) { res.status(400).json({ error: 'body required' }); return; }

  db.prepare('UPDATE nigdit_comments SET body = ?, is_edited = 1 WHERE id = ?').run(body.trim(), commentId);
  res.json({ ok: true });
});

// ── DELETE /comments/:id ──
router.delete('/comments/:id', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const commentId = parseInt(req.params.id as string);
  const comment = db.prepare('SELECT id, post_id, user_id FROM nigdit_comments WHERE id = ?').get(commentId) as { id: number; post_id: number; user_id: number } | undefined;
  if (!comment) { res.status(404).json({ error: 'comment not found' }); return; }
  if (comment.user_id !== user.userId && user.role !== 'admin') { res.status(403).json({ error: 'not your comment' }); return; }

  db.transaction(() => {
    const childCount = db.prepare('SELECT COUNT(*) as cnt FROM nigdit_comments WHERE post_id = ? AND parent_id = ?').get(comment.post_id, commentId) as { cnt: number };
    db.prepare("DELETE FROM nigdit_votes WHERE target_type = 'comment' AND target_id = ?").run(commentId);
    db.prepare("DELETE FROM nigdit_votes WHERE target_type = 'comment' AND target_id IN (SELECT id FROM nigdit_comments WHERE post_id = ? AND parent_id = ?)").run(comment.post_id, commentId);
    db.prepare('DELETE FROM nigdit_awards WHERE comment_id = ?').run(commentId);
    db.prepare('DELETE FROM nigdit_comments WHERE post_id = ? AND parent_id = ?').run(comment.post_id, commentId);
    db.prepare('DELETE FROM nigdit_comments WHERE id = ?').run(commentId);
    db.prepare('UPDATE nigdit_posts SET comment_count = comment_count - ? WHERE id = ?').run(1 + childCount.cnt, comment.post_id);
    recalcAura(comment.user_id);
  })();
  res.json({ ok: true });
});

// ── POST /vote ──
router.post('/vote', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const { target_id, target_type, value } = req.body as { target_id?: number; target_type?: string; value?: number };
  if (!target_id || !target_type || value === undefined) { res.status(400).json({ error: 'missing fields' }); return; }
  if (target_type !== 'post' && target_type !== 'comment') { res.status(400).json({ error: 'bad target_type' }); return; }
  if (value !== 1 && value !== -1) { res.status(400).json({ error: 'value must be 1 or -1' }); return; }

  const table = target_type === 'post' ? 'nigdit_posts' : 'nigdit_comments';
  const target = db.prepare(`SELECT id, user_id FROM ${table} WHERE id = ?`).get(target_id) as { id: number; user_id: number } | undefined;
  if (!target) { res.status(404).json({ error: 'not found' }); return; }
  if (target.user_id === user.userId) { res.status(400).json({ error: 'can\'t vote on your own shit' }); return; }

  ensureAuraRow(target.user_id);

  const result = db.transaction(() => {
    const existing = db.prepare('SELECT value FROM nigdit_votes WHERE user_id = ? AND target_id = ? AND target_type = ?').get(user.userId, target_id, target_type) as { value: number } | undefined;
    let newVote: number;
    if (existing) {
      if (existing.value === value) {
        db.prepare('DELETE FROM nigdit_votes WHERE user_id = ? AND target_id = ? AND target_type = ?').run(user.userId, target_id, target_type);
        db.prepare(`UPDATE ${table} SET ${value === 1 ? 'upvotes = upvotes - 1' : 'downvotes = downvotes - 1'} WHERE id = ?`).run(target_id);
        newVote = 0;
      } else {
        db.prepare("UPDATE nigdit_votes SET value = ?, created_at = datetime('now') WHERE user_id = ? AND target_id = ? AND target_type = ?").run(value, user.userId, target_id, target_type);
        db.prepare(`UPDATE ${table} SET ${value === 1 ? 'upvotes = upvotes + 1, downvotes = downvotes - 1' : 'upvotes = upvotes - 1, downvotes = downvotes + 1'} WHERE id = ?`).run(target_id);
        newVote = value;
      }
    } else {
      db.prepare('INSERT INTO nigdit_votes (user_id, target_id, target_type, value) VALUES (?, ?, ?, ?)').run(user.userId, target_id, target_type, value);
      db.prepare(`UPDATE ${table} SET ${value === 1 ? 'upvotes = upvotes + 1' : 'downvotes = downvotes + 1'} WHERE id = ?`).run(target_id);
      newVote = value;
    }
    recalcAura(target.user_id);
    const updated = db.prepare(`SELECT upvotes, downvotes FROM ${table} WHERE id = ?`).get(target_id) as { upvotes: number; downvotes: number };
    return { newVote, score: updated.upvotes - updated.downvotes };
  })();
  res.json({ ok: true, my_vote: result.newVote, score: result.score });
});

// ── POST /awards ──
router.post('/awards', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const { post_id, comment_id, award_type } = req.body as { post_id?: number; comment_id?: number; award_type?: string };

  if (!award_type || !AWARD_TYPES[award_type]) { res.status(400).json({ error: 'invalid award type' }); return; }
  if (!post_id && !comment_id) { res.status(400).json({ error: 'post_id or comment_id required' }); return; }

  const award = AWARD_TYPES[award_type]!;

  // Find target author
  let authorId: number;
  if (post_id) {
    const p = db.prepare('SELECT user_id FROM nigdit_posts WHERE id = ?').get(post_id) as { user_id: number } | undefined;
    if (!p) { res.status(404).json({ error: 'post not found' }); return; }
    authorId = p.user_id;
  } else {
    const c = db.prepare('SELECT user_id FROM nigdit_comments WHERE id = ?').get(comment_id!) as { user_id: number } | undefined;
    if (!c) { res.status(404).json({ error: 'comment not found' }); return; }
    authorId = c.user_id;
  }

  if (authorId === user.userId) { res.status(400).json({ error: 'can\'t award yourself' }); return; }

  ensureAuraRow(authorId);

  // Balance check + deduction inside transaction to prevent race condition
  const txResult = db.transaction(() => {
    const bal = db.prepare('SELECT bytebucks FROM slots_balance WHERE user_id = ?').get(user.userId) as { bytebucks: number } | undefined;
    const currentNB = bal?.bytebucks ?? 0;
    if (currentNB < award.cost) return { error: 'not enough NiggaBytes' as const };

    db.prepare('UPDATE slots_balance SET bytebucks = bytebucks - ? WHERE user_id = ?').run(award.cost, user.userId);
    db.prepare('INSERT INTO nigdit_awards (post_id, comment_id, award_type, from_user_id, from_username, nb_cost) VALUES (?, ?, ?, ?, ?, ?)').run(post_id ?? null, comment_id ?? null, award_type, user.userId, user.username, award.cost);
    recalcAura(authorId);
    notify(authorId, 'award', user.username, post_id ?? null, comment_id ?? null, `gave you a ${award.label} award`);
    return { nb_remaining: currentNB - award.cost };
  })();

  if ('error' in txResult) { res.status(400).json({ error: txResult.error }); return; }
  res.json({ ok: true, nb_remaining: txResult.nb_remaining });
});

// ── POST /polls/:postId/vote ──
router.post('/polls/:postId/vote', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const postId = parseInt(req.params.postId as string);
  const { option_id } = req.body as { option_id?: number };
  if (!option_id) { res.status(400).json({ error: 'option_id required' }); return; }

  const post = db.prepare("SELECT id FROM nigdit_posts WHERE id = ? AND post_type = 'poll'").get(postId);
  if (!post) { res.status(404).json({ error: 'poll not found' }); return; }

  const opt = db.prepare('SELECT id FROM nigdit_poll_options WHERE id = ? AND post_id = ?').get(option_id, postId);
  if (!opt) { res.status(404).json({ error: 'option not found' }); return; }

  const existing = db.prepare('SELECT option_id FROM nigdit_poll_votes WHERE user_id = ? AND post_id = ?').get(user.userId, postId) as { option_id: number } | undefined;
  if (existing) { res.status(400).json({ error: 'already voted' }); return; }

  db.transaction(() => {
    db.prepare('INSERT INTO nigdit_poll_votes (user_id, post_id, option_id) VALUES (?, ?, ?)').run(user.userId, postId, option_id);
    db.prepare('UPDATE nigdit_poll_options SET vote_count = vote_count + 1 WHERE id = ?').run(option_id);
  })();

  const poll = getPollData([postId], user.userId).get(postId);
  res.json({ ok: true, poll });
});

// ── POST /bookmarks/:postId ──
router.post('/bookmarks/:postId', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const postId = parseInt(req.params.postId as string);

  const existing = db.prepare('SELECT 1 FROM nigdit_bookmarks WHERE user_id = ? AND post_id = ?').get(user.userId, postId);
  if (existing) {
    db.prepare('DELETE FROM nigdit_bookmarks WHERE user_id = ? AND post_id = ?').run(user.userId, postId);
    res.json({ ok: true, bookmarked: false });
  } else {
    db.prepare('INSERT INTO nigdit_bookmarks (user_id, post_id) VALUES (?, ?)').run(user.userId, postId);
    res.json({ ok: true, bookmarked: true });
  }
});

// ── GET /notifications ──
router.get('/notifications', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
  const notifs = db.prepare('SELECT * FROM nigdit_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(user.userId, limit) as {
    id: number; type: string; from_username: string; post_id: number | null; comment_id: number | null; meme_id: number | null; message: string; is_read: number; created_at: string;
  }[];
  res.json({ notifications: notifs.map(n => ({ ...n, is_read: !!n.is_read, time_ago: relativeTime(n.created_at) })) });
});

// ── GET /notifications/count ──
router.get('/notifications/count', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const row = db.prepare('SELECT COUNT(*) as cnt FROM nigdit_notifications WHERE user_id = ? AND is_read = 0').get(user.userId) as { cnt: number };
  res.json({ count: row.cnt });
});

// ── PUT /notifications/read ──
router.put('/notifications/read', (req: AuthRequest, res: Response) => {
  const user = req.user!;
  db.prepare('UPDATE nigdit_notifications SET is_read = 1 WHERE user_id = ?').run(user.userId);
  res.json({ ok: true });
});

// ── POST /posts/:id/pin (admin) ──
router.post('/posts/:id/pin', adminMiddleware as import('express').RequestHandler, (req: AuthRequest, res: Response) => {
  const postId = parseInt(req.params.id as string);
  const post = db.prepare('SELECT is_pinned FROM nigdit_posts WHERE id = ?').get(postId) as { is_pinned: number } | undefined;
  if (!post) { res.status(404).json({ error: 'post not found' }); return; }
  db.prepare('UPDATE nigdit_posts SET is_pinned = ? WHERE id = ?').run(post.is_pinned ? 0 : 1, postId);
  res.json({ ok: true, is_pinned: !post.is_pinned });
});

// ── GET /users/:username ──
router.get('/users/:username', (req: AuthRequest, res: Response) => {
  const username = req.params.username as string;
  const userRow = db.prepare('SELECT id, username, created_at FROM users WHERE username = ?').get(username) as { id: number; username: string; created_at: string } | undefined;
  if (!userRow) { res.status(404).json({ error: 'user not found' }); return; }

  const aura = getAura(userRow.id);

  const posts = db.prepare('SELECT * FROM nigdit_posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(userRow.id) as PostRow[];
  const commentCount = (db.prepare('SELECT COUNT(*) as cnt FROM nigdit_comments WHERE user_id = ?').get(userRow.id) as { cnt: number }).cnt;
  const awardsReceived = (db.prepare(`
    SELECT COUNT(*) as cnt FROM nigdit_awards WHERE
      post_id IN (SELECT id FROM nigdit_posts WHERE user_id = ?) OR
      comment_id IN (SELECT id FROM nigdit_comments WHERE user_id = ?)
  `).get(userRow.id, userRow.id) as { cnt: number }).cnt;

  // Streak: consecutive days with posts
  const dates = db.prepare("SELECT DISTINCT date(created_at) as d FROM nigdit_posts WHERE user_id = ? ORDER BY d DESC").all(userRow.id) as { d: string }[];
  let streak = 0;
  for (let i = 0; i < dates.length; i++) {
    const expected = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    if (dates[i]?.d === expected) streak++;
    else break;
  }
  // If no post today but posted yesterday, still count from yesterday
  if (streak === 0 && dates[0]) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dates[0].d === yesterday) {
      for (let i = 0; i < dates.length; i++) {
        const expected = new Date(Date.now() - (i + 1) * 86400000).toISOString().slice(0, 10);
        if (dates[i]?.d === expected) streak++;
        else break;
      }
    }
  }

  res.json({
    user: {
      username: userRow.username,
      created_at: userRow.created_at,
      aura,
      post_count: posts.length,
      comment_count: commentCount,
      awards_received: awardsReceived,
      streak,
    },
    posts: posts.map(p => ({
      id: p.id, title: p.title, board: p.board, score: p.upvotes - p.downvotes,
      comment_count: p.comment_count, time_ago: relativeTime(p.created_at),
      post_type: p.post_type, is_pinned: !!p.is_pinned,
    })),
  });
});

// ── GET /attachments/:id ──
router.get('/attachments/:id', (req: AuthRequest, res: Response) => {
  const attachId = parseInt(req.params.id as string);
  const row = db.prepare('SELECT filename, mime_type, size, data FROM nigdit_attachments WHERE id = ?').get(attachId) as { filename: string; mime_type: string; size: number; data: Buffer } | undefined;
  if (!row) { res.status(404).json({ error: 'attachment not found' }); return; }
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Content-Length', row.size);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(row.data);
});

// ── GET /aura ──
router.get('/aura', (req: AuthRequest, res: Response) => { res.json({ username: req.user!.username, ...getAura(req.user!.userId) }); });
router.get('/aura/:username', (req: AuthRequest, res: Response) => {
  const username = req.params.username as string;
  const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
  if (!u) { res.status(404).json({ error: 'user not found' }); return; }
  res.json({ username, ...getAura(u.id) });
});

// ── Admin: Board CRUD ──
router.post('/admin/boards', adminMiddleware as import('express').RequestHandler, (req: AuthRequest, res: Response) => {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name || !name.trim()) { res.status(400).json({ error: 'name required' }); return; }
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!clean || clean.length > 30) { res.status(400).json({ error: 'bad name' }); return; }
  try { db.prepare('INSERT INTO nigdit_boards (name, description) VALUES (?, ?)').run(clean, (description ?? '').trim()); res.json({ ok: true, boards: getBoards() }); }
  catch { res.status(409).json({ error: 'board exists' }); }
});

router.put('/admin/boards/:id', adminMiddleware as import('express').RequestHandler, (req: AuthRequest, res: Response) => {
  const boardId = parseInt(req.params.id as string);
  const { name, description } = req.body as { name?: string; description?: string };
  const board = db.prepare('SELECT id, name FROM nigdit_boards WHERE id = ?').get(boardId) as { id: number; name: string } | undefined;
  if (!board) { res.status(404).json({ error: 'not found' }); return; }
  if (name !== undefined) {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
    if (!clean || clean.length > 30) { res.status(400).json({ error: 'bad name' }); return; }
    try { db.prepare('UPDATE nigdit_boards SET name = ? WHERE id = ?').run(clean, boardId); db.prepare('UPDATE nigdit_posts SET board = ? WHERE board = ?').run(clean, board.name); }
    catch { res.status(409).json({ error: 'name taken' }); return; }
  }
  if (description !== undefined) db.prepare('UPDATE nigdit_boards SET description = ? WHERE id = ?').run(description.trim(), boardId);
  res.json({ ok: true, boards: getBoards() });
});

router.delete('/admin/boards/:id', adminMiddleware as import('express').RequestHandler, (req: AuthRequest, res: Response) => {
  const boardId = parseInt(req.params.id as string);
  const board = db.prepare('SELECT name FROM nigdit_boards WHERE id = ?').get(boardId) as { name: string } | undefined;
  if (!board) { res.status(404).json({ error: 'not found' }); return; }
  db.prepare("UPDATE nigdit_posts SET board = 'general' WHERE board = ?").run(board.name);
  db.prepare('DELETE FROM nigdit_boards WHERE id = ?').run(boardId);
  res.json({ ok: true, boards: getBoards() });
});

router.get('/admin/stats', adminMiddleware as import('express').RequestHandler, (_req: AuthRequest, res: Response) => {
  const totalPosts = (db.prepare('SELECT COUNT(*) as cnt FROM nigdit_posts').get() as { cnt: number }).cnt;
  const totalComments = (db.prepare('SELECT COUNT(*) as cnt FROM nigdit_comments').get() as { cnt: number }).cnt;
  const totalVotes = (db.prepare('SELECT COUNT(*) as cnt FROM nigdit_votes').get() as { cnt: number }).cnt;
  const topPosters = db.prepare('SELECT username, COUNT(*) as post_count FROM nigdit_posts GROUP BY user_id ORDER BY post_count DESC LIMIT 5').all() as { username: string; post_count: number }[];
  const topAura = db.prepare('SELECT username, (post_aura + comment_aura) as total_aura FROM nigdit_aura ORDER BY total_aura DESC LIMIT 5').all() as { username: string; total_aura: number }[];
  res.json({ totalPosts, totalComments, totalVotes, topPosters, topAura, boards: getBoards() });
});

export default router;
