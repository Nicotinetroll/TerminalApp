import { Router, type Response, type RequestHandler } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { authMiddleware, type AuthRequest, type AuthPayload } from '../middleware.js';
import { callGroq, checkUserRate, checkIpRate } from '../lib/groq.js';
import { getSetting } from '../constants.js';

const router = Router();

const PAGE_SIZE = 20;

// ── Helpers ──

function generateId(): string {
  return crypto.randomBytes(6).toString('base64url');
}

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

// Anonymous paste rate limiter (in-memory)
const anonLimits = new Map<string, { count: number; resetAt: number }>();

function checkAnonLimit(ip: string): boolean {
  const now = Date.now();
  const maxPastes = getSetting('paste_anon_max_per_day', 10);
  const entry = anonLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    anonLimits.set(ip, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
    return true;
  }
  if (entry.count >= maxPastes) return false;
  entry.count++;
  return true;
}

// Cleanup old rate limit entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of anonLimits) {
    if (now > entry.resetAt) anonLimits.delete(ip);
  }
}, 60 * 60 * 1000);

// Cleanup expired pastes on startup
db.prepare("DELETE FROM pastes WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')").run();

// Optional auth — sets req.user if token present, but doesn't reject
const optionalAuth: RequestHandler = (req: AuthRequest, _res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const secret = process.env.JWT_SECRET;
    if (secret) {
      try {
        const decoded = jwt.verify(token, secret) as AuthPayload;
        req.user = decoded;
      } catch { /* ignore invalid tokens */ }
    }
  }
  next();
};

// ── Shared paste type ──

interface PasteRow {
  id: string;
  user_id: number | null;
  username: string;
  title: string;
  content: string;
  language: string;
  expires_at: string | null;
  created_at: string;
  parent_id: string | null;
  ip: string | null;
}

interface ParentRow {
  id: string;
  title: string;
  content: string;
  language: string;
}

// ── POST /public — create anonymous paste (NO auth, 6h expiry, IP-limited) ──
router.post('/public', (req: AuthRequest, res: Response) => {
  try {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    const maxPastes = getSetting('paste_anon_max_per_day', 10);
    if (!checkAnonLimit(ip)) {
      res.status(429).json({ error: `${maxPastes} pastes per day for anonymous. that's generous enough.` });
      return;
    }

    const { title, content, language, parent_id } = req.body as {
      title?: string; content?: string; language?: string; parent_id?: string;
    };

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: 'empty paste. write something first, genius.' });
      return;
    }

    const maxSizeKb = getSetting('paste_max_size_kb', 500);
    if (Buffer.byteLength(content, 'utf8') > maxSizeKb * 1024) {
      res.status(400).json({ error: `paste too large. max ${maxSizeKb}KB. this ain't github.` });
      return;
    }

    const id = generateId();
    const pasteTitle = (title?.trim() || 'untitled').slice(0, 100);
    const pasteLang = (language?.trim() || 'plaintext').slice(0, 30);
    const anonExpiryHours = getSetting('paste_anon_expiry_hours', 6);
    const expiresAt = new Date(Date.now() + anonExpiryHours * 3600000).toISOString().replace('T', ' ').split('.')[0]!;

    // Validate parent exists if forking
    let parentId: string | null = null;
    if (parent_id) {
      const parent = db.prepare('SELECT id FROM pastes WHERE id = ?').get(parent_id) as { id: string } | undefined;
      if (parent) parentId = parent.id;
    }

    db.prepare(`
      INSERT INTO pastes (id, user_id, username, title, content, language, expires_at, parent_id, ip)
      VALUES (?, NULL, 'anon', ?, ?, ?, ?, ?, ?)
    `).run(id, pasteTitle, content, pasteLang, expiresAt, parentId, ip);

    res.json({
      ok: true,
      paste: {
        id,
        title: pasteTitle,
        language: pasteLang,
        expires_at: expiresAt,
        url: `https://mynig.ga/paste/${id}`,
      },
    });
  } catch (err) {
    console.error('[pastes] public create error:', err);
    res.status(500).json({ error: 'failed to create paste' });
  }
});

