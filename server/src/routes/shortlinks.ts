import { Router, type Response, type RequestHandler } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { authMiddleware, type AuthRequest } from '../middleware.js';

const router = Router();

const SLUG_RE = /^[a-z0-9_-]{2,32}$/;
const URL_RE = /^https?:\/\/.+/;
const MAX_URL_LEN = 2048;
import { getSetting } from '../constants.js';

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'login', 'register', 'logout', 'auth',
  'paste', 'upload', 'settings', 'health', 'status',
  'mail', 's', 't', 'www', 'static', 'assets', 'app',
]);

function generateSlug(): string {
  return crypto.randomBytes(3).toString('hex').slice(0, 4); // 4 lowercase hex chars
}

// ── List user's links ──
router.get('/', authMiddleware as RequestHandler, ((req: AuthRequest, res: Response) => {
  const user = req.user!;
  const rows = db.prepare(
    'SELECT * FROM shortlinks WHERE user_id = ? ORDER BY created_at DESC'
  ).all(user.userId) as {
    id: number; slug: string; target_url: string; title: string;
    click_count: number; last_clicked_at: string | null;
    expires_at: string | null; created_at: string;
  }[];

  res.json({ links: rows });
}) as RequestHandler);

// ── Create shortlink ──
router.post('/', authMiddleware as RequestHandler, ((req: AuthRequest, res: Response) => {
  const user = req.user!;

  if (user.role === 'guest' || user.role === 'code') {
    res.status(403).json({ error: 'shortlinks require a real account, bitch' });
    return;
  }

  const { url, slug: rawSlug, title } = req.body as { url?: string; slug?: string; title?: string };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  if (!URL_RE.test(url)) {
    res.status(400).json({ error: 'url must start with http:// or https://' });
    return;
  }

  if (url.length > MAX_URL_LEN) {
    res.status(400).json({ error: `url too long (max ${MAX_URL_LEN} chars)` });
    return;
  }

  // Block self-referencing links
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'mynig.ga' || parsed.hostname.endsWith('.mynig.ga')) {
      res.status(400).json({ error: "you can't shorten your own domain you absolute genius" });
      return;
    }
  } catch {
    res.status(400).json({ error: 'invalid url' });
    return;
  }

  // Check link count
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM shortlinks WHERE user_id = ?').get(user.userId) as { cnt: number }).cnt;
  const maxLinks = getSetting('shortlinks_max_per_user', 100);
  if (count >= maxLinks) {
    res.status(400).json({ error: `max ${maxLinks} links reached. delete some first.` });
    return;
  }

  let slug: string;
  if (rawSlug && typeof rawSlug === 'string' && rawSlug.trim()) {
    slug = rawSlug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      res.status(400).json({ error: 'slug must be 2-32 chars, lowercase letters/numbers/dash/underscore' });
      return;
    }
    if (RESERVED_SLUGS.has(slug)) {
      res.status(400).json({ error: `"${slug}" is reserved. pick something else.` });
      return;
    }
    // Check uniqueness
    const existing = db.prepare('SELECT id FROM shortlinks WHERE slug = ?').get(slug);
    if (existing) {
      res.status(409).json({ error: `slug "${slug}" already taken` });
      return;
    }
  } else {
    // Auto-generate unique slug
    let attempts = 0;
    do {
      slug = generateSlug();
      attempts++;
    } while (
      (db.prepare('SELECT id FROM shortlinks WHERE slug = ?').get(slug) || RESERVED_SLUGS.has(slug))
      && attempts < 10
    );
    if (attempts >= 10 && db.prepare('SELECT id FROM shortlinks WHERE slug = ?').get(slug)) {
      res.status(500).json({ error: 'failed to generate slug. try again.' });
      return;
    }
  }

  const linkTitle = (title && typeof title === 'string') ? title.trim().slice(0, 200) : '';

  let result;
  try {
    result = db.prepare(
      'INSERT INTO shortlinks (user_id, slug, target_url, title) VALUES (?, ?, ?, ?)'
    ).run(user.userId, slug, url, linkTitle);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: `slug "${slug}" already taken` });
      return;
    }
    throw err;
  }

  const link = db.prepare('SELECT * FROM shortlinks WHERE id = ?').get(result.lastInsertRowid) as {
    id: number; slug: string; target_url: string; title: string;
    click_count: number; last_clicked_at: string | null;
    expires_at: string | null; created_at: string;
  };

  res.status(201).json({ ok: true, link });
}) as RequestHandler);

// ── Delete shortlink ──
router.delete('/:id', authMiddleware as RequestHandler, ((req: AuthRequest, res: Response) => {
  const user = req.user!;
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }

  const link = db.prepare('SELECT * FROM shortlinks WHERE id = ?').get(id) as { user_id: number } | undefined;
  if (!link) {
    res.status(404).json({ error: 'link not found' });
    return;
  }

  if (link.user_id !== user.userId && user.role !== 'admin') {
    res.status(403).json({ error: 'not your link, not your problem' });
    return;
  }

  db.prepare('DELETE FROM shortlinks WHERE id = ?').run(id);
  res.json({ ok: true });
}) as RequestHandler);

// ── Resolve shortlink (public) ──
router.get('/r/:slug', ((req, res) => {
  const slug = req.params['slug'] as string;

  const link = db.prepare('SELECT * FROM shortlinks WHERE slug = ?').get(slug) as {
    id: number; target_url: string; expires_at: string | null;
  } | undefined;

  if (!link) {
    res.status(404).json({ error: 'link not found. it either never existed or got yeeted.' });
    return;
  }

  // Check expiry
  if (link.expires_at && new Date(link.expires_at + 'Z') < new Date()) {
    res.status(410).json({ error: 'this link expired. RIP.' });
    return;
  }

  // Increment click count
  db.prepare(
    "UPDATE shortlinks SET click_count = click_count + 1, last_clicked_at = datetime('now') WHERE id = ?"
  ).run(link.id);

  res.json({ target_url: link.target_url });
}) as RequestHandler);

export default router;
