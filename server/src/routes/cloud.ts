import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { authMiddleware, adminMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';
import { getEffectiveLimit } from '../constants.js';
import archiver from 'archiver';
import {
  getCloudUploadUrl,
  getCloudDownloadUrl,
  getCloudObjectSize,
  deleteCloudObject,
  getCloudObject,
  uploadCloudBuffer,
} from '../s3.js';

const router = Router();

// ── Public share routes (no auth) ──

// GET /api/cloud/share/public/:shareId — share info
router.get('/share/public/:shareId', (req: Request, res: Response): void => {
  const shareId = req.params['shareId'] as string;

  const row = db.prepare(`
    SELECT s.id, s.downloads, s.expires_at, s.created_at, s.password_hash,
           f.filename, f.size, f.mime_type
    FROM cloud_shares s
    JOIN cloud_files f ON f.id = s.file_id
    WHERE s.id = ?
  `).get(shareId) as {
    id: string; downloads: number; expires_at: string; created_at: string;
    password_hash: string | null;
    filename: string; size: number; mime_type: string;
  } | undefined;

  if (!row) {
    res.status(404).json({ error: 'share not found. it either never existed or got yeeted.' });
    return;
  }

  const expired = new Date(row.expires_at + 'Z') < new Date();
  res.json({
    id: row.id,
    filename: row.filename,
    size: row.size,
    mime_type: row.mime_type,
    downloads: row.downloads,
    expires_at: row.expires_at,
    created_at: row.created_at,
    expired,
    has_password: !!row.password_hash,
  });
});

// GET /api/cloud/share/public/:shareId/download — redirect to presigned S3 URL
router.get('/share/public/:shareId/download', (req: Request, res: Response): void => {
  const shareId = req.params['shareId'] as string;

  const row = db.prepare(`
    SELECT s.id, s.file_id, s.expires_at, s.user_id, s.password_hash,
           f.filename, f.mime_type, f.user_id as file_owner_id
    FROM cloud_shares s
    JOIN cloud_files f ON f.id = s.file_id
    WHERE s.id = ?
  `).get(shareId) as {
    id: string; file_id: string; expires_at: string; user_id: number;
    password_hash: string | null;
    filename: string; mime_type: string; file_owner_id: number;
  } | undefined;

  if (!row) {
    res.status(404).json({ error: 'share not found.' });
    return;
  }

  if (new Date(row.expires_at + 'Z') < new Date()) {
    res.status(410).json({ error: 'this share link has expired. ask the owner for a new one.' });
    return;
  }

  // Password check
  if (row.password_hash) {
    const pw = req.query['pw'] as string | undefined;
    if (!pw) {
      res.status(403).json({ error: 'this share is password-protected. provide ?pw= to continue.' });
      return;
    }
    if (!bcrypt.compareSync(pw, row.password_hash)) {
      res.status(403).json({ error: 'wrong password. try again or ask the owner.' });
      return;
    }
  }

  // Increment download counter
  db.prepare('UPDATE cloud_shares SET downloads = downloads + 1 WHERE id = ?').run(shareId);

  void (async () => {
    try {
      const url = await getCloudDownloadUrl(row.file_owner_id, row.file_id, row.filename, row.mime_type);
      res.redirect(302, url);
    } catch (err) {
      console.error('share download error:', err);
      res.status(500).json({ error: 'download failed. S3 is not in the mood.' });
    }
  })();
});

// ── All remaining routes require auth ──
router.use(authMiddleware);

// ── Helpers ──

/** Total storage used: cloud files + S3-backed email attachments */
function getCloudUsed(userId: number): number {
  const cloudRow = db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM cloud_files WHERE user_id = ?').get(userId) as { total: number };
  const mailRow = db.prepare(`
    SELECT COALESCE(SUM(a.size), 0) as total FROM email_attachments a
    JOIN emails e ON e.id = a.email_id WHERE a.s3_key IS NOT NULL AND e.owner_id = ?
  `).get(userId) as { total: number };
  return cloudRow.total + mailRow.total;
}

// ── POST /api/cloud/upload/presign ──
// Generate presigned PUT URL for direct S3 upload
router.post('/upload/presign', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;
  const { filename, path, contentType, size } = req.body as {
    filename?: string;
    path?: string;
    contentType?: string;
    size?: number;
  };

  if (!filename || typeof filename !== 'string') {
    res.status(400).json({ error: 'filename required. what are you uploading, nothing?' });
    return;
  }
  if (!size || typeof size !== 'number' || size <= 0) {
    res.status(400).json({ error: 'size required and must be positive.' });
    return;
  }

  const filePath = path || '/';
  const mime = contentType || 'application/octet-stream';

  // Check storage limit
  const slotsRow = db.prepare('SELECT bonus_bytes FROM slots_balance WHERE user_id = ?').get(userId) as
    | { bonus_bytes: number } | undefined;
  const bonusBytes = slotsRow?.bonus_bytes ?? 0;
  const limit = getEffectiveLimit(role, bonusBytes);
  const used = getCloudUsed(userId);

  if (limit > 0 && used + size > limit) {
    const limitMB = Math.round(limit / (1024 * 1024));
    const usedMB = (used / (1024 * 1024)).toFixed(1);
    res.status(413).json({
      error: `storage full. ${usedMB}MB used of ${limitMB}MB. delete some shit or stop hoarding.`,
    });
    return;
  }

  const fileId = randomUUID();

  void (async () => {
    try {
      const uploadUrl = await getCloudUploadUrl(userId, fileId, mime);
      res.json({ fileId, uploadUrl, path: filePath });
    } catch (err) {
      console.error('cloud presign error:', err);
      res.status(500).json({ error: 'failed to generate upload URL. S3 is having a moment.' });
    }
  })();
});