// ── GET /:id — public paste view (NO auth) ──
router.get('/:id', (req: AuthRequest, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const paste = db.prepare(
      'SELECT id, user_id, username, title, content, language, expires_at, created_at, parent_id FROM pastes WHERE id = ?'
    ).get(id) as PasteRow | undefined;

    if (!paste) {
      res.status(404).json({ error: 'paste not found — it expired or never existed' });
      return;
    }

    if (paste.expires_at && new Date(paste.expires_at + 'Z').getTime() < Date.now()) {
      db.prepare('DELETE FROM pastes WHERE id = ?').run(id);
      res.status(404).json({ error: 'paste expired. gone like your motivation.' });
      return;
    }

    // If this paste has a parent, include parent content for diff
    let parent: ParentRow | null = null;
    if (paste.parent_id) {
      const p = db.prepare('SELECT id, title, content, language FROM pastes WHERE id = ?').get(paste.parent_id) as ParentRow | undefined;
      parent = p ?? null;
    }

    res.json({
      paste: {
        id: paste.id,
        username: paste.username,
        title: paste.title,
        content: paste.content,
        language: paste.language,
        expires_at: paste.expires_at,
        created_at: paste.created_at,
        parent_id: paste.parent_id,
        parent,
        time_ago: timeAgo(paste.created_at),
      },
    });
  } catch (err) {
    console.error('[pastes] get error:', err);
    res.status(500).json({ error: 'failed to load paste' });
  }
});

// ── GET / — list user's pastes (auth required) ──
router.get('/', authMiddleware as RequestHandler, (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const rows = db.prepare(`
      SELECT id, title, language, expires_at, created_at, parent_id
      FROM pastes
      WHERE user_id = ? AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(user.userId, PAGE_SIZE + 1, offset) as {
      id: string; title: string; language: string; expires_at: string | null; created_at: string; parent_id: string | null;
    }[];

    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE);

    res.json({
      pastes: items.map(p => ({ ...p, time_ago: timeAgo(p.created_at) })),
      has_more: hasMore,
    });
  } catch (err) {
    console.error('[pastes] list error:', err);
    res.status(500).json({ error: 'failed to list pastes' });
  }
});

// ── POST / — create paste (auth required) ──
router.post('/', authMiddleware as RequestHandler, (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role === 'guest') {
      res.status(403).json({ error: "guests can't create pastes. get an account." });
      return;
    }

    const { title, content, language, expires_in, parent_id } = req.body as {
      title?: string; content: string; language?: string; expires_in?: string; parent_id?: string;
    };

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: 'empty paste. write something first, genius.' });
      return;
    }

    const maxSizeKb = getSetting('paste_max_size_kb', 500);
    if (Buffer.byteLength(content, 'utf8') > maxSizeKb * 1024) {
      res.status(400).json({ error: `paste too large. max ${maxSizeKb}KB. this ain't github.` });
      return;
    }

    const id = generateId();
    const pasteTitle = (title?.trim() || 'untitled').slice(0, 100);
    const pasteLang = (language?.trim() || 'plaintext').slice(0, 30);

    let expiresAt: string | null = null;
    if (expires_in) {
      const hours: Record<string, number> = {
        '1h': 1, '24h': 24, '7d': 168, '30d': 720, 'never': 0,
      };
      const h = hours[expires_in];
      if (h && h > 0) {
        expiresAt = new Date(Date.now() + h * 3600000).toISOString().replace('T', ' ').split('.')[0]!;
      }
    }

    // Validate parent
    let parentId: string | null = null;
    if (parent_id) {
      const p = db.prepare('SELECT id FROM pastes WHERE id = ?').get(parent_id) as { id: string } | undefined;
      if (p) parentId = p.id;
    }

    db.prepare(`
      INSERT INTO pastes (id, user_id, username, title, content, language, expires_at, parent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, user.userId, user.email, pasteTitle, content, pasteLang, expiresAt, parentId);

    res.json({
      ok: true,
      paste: {
        id,
        title: pasteTitle,
        language: pasteLang,
        expires_at: expiresAt,
        url: `https://mynig.ga/paste/${id}`,
      },
    });
  } catch (err) {
    console.error('[pastes] create error:', err);
    res.status(500).json({ error: 'failed to create paste' });
  }
});

