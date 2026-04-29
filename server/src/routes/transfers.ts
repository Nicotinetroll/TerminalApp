import { Router, type Response } from 'express';
import crypto from 'crypto';
import db from '../db.js';
import { authMiddleware, AuthRequest } from '../middleware.js';
import { getPresignedUploadUrl, getPresignedDownloadUrl, getObjectSize, deleteObject } from '../s3.js';

import { getSetting, getTransferMaxSize } from '../constants.js';

const ID_REGEX = /^[a-f0-9]{32}$/;

const router = Router();

function validateId(id: string): boolean {
  return ID_REGEX.test(id);
}

/** Extract a single string param (Express 5 can return string|string[]) */
function getParam(val: string | string[] | undefined): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

function parseNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

// ─── Cleanup expired transfers ───

function cleanupExpired(): void {
  const expired = db.prepare(
    `SELECT id, content_type FROM transfers WHERE expires_at < datetime('now')`
  ).all() as { id: string; content_type: string | null }[];

  if (expired.length === 0) return;

  // Delete S3 objects first, then batch-delete DB rows
  const deletePromises = expired.map(t => deleteObject(t.id, !!t.content_type));
  void Promise.allSettled(deletePromises).then(() => {
    const del = db.prepare('DELETE FROM transfers WHERE id = ?');
    db.transaction(() => {
      for (const t of expired) del.run(t.id);
    })();
    console.log(`[transfers] cleaned up ${expired.length} expired transfer(s)`);
  });
}

// Run on startup + every 30 min
cleanupExpired();
setInterval(cleanupExpired, 30 * 60 * 1000);

// ─── POST / — create upload link (auth) ───

router.post('/', authMiddleware, (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const pending = (db.prepare(
    `SELECT COUNT(*) as cnt FROM transfers WHERE user_id = ? AND uploaded_at IS NULL AND expires_at > datetime('now')`
  ).get(userId) as { cnt: number }).cnt;

  const maxPending = getSetting('transfer_max_pending', 10);
  if (pending >= maxPending) {
    res.status(429).json({ error: `you already have ${maxPending} pending upload links. chill.` });
    return;
  }

  const id = crypto.randomBytes(16).toString('hex');
  const expiryHours = getSetting('transfer_expiry_hours', 12);
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const maxSize = getTransferMaxSize(req.user!.role);

  db.prepare(
    'INSERT INTO transfers (id, user_id, expires_at, max_size) VALUES (?, ?, ?, ?)'
  ).run(id, userId, expiresAt, maxSize);

  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'mynig.ga';
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  const url = `${proto}://${host}/t/${id}`;

  res.json({ id, url, expires_at: expiresAt, max_size: maxSize });
});

// ─── GET / — list my transfers (auth) ───