// ── POST /api/cloud/upload/confirm ──
// Verify upload via HeadObject, insert into cloud_files
router.post('/upload/confirm', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { fileId, filename, path, contentType, size } = req.body as {
    fileId?: string;
    filename?: string;
    path?: string;
    contentType?: string;
    size?: number;
  };

  if (!fileId || !filename) {
    res.status(400).json({ error: 'fileId and filename required.' });
    return;
  }

  const filePath = path || '/';
  const mime = contentType || 'application/octet-stream';

  void (async () => {
    try {
      const s3Size = await getCloudObjectSize(userId, fileId);
      if (s3Size === null) {
        res.status(404).json({ error: 'file not found in S3. upload it first, genius.' });
        return;
      }

      // Always use actual S3 size — never trust the client
      const actualSize = s3Size;

      // Re-check storage limit (prevents TOCTOU race from concurrent uploads)
      const role = req.user!.role;
      const slotsRow = db.prepare('SELECT bonus_bytes FROM slots_balance WHERE user_id = ?').get(userId) as
        | { bonus_bytes: number } | undefined;
      const bonusBytes = slotsRow?.bonus_bytes ?? 0;
      const limit = getEffectiveLimit(role, bonusBytes);
      const used = getCloudUsed(userId);

      if (limit > 0 && used + actualSize > limit) {
        // Over limit — delete the orphaned S3 object
        await deleteCloudObject(userId, fileId);
        const limitMB = Math.round(limit / (1024 * 1024));
        res.status(413).json({ error: `storage full (${limitMB}MB limit). file deleted from S3.` });
        return;
      }

      db.prepare(`
        INSERT INTO cloud_files (id, user_id, filename, path, mime_type, size, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(fileId, userId, filename, filePath, mime, actualSize);

      res.json({ ok: true, fileId, size: actualSize });
    } catch (err) {
      console.error('cloud confirm error:', err);
      res.status(500).json({ error: 'confirmation failed. the cloud is confused.' });
    }
  })();
});

// ── GET /api/cloud/download/:fileId ──
// Generate presigned GET URL and redirect
router.get('/download/:fileId', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;
  const fileId = req.params['fileId'] as string;

  const file = db.prepare('SELECT * FROM cloud_files WHERE id = ?').get(fileId) as {
    id: string; user_id: number; filename: string; path: string;
    mime_type: string; size: number;
  } | undefined;

  if (!file) {
    res.status(404).json({ error: 'file not found. it probably ran away.' });
    return;
  }

  // Allow owner or admin
  if (file.user_id !== userId && role !== 'admin') {
    res.status(403).json({ error: 'not your file, buddy.' });
    return;
  }

  void (async () => {
    try {
      const url = await getCloudDownloadUrl(file.user_id, fileId, file.filename, file.mime_type);
      res.redirect(302, url);
    } catch (err) {
      console.error('cloud download error:', err);
      res.status(500).json({ error: 'download failed. S3 ghosted us.' });
    }
  })();
});

// ── DELETE /api/cloud/file/:fileId ──
// Delete from DB and S3
router.delete('/file/:fileId', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;
  const fileId = req.params['fileId'] as string;

  const file = db.prepare('SELECT user_id FROM cloud_files WHERE id = ?').get(fileId) as
    { user_id: number } | undefined;

  if (!file) {
    res.status(404).json({ error: 'already gone. you deleted a ghost.' });
    return;
  }

  if (file.user_id !== userId && role !== 'admin') {
    res.status(403).json({ error: 'not your file to delete.' });
    return;
  }

  void (async () => {
    try {
      await deleteCloudObject(file.user_id, fileId);
      db.prepare('DELETE FROM cloud_files WHERE id = ?').run(fileId);
      res.json({ ok: true });
    } catch (err) {
      console.error('cloud delete error:', err);
      // S3 might have failed — still delete DB row to avoid ghost entries
      db.prepare('DELETE FROM cloud_files WHERE id = ?').run(fileId);
      res.json({ ok: true });
    }
  })();
});

// ── GET /api/cloud/files ──
// List all files for current user
router.get('/files', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const files = db.prepare(
    'SELECT id, filename, path, mime_type, size, uploaded_at FROM cloud_files WHERE user_id = ? ORDER BY uploaded_at DESC'
  ).all(userId) as { id: string; filename: string; path: string; mime_type: string; size: number; uploaded_at: string }[];

  res.json({ files });
});

// ── GET /api/cloud/stats ──
// Storage stats: cloud files + S3-backed email attachments
router.get('/stats', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  // getCloudUsed already includes cloud_files + mail attachments — don't double-count
  const used = getCloudUsed(userId);

  const slotsRow = db.prepare('SELECT bonus_bytes, bytebucks FROM slots_balance WHERE user_id = ?').get(userId) as
    | { bonus_bytes: number; bytebucks: number } | undefined;
  const bonusBytes = slotsRow?.bonus_bytes ?? 0;
  const limit = getEffectiveLimit(role, bonusBytes);

  res.json({ used, limit, role, bonus_bytes: bonusBytes, niggabytes: slotsRow?.bytebucks ?? 0 });
});

// ── POST /api/cloud/migrate ──
// Migrate old data:// files from filesystem JSON to S3
router.post('/migrate', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const fsRow = db.prepare('SELECT filesystem FROM user_filesystems WHERE user_id = ?').get(userId) as
    | { filesystem: string } | undefined;

  if (!fsRow) {
    res.json({ ok: true, migrated: 0, message: 'no filesystem to migrate.' });
    return;
  }

  let tree: Record<string, unknown>;
  try {
    tree = JSON.parse(fsRow.filesystem) as Record<string, unknown>;
  } catch {
    res.json({ ok: true, migrated: 0, message: 'invalid filesystem JSON.' });
    return;
  }

  // Walk tree and find data:// files to migrate
  interface MigrateItem {
    parentChildren: Record<string, unknown>;
    key: string;
    node: { name: string; content: string; type: string };
  }

  const toMigrate: MigrateItem[] = [];

  function walkTree(node: Record<string, unknown>, path: string): void {
    const children = node['children'] as Record<string, Record<string, unknown>> | undefined;
    if (!children) return;

    for (const [key, child] of Object.entries(children)) {
      if (child['type'] === 'directory') {
        walkTree(child, path + key + '/');
      } else if (child['type'] === 'file') {
        const content = child['content'] as string | undefined;
        if (content && content.startsWith('data:')) {
          toMigrate.push({
            parentChildren: children as unknown as Record<string, unknown>,
            key,
            node: { name: child['name'] as string || key, content, type: 'file' },
          });
        }
      }
    }
  }

  walkTree(tree as Record<string, unknown>, '/');

  if (toMigrate.length === 0) {
    res.json({ ok: true, migrated: 0, message: 'nothing to migrate. you\'re already clean.' });
    return;
  }

  void (async () => {
    try {
      let migrated = 0;

      for (const item of toMigrate) {
        const fileId = randomUUID();
        const content = item.node.content;

        // Parse data URL to get mime type and binary data
        const mimeMatch = content.match(/^data:([^;]+);base64,/);
        const mimeType = mimeMatch?.[1] ?? 'application/octet-stream';
        const base64Data = content.slice(content.indexOf(',') + 1);
        const size = Math.floor(base64Data.length * 3 / 4);

        // Upload to S3
        const uploadUrl = await getCloudUploadUrl(userId, fileId, mimeType);
        const binaryData = Buffer.from(base64Data, 'base64');

        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': mimeType },
          body: binaryData,
        });

        if (!uploadRes.ok) {
          console.error(`cloud migrate: failed to upload ${item.node.name}:`, uploadRes.status);
          continue;
        }

        // Insert into cloud_files DB
        db.prepare(`
          INSERT INTO cloud_files (id, user_id, filename, path, mime_type, size, uploaded_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(fileId, userId, item.node.name, '/', mimeType, binaryData.length);

        // Replace in-tree: remove content, add s3Key + size + mimeType
        const nodeRef = item.parentChildren[item.key] as Record<string, unknown>;
        delete nodeRef['content'];
        nodeRef['s3Key'] = fileId;
        nodeRef['size'] = binaryData.length;
        nodeRef['mimeType'] = mimeType;

        migrated++;
      }

      // Save the trimmed tree back
      if (migrated > 0) {
        const serialized = JSON.stringify(tree);
        db.prepare(`
          UPDATE user_filesystems SET filesystem = ?, updated_at = datetime('now')
          WHERE user_id = ?
        `).run(serialized, userId);
      }

      res.json({
        ok: true,
        migrated,
        message: migrated > 0
          ? `migrated ${migrated} file(s) to S3. your cloud is now 10x more professional.`
          : 'nothing needed migration.',
      });
    } catch (err) {
      console.error('cloud migrate error:', err);
      res.status(500).json({ error: 'migration failed. some files may have been partially migrated.' });
    }
  })();
});