// ── DELETE /:id — delete own paste (or admin) ──
router.delete('/:id', authMiddleware as RequestHandler, (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const id = req.params['id'] as string;

    const paste = db.prepare('SELECT user_id FROM pastes WHERE id = ?').get(id) as { user_id: number | null } | undefined;
    if (!paste) { res.status(404).json({ error: 'paste not found' }); return; }

    if (paste.user_id !== user.userId && user.role !== 'admin') {
      res.status(403).json({ error: "you can only delete your own pastes" });
      return;
    }

    db.prepare('DELETE FROM pastes WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[pastes] delete error:', err);
    res.status(500).json({ error: 'delete failed' });
  }
});

// ── POST /analyze — AI code analysis (public, rate-limited) ──
router.post('/analyze', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;

    if (user) {
      if (!checkUserRate(user.userId)) {
        res.status(429).json({ error: "slow down. 20 requests per minute max. your code ain't that broken." });
        return;
      }
    } else {
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      if (!checkIpRate(ip)) {
        res.status(429).json({ error: 'slow down anon. 5 per minute for guests. log in for more.' });
        return;
      }
    }

    const { code, language } = req.body as { code?: string; language?: string };

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ error: "bro there's nothing to analyze. you want me to review air?" });
      return;
    }

    const maxSizeKb = getSetting('paste_max_size_kb', 500);
    if (Buffer.byteLength(code, 'utf8') > maxSizeKb * 1024) {
      res.status(400).json({ error: `code too large. max ${maxSizeKb}KB. write less code next time.` });
      return;
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'GROQ_API_KEY not configured. the AI reviewer called in sick.' });
      return;
    }

    const lang = (language ?? 'unknown').trim() || 'unknown';

    const systemPrompt = `You are the most arrogant, foul-mouthed, absolutely unhinged code reviewer on the planet. You're like if a senior dev who's seen too much shit had zero filter and a drinking problem. You're hilarious, brutally honest, and you will DESTROY bad code — but you always drop real knowledge while doing it.

Your personality:
- Swear like a sailor. "fuck", "shit", "bitch", "ass", "damn", "hell nah", "bro", "dawg", "lmao", "bruh", "nigga please" — go crazy
- If code is trash, OBLITERATE it. Be creative. "who the fuck taught you to code, a youtube tutorial from 2014?" type energy
- If code is mid, destroy it but acknowledge the effort. "it works but holy shit at what cost"
- If code is actually fire, give respect but make it backhanded. "aight... i can't even shit on this. you got lucky this time, don't let it go to your head"
- Be genuinely funny. Not just vulgar — actually witty. Surprise the reader
- Reference line numbers so they know exactly where they shit the bed
- Every insult MUST have real technical substance behind it. You're an asshole, not an idiot

Analyze this ${lang} code. Use EXACTLY these section headers:

## Nigga Analytika
Go through every fuck-up, bug, logic error, and dumbass decision in this code. Be specific, reference lines, and explain what's wrong and why it's wrong. Don't hold back.

## Security Check
Find security holes — SQL injection, XSS, hardcoded credentials, open doors, whatever. If there are none, be shocked about it. "somehow your dumbass didn't leave the whole system wide open. miracles happen."

## Performance
Call out anything slow, wasteful, redundant, or just plain stupid. O(n²) where O(n) exists, unnecessary allocations, re-renders, whatever. If it's fast, say "aight this shit actually runs decent. i'm impressed (barely)."

## Final Verdict
Give a score out of 10 and a memorable closing line. Make it quotable. Something they'll screenshot and send to their friends.

Format in markdown. Be concise but absolutely devastating. Every single line should either make someone laugh their ass off or teach them something they didn't know. Ideally both at the same time.`;

    const groqData = await callGroq(apiKey, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: code },
    ], { temperature: 0.6 });

    if (groqData.error) {
      console.error('[pastes] Groq API error:', groqData.error.message);
      res.status(502).json({ error: 'AI reviewer had a stroke. try again.' });
      return;
    }

    const analysis = groqData.choices?.[0]?.message?.content ?? 'analysis came back empty. the AI is speechless.';

    res.json({ analysis });
  } catch (err) {
    console.error('[pastes] analyze error:', err);
    res.status(500).json({ error: 'code analysis exploded. ironic.' });
  }
});

export default router;