router.get('/', authMiddleware, (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const transfers = db.prepare(`
    SELECT id, original_names, size, expires_at, uploaded_at, created_at, content_type
    FROM transfers
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(userId) as {
    id: string;
    original_names: string;
    size: number;
    expires_at: string;
    uploaded_at: string | null;
    created_at: string;
    content_type: string | null;
  }[];

  const now = new Date();
  const result = transfers.map(t => ({
    ...t,
    original_names: parseNames(t.original_names),
    expired: new Date(t.expires_at + 'Z') < now,
    content_type: t.content_type,
  }));

  res.json({ transfers: result });
});

// ─── GET /:id — public transfer info ───

router.get('/:id', (req: AuthRequest, res: Response): void => {
  const id = getParam(req.params.id);
  if (!id || !validateId(id)) {
    res.status(400).json({ error: 'invalid transfer id.' });
    return;
  }

  const transfer = db.prepare(`
    SELECT id, original_names, size, expires_at, uploaded_at, created_at, max_size, content_type
    FROM transfers
    WHERE id = ?
  `).get(id) as {
    id: string;
    original_names: string;
    size: number;
    expires_at: string;
    uploaded_at: string | null;
    created_at: string;
    max_size: number;
    content_type: string | null;
  } | undefined;

  if (!transfer) {
    res.status(404).json({ error: 'transfer not found. maybe it expired, maybe it never existed. who knows.' });
    return;
  }

  const expired = new Date(transfer.expires_at + 'Z') < new Date();

  res.json({
    transfer: {
      id: transfer.id,
      original_names: parseNames(transfer.original_names),
      size: transfer.size,
      expires_at: transfer.expires_at,
      uploaded_at: transfer.uploaded_at,
      created_at: transfer.created_at,
      expired,
      status: transfer.uploaded_at ? 'uploaded' : expired ? 'expired' : 'pending',
      max_size: transfer.max_size,
      content_type: transfer.content_type,
    },
  });
});

// ─── POST /:id/presign — get presigned S3 upload URL (public) ───

router.post('/:id/presign', (req: AuthRequest, res: Response): void => {
  const id = getParam(req.params.id);
  if (!id || !validateId(id)) {
    res.status(400).json({ error: 'invalid transfer id.' });
    return;
  }

  const transfer = db.prepare(
    `SELECT id, uploaded_at, expires_at FROM transfers WHERE id = ?`
  ).get(id) as { id: string; uploaded_at: string | null; expires_at: string } | undefined;

  if (!transfer) {
    res.status(404).json({ error: 'transfer link not found. it\'s either expired or you made it up.' });
    return;
  }

  if (transfer.uploaded_at) {
    res.status(409).json({ error: 'files already uploaded to this link. one shot deal.' });
    return;
  }

  const expired = new Date(transfer.expires_at + 'Z') < new Date();
  if (expired) {
    res.status(410).json({ error: 'this upload link has expired. time waits for no one.' });
    return;
  }

  const body = req.body as { content_type?: string } | undefined;
  const contentType = typeof body?.content_type === 'string' && body.content_type.includes('/') ? body.content_type : null;
  const raw = !!contentType;

  // Store content_type in DB for raw mode
  if (contentType) {
    db.prepare('UPDATE transfers SET content_type = ? WHERE id = ?').run(contentType, id);
  }

  void (async () => {
    try {
      const uploadUrl = await getPresignedUploadUrl(id, raw, contentType ?? undefined);
      res.json({ uploadUrl });
    } catch (err) {
      console.error('[transfers] presign error:', err);
      res.status(500).json({ error: 'failed to generate upload URL. S3 having a moment.' });
    }
  })();
});

// ─── POST /:id/complete — confirm upload completed (public) ───

router.post('/:id/complete', (req: AuthRequest, res: Response): void => {
  const id = getParam(req.params.id);
  if (!id || !validateId(id)) {
    res.status(400).json({ error: 'invalid transfer id.' });
    return;
  }

  const body = req.body as { names?: string[]; size?: number } | undefined;
  // Validate names: must be array of strings, max 10000 items, max 255 chars each
  let names: string[] = [];
  if (Array.isArray(body?.names)) {
    names = body.names
      .filter((n): n is string => typeof n === 'string')
      .slice(0, 10000)
      .map(n => n.slice(0, 255));
  }

  const transfer = db.prepare(
    `SELECT id, uploaded_at, expires_at, max_size, content_type FROM transfers WHERE id = ?`
  ).get(id) as { id: string; uploaded_at: string | null; expires_at: string; max_size: number; content_type: string | null } | undefined;

  if (!transfer) {
    res.status(404).json({ error: 'transfer not found.' });
    return;
  }

  if (transfer.uploaded_at) {
    res.status(409).json({ error: 'already marked as uploaded.' });
    return;
  }

  // Verify the S3 object actually exists
  void (async () => {
    try {
      const raw = !!transfer.content_type;
      const s3Size = await getObjectSize(id, raw);
      if (s3Size === null) {
        res.status(400).json({ error: 'no file found in S3. upload first, then confirm. duh.' });
        return;
      }

      // Enforce max_size server-side — delete oversized uploads
      if (transfer.max_size > 0 && s3Size > transfer.max_size) {
        await deleteObject(id, raw);
        const limitMB = Math.round(transfer.max_size / (1024 * 1024));
        const actualMB = Math.round(s3Size / (1024 * 1024));
        res.status(413).json({ error: `file too large: ${actualMB}MB exceeds ${limitMB}MB limit. nice try.` });
        return;
      }

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const result = db.prepare(
        `UPDATE transfers SET original_names = ?, size = ?, uploaded_at = ? WHERE id = ? AND uploaded_at IS NULL`
      ).run(JSON.stringify(names), s3Size, now, id);

      if (result.changes === 0) {
        res.status(409).json({ error: 'concurrent upload completed first.' });
        return;
      }

      res.json({
        ok: true,
        files: names.length,
        size: s3Size,
        message: names.length === 1 ? 'file uploaded successfully.' : `${names.length} files zipped and uploaded.`,
      });
    } catch (err) {
      console.error('[transfers] complete error:', err);
      res.status(500).json({ error: 'failed to verify upload.' });
    }
  })();
});

// ─── GET /:id/download — redirect to presigned S3 download URL ───

router.get('/:id/download', (req: AuthRequest, res: Response): void => {
  const id = getParam(req.params.id);
  if (!id || !validateId(id)) {
    res.status(400).json({ error: 'invalid transfer id.' });
    return;
  }

  const transfer = db.prepare(
    `SELECT id, original_names, uploaded_at, expires_at, content_type FROM transfers WHERE id = ?`
  ).get(id) as { id: string; original_names: string; uploaded_at: string | null; expires_at: string; content_type: string | null } | undefined;

  if (!transfer) {
    res.status(404).json({ error: 'transfer not found.' });
    return;
  }

  if (!transfer.uploaded_at) {
    res.status(404).json({ error: 'nothing uploaded yet. patience.' });
    return;
  }

  const expired = new Date(transfer.expires_at + 'Z') < new Date();
  if (expired) {
    res.status(410).json({ error: 'this transfer has expired. shoulda downloaded it sooner.' });
    return;
  }

  const raw = !!transfer.content_type;
  const names = parseNames(transfer.original_names);
  const downloadName = raw && names[0] ? names[0] : `transfer-${id.slice(0, 8)}.zip`;
  const mime = raw && transfer.content_type ? transfer.content_type : 'application/zip';

  void (async () => {
    try {
      const url = await getPresignedDownloadUrl(id, downloadName, raw, mime);
      res.redirect(url);
    } catch (err) {
      console.error('[transfers] download presign error:', err);
      res.status(500).json({ error: 'failed to generate download URL.' });
    }
  })();
});

// ─── DELETE /:id — delete transfer (auth, owner only) ───

router.delete('/:id', authMiddleware, (req: AuthRequest, res: Response): void => {
  const id = getParam(req.params.id);
  if (!id || !validateId(id)) {
    res.status(400).json({ error: 'invalid transfer id.' });
    return;
  }

  const userId = req.user!.userId;

  const transfer = db.prepare(
    'SELECT id, user_id, content_type FROM transfers WHERE id = ?'
  ).get(id) as { id: string; user_id: number; content_type: string | null } | undefined;

  if (!transfer) {
    res.status(404).json({ error: 'transfer not found.' });
    return;
  }

  if (transfer.user_id !== userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'not your transfer, not your problem.' });
    return;
  }

  void (async () => {
    try {
      await deleteObject(id, !!transfer.content_type);
      db.prepare('DELETE FROM transfers WHERE id = ?').run(id);
      res.json({ ok: true });
    } catch (err) {
      console.error('[transfers] delete error:', err);
      // Still delete DB row — S3 cleanup will catch orphans
      db.prepare('DELETE FROM transfers WHERE id = ?').run(id);
      res.json({ ok: true });
    }
  })();
});

export default router;