// ── PATCH /api/cloud/file/:fileId ──
// Rename file or update path
router.patch('/file/:fileId', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;
  const fileId = req.params['fileId'] as string;
  const { filename, path } = req.body as { filename?: string; path?: string };

  if (!filename && !path) {
    res.status(400).json({ error: 'nothing to update. are you testing me?' });
    return;
  }

  const file = db.prepare('SELECT user_id FROM cloud_files WHERE id = ?').get(fileId) as
    { user_id: number } | undefined;

  if (!file) {
    res.status(404).json({ error: 'file not found. can\'t rename a ghost.' });
    return;
  }

  if (file.user_id !== userId && role !== 'admin') {
    res.status(403).json({ error: 'not your file to rename.' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (filename && typeof filename === 'string') {
    updates.push('filename = ?');
    params.push(filename);
  }
  if (path && typeof path === 'string') {
    updates.push('path = ?');
    params.push(path);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'filename or path must be a non-empty string.' });
    return;
  }

  params.push(fileId);
  db.prepare(`UPDATE cloud_files SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// ── PATCH /api/cloud/files/bulk-move ──
// Bulk update path for multiple files (used when moving a folder)
router.patch('/files/bulk-move', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { moves } = req.body as { moves?: { id: string; filename?: string; path: string }[] };

  if (!moves || !Array.isArray(moves) || moves.length === 0) {
    res.status(400).json({ error: 'moves array required.' });
    return;
  }

  const stmt = db.prepare('UPDATE cloud_files SET path = ?, filename = COALESCE(?, filename) WHERE id = ? AND user_id = ?');
  const tx = db.transaction(() => {
    let updated = 0;
    for (const m of moves) {
      const result = stmt.run(m.path, m.filename ?? null, m.id, userId);
      updated += result.changes;
    }
    return updated;
  });

  const updated = tx();
  res.json({ ok: true, updated });
});

// ── Share endpoints (authenticated) ──

// GET /api/cloud/share-for/:fileId — find active share for a file
router.get('/share-for/:fileId', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const fileId = req.params['fileId'] as string;

  const row = db.prepare(`
    SELECT s.id, s.file_id, s.downloads, s.expires_at, s.created_at, s.password_hash,
           f.filename, f.size, f.mime_type
    FROM cloud_shares s
    JOIN cloud_files f ON f.id = s.file_id
    WHERE s.file_id = ? AND s.user_id = ? AND s.expires_at >= datetime('now')
    ORDER BY s.created_at DESC LIMIT 1
  `).get(fileId, userId) as {
    id: string; file_id: string; downloads: number; expires_at: string; created_at: string;
    password_hash: string | null;
    filename: string; size: number; mime_type: string;
  } | undefined;

  if (!row) {
    res.json({ share: null });
    return;
  }

  const origin = `${req.protocol}://${req.get('host') ?? 'mynig.ga'}`;
  res.json({
    share: {
      id: row.id,
      file_id: row.file_id,
      filename: row.filename,
      size: row.size,
      mime_type: row.mime_type,
      downloads: row.downloads,
      expires_at: row.expires_at,
      created_at: row.created_at,
      has_password: !!row.password_hash,
      url: `${origin}/d/${row.id}`,
    },
  });
});

// POST /api/cloud/share-folder — zip a folder and create share link
router.post('/share-folder', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { path: folderPath, password, expiry_days } = req.body as {
    path?: string;
    password?: string;
    expiry_days?: number;
  };

  if (!folderPath || typeof folderPath !== 'string') {
    res.status(400).json({ error: 'path required. where\'s the folder?' });
    return;
  }

  // Find all S3 files in this folder recursively
  const files = db.prepare(`
    SELECT id, filename, path, mime_type, size
    FROM cloud_files
    WHERE user_id = ? AND (path = ? OR path LIKE ? || '/%')
  `).all(userId, folderPath, folderPath) as {
    id: string; filename: string; path: string; mime_type: string; size: number;
  }[];

  if (files.length === 0) {
    res.status(400).json({ error: 'folder is empty or has no S3 files. nothing to zip.' });
    return;
  }

  // Pre-check storage limit (zip ≈ total file size, check before doing expensive work)
  const totalFileSize = files.reduce((sum, f) => sum + f.size, 0);
  const role = req.user!.role;
  const slotsRow = db.prepare('SELECT bonus_bytes FROM slots_balance WHERE user_id = ?').get(userId) as
    | { bonus_bytes: number } | undefined;
  const bonusBytes = slotsRow?.bonus_bytes ?? 0;
  const limit = getEffectiveLimit(role, bonusBytes);
  const used = getCloudUsed(userId);

  if (limit > 0 && used + totalFileSize > limit) {
    const limitMB = Math.round(limit / (1024 * 1024));
    const usedMB = (used / (1024 * 1024)).toFixed(1);
    res.status(413).json({
      error: `zip would push you over the ${limitMB}MB limit (${usedMB}MB used). delete some stuff first.`,
    });
    return;
  }

  void (async () => {
    try {
      const archive = archiver('zip', { zlib: { level: 5 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));

      const archiveFinished = new Promise<void>((resolve, reject) => {
        archive.on('end', resolve);
        archive.on('error', reject);
      });

      // Stream each file from S3 into the archive
      for (const file of files) {
        const stream = await getCloudObject(userId, file.id);
        // Build relative path: strip folderPath prefix from file.path
        let relativePath: string;
        if (file.path === folderPath) {
          relativePath = file.filename;
        } else {
          const sub = file.path.slice(folderPath.length).replace(/^\//, '');
          relativePath = sub ? `${sub}/${file.filename}` : file.filename;
        }
        archive.append(stream, { name: relativePath });
      }

      await archive.finalize();
      await archiveFinished;

      const zipBuffer = Buffer.concat(chunks);

      // Create zip file entry in cloud_files
      const zipId = randomUUID();
      const folderName = folderPath === '/' ? 'root' : folderPath.split('/').filter(Boolean).pop() || 'folder';
      const zipFilename = `${folderName}.zip`;

      await uploadCloudBuffer(userId, zipId, zipBuffer, 'application/zip');

      db.prepare(`
        INSERT INTO cloud_files (id, user_id, filename, path, mime_type, size, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(zipId, userId, zipFilename, folderPath, 'application/zip', zipBuffer.length);

      // Create share link (same logic as POST /share/:fileId)
      const ALLOWED_EXPIRY = [0, 1, 7, 30];
      const rawExpiry = typeof expiry_days === 'number' ? expiry_days : 7;
      const expiryDays = ALLOWED_EXPIRY.includes(rawExpiry) ? rawExpiry : 7;

      const shareId = randomBytes(6).toString('hex');
      const expiresAt = expiryDays === 0
        ? '9999-12-31 23:59:59'
        : new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

      const passwordHash = password ? bcrypt.hashSync(password, 10) : null;

      db.prepare(`
        INSERT INTO cloud_shares (id, file_id, user_id, expires_at, password_hash)
        VALUES (?, ?, ?, ?, ?)
      `).run(shareId, zipId, userId, expiresAt, passwordHash);

      const origin = `${req.protocol}://${req.get('host') ?? 'mynig.ga'}`;
      const url = `${origin}/d/${shareId}`;

      res.json({
        id: shareId,
        url,
        zip_file_id: zipId,
        zip_filename: zipFilename,
        zip_size: zipBuffer.length,
        files_zipped: files.length,
        expires_at: expiresAt,
        has_password: !!passwordHash,
        downloads: 0,
      });
    } catch (err) {
      console.error('share-folder error:', err);
      res.status(500).json({ error: 'failed to zip folder. the cloud choked on your files.' });
    }
  })();
});

// POST /api/cloud/share/:fileId — create share link
router.post('/share/:fileId', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const fileId = req.params['fileId'] as string;
  const { password, expiry_days } = req.body as { password?: string; expiry_days?: number };

  const file = db.prepare('SELECT id, user_id FROM cloud_files WHERE id = ?').get(fileId) as
    { id: string; user_id: number } | undefined;

  if (!file) {
    res.status(404).json({ error: 'file not found. can\'t share what doesn\'t exist.' });
    return;
  }

  if (file.user_id !== userId) {
    res.status(403).json({ error: 'not your file to share, buddy.' });
    return;
  }

  // Whitelist expiry: 0=forever, 1, 7, 30. Default 7.
  const ALLOWED_EXPIRY = [0, 1, 7, 30];
  const rawExpiry = typeof expiry_days === 'number' ? expiry_days : 7;
  const expiryDays = ALLOWED_EXPIRY.includes(rawExpiry) ? rawExpiry : 7;

  const shareId = randomBytes(6).toString('hex');
  const expiresAt = expiryDays === 0
    ? '9999-12-31 23:59:59'
    : new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  const passwordHash = password ? bcrypt.hashSync(password, 10) : null;

  db.prepare(`
    INSERT INTO cloud_shares (id, file_id, user_id, expires_at, password_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(shareId, fileId, userId, expiresAt, passwordHash);

  const origin = `${req.protocol}://${req.get('host') ?? 'mynig.ga'}`;
  const url = `${origin}/d/${shareId}`;

  res.json({ id: shareId, url, expires_at: expiresAt, has_password: !!passwordHash, downloads: 0 });
});

// GET /api/cloud/shares — list all my active shares
router.get('/shares', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const shares = db.prepare(`
    SELECT s.id, s.file_id, s.downloads, s.expires_at, s.created_at, s.password_hash,
           f.filename, f.size, f.mime_type
    FROM cloud_shares s
    JOIN cloud_files f ON f.id = s.file_id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
  `).all(userId) as {
    id: string; file_id: string; downloads: number; expires_at: string; created_at: string;
    password_hash: string | null;
    filename: string; size: number; mime_type: string;
  }[];

  const result = shares.map(({ password_hash, ...s }) => ({
    ...s,
    has_password: !!password_hash,
    expired: new Date(s.expires_at + 'Z') < new Date(),
  }));

  res.json({ shares: result });
});

// DELETE /api/cloud/share/:shareId — revoke share
router.delete('/share/:shareId', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const shareId = req.params['shareId'] as string;

  const share = db.prepare('SELECT user_id FROM cloud_shares WHERE id = ?').get(shareId) as
    { user_id: number } | undefined;

  if (!share) {
    res.status(404).json({ error: 'share not found. already revoked or never existed.' });
    return;
  }

  if (share.user_id !== userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'not your share to revoke.' });
    return;
  }

  db.prepare('DELETE FROM cloud_shares WHERE id = ?').run(shareId);
  res.json({ ok: true });
});

// ── Cleanup expired shares (every 30 min) ──
setInterval(() => {
  try {
    const result = db.prepare("DELETE FROM cloud_shares WHERE expires_at < datetime('now')").run();
    if (result.changes > 0) {
      console.log(`[cloud] cleaned up ${result.changes} expired share(s)`);
    }
  } catch (err) {
    console.error('[cloud] share cleanup error:', err);
  }
}, 30 * 60 * 1000);

// ── Admin endpoints ──

// GET /api/cloud/admin/:userId/files
router.get('/admin/:userId/files', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const targetId = parseInt(req.params['userId'] as string, 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: 'invalid user id.' });
    return;
  }

  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(targetId) as { email: string } | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found.' });
    return;
  }

  const files = db.prepare(
    'SELECT id, filename, path, mime_type, size, uploaded_at FROM cloud_files WHERE user_id = ? ORDER BY uploaded_at DESC'
  ).all(targetId) as { id: string; filename: string; path: string; mime_type: string; size: number; uploaded_at: string }[];

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  res.json({ email: user.email, files, total_size: totalSize });
});

// POST /api/cloud/admin/migrate-all — bulk migrate all users
router.post('/admin/migrate-all', adminMiddleware, (_req: AuthRequest, res: Response): void => {
  const rows = db.prepare('SELECT user_id, filesystem FROM user_filesystems').all() as
    { user_id: number; filesystem: string }[];

  let totalMigrated = 0;
  let usersProcessed = 0;

  void (async () => {
    try {
      for (const row of rows) {
        let tree: Record<string, unknown>;
        try {
          tree = JSON.parse(row.filesystem) as Record<string, unknown>;
        } catch { continue; }

        const userId = row.user_id;
        let userMigrated = 0;

        function walkAndMigrate(node: Record<string, unknown>): { key: string; parentChildren: Record<string, unknown>; content: string; name: string }[] {
          const items: { key: string; parentChildren: Record<string, unknown>; content: string; name: string }[] = [];
          const children = node['children'] as Record<string, Record<string, unknown>> | undefined;
          if (!children) return items;

          for (const [key, child] of Object.entries(children)) {
            if (child['type'] === 'directory') {
              items.push(...walkAndMigrate(child));
            } else if (child['type'] === 'file') {
              const content = child['content'] as string | undefined;
              if (content && content.startsWith('data:')) {
                items.push({ key, parentChildren: children as unknown as Record<string, unknown>, content, name: child['name'] as string || key });
              }
            }
          }
          return items;
        }

        const items = walkAndMigrate(tree as Record<string, unknown>);
        if (items.length === 0) continue;

        for (const item of items) {
          const fileId = randomUUID();
          const mimeMatch = item.content.match(/^data:([^;]+);base64,/);
          const mimeType = mimeMatch?.[1] ?? 'application/octet-stream';
          const base64Data = item.content.slice(item.content.indexOf(',') + 1);
          const binaryData = Buffer.from(base64Data, 'base64');

          try {
            const uploadUrl = await getCloudUploadUrl(userId, fileId, mimeType);
            const uploadRes = await fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': mimeType },
              body: binaryData,
            });

            if (!uploadRes.ok) continue;

            db.prepare(`
              INSERT INTO cloud_files (id, user_id, filename, path, mime_type, size, uploaded_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            `).run(fileId, userId, item.name, '/', mimeType, binaryData.length);

            const nodeRef = item.parentChildren[item.key] as Record<string, unknown>;
            delete nodeRef['content'];
            nodeRef['s3Key'] = fileId;
            nodeRef['size'] = binaryData.length;
            nodeRef['mimeType'] = mimeType;

            userMigrated++;
          } catch {
            // skip individual file errors
          }
        }

        if (userMigrated > 0) {
          db.prepare(`
            UPDATE user_filesystems SET filesystem = ?, updated_at = datetime('now')
            WHERE user_id = ?
          `).run(JSON.stringify(tree), userId);
          totalMigrated += userMigrated;
          usersProcessed++;
        }
      }

      res.json({
        ok: true,
        users_processed: usersProcessed,
        files_migrated: totalMigrated,
        message: totalMigrated > 0
          ? `migrated ${totalMigrated} files across ${usersProcessed} users.`
          : 'nothing to migrate.',
      });
    } catch (err) {
      console.error('bulk migrate error:', err);
      res.status(500).json({ error: 'bulk migration partially failed.' });
    }
  })();
});

export default router;
