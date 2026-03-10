import { Router, Response } from 'express';
import { createTransport } from 'nodemailer';
import { randomUUID, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveMx } from 'dns/promises';
import multer from 'multer';
import db from '../db.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware.js';
import { emitToUser } from '../socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();
const DOMAIN = 'mynig.ga';
const SEND_RATE_LIMIT = 20; // per hour per user
const ADDRESS_REGEX = /^[a-z0-9._-]{2,32}$/;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB per file

function generateMailPassword(): string {
  return randomBytes(6).toString('base64url'); // 8 chars, url-safe
}
const MAX_ATTACHMENTS = 5;

// Multer config — memory storage for BLOB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: MAX_ATTACHMENTS },
});

// Threading helper — find or create thread_id
function getThreadId(inReplyTo: string | null, messageId: string): string {
  if (inReplyTo) {
    // Look for parent email's thread_id
    const parent = db.prepare('SELECT thread_id FROM emails WHERE message_id = ? LIMIT 1').get(inReplyTo) as { thread_id: string | null } | undefined;
    if (parent?.thread_id) return parent.thread_id;
  }
  // New thread
  return messageId;
}

// Reserved addresses nobody can claim
const RESERVED = new Set([
  'admin', 'postmaster', 'webmaster', 'abuse', 'noreply',
  'no-reply', 'root', 'mailer-daemon', 'hostmaster', 'info',
  'support', 'security', 'www', 'mail', 'ftp', 'smtp', 'imap',
]);

// DKIM config — load private key if it exists
const dkimKeyPath = resolve(__dirname, '..', '..', 'data', 'dkim-private.pem');
let dkimOptions: object | undefined;
if (existsSync(dkimKeyPath)) {
  try {
    const privateKey = readFileSync(dkimKeyPath, 'utf-8');
    dkimOptions = {
      domainName: DOMAIN,
      keySelector: 'mail',
      privateKey,
    };
  } catch {
    console.warn('DKIM key found but could not be read');
  }
}

// Rate limiting: track sends per user per hour
const sendCounts = new Map<number, { count: number; resetAt: number }>();

// Cleanup expired entries every 30 min to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sendCounts) {
    if (now > entry.resetAt) sendCounts.delete(key);
  }
}, 30 * 60 * 1000);

function checkSendRate(userId: number): boolean {
  const now = Date.now();
  const entry = sendCounts.get(userId);
  if (!entry || now > entry.resetAt) {
    sendCounts.set(userId, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (entry.count >= SEND_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── Internal notification endpoint (BEFORE auth — called by SMTP/IMAP processes) ──
router.post('/internal/mail-notify', (req: AuthRequest, res: Response): void => {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  if (!ip.includes('127.0.0.1') && !ip.includes('::1') && !ip.includes('::ffff:127.0.0.1')) {
    res.status(403).json({ error: 'localhost only' });
    return;
  }
  const { userId, from, subject, to } = req.body as { userId?: number; from?: string; subject?: string; to?: string };
  if (userId) {
    emitToUser(userId, 'mail:new', {
      from: from ?? 'unknown',
      subject: subject ?? '(no subject, just vibes)',
      to: to ?? '',
    });
  }
  res.json({ ok: true });
});

// All mail routes require authentication
router.use(authMiddleware);

// ── GET /api/mail/addresses ──
router.get('/addresses', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const rows = db.prepare(
    'SELECT id, address, display_name, signature, mail_password, created_at FROM email_addresses WHERE user_id = ? ORDER BY created_at'
  ).all(userId) as { id: number; address: string; display_name: string; signature: string; mail_password: string; created_at: string }[];
  res.json({ addresses: rows.map(r => ({ ...r, full: `${r.address}@${DOMAIN}`, has_mail_password: !!r.mail_password, mail_password: undefined })) });
});

// ── POST /api/mail/addresses ──
router.post('/addresses', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  if (role === 'guest') {
    res.status(403).json({ error: "guests don't get email. upgrade or cope." });
    return;
  }

  const { address } = req.body as { address?: string };
  if (!address || typeof address !== 'string') {
    res.status(400).json({ error: 'address is required, genius.' });
    return;
  }

  const clean = address.toLowerCase().trim();

  if (!ADDRESS_REGEX.test(clean)) {
    res.status(400).json({ error: '2-32 chars, lowercase letters/numbers/dots/dashes only.' });
    return;
  }

  if (RESERVED.has(clean)) {
    res.status(400).json({ error: `"${clean}" is reserved. nice try though.` });
    return;
  }

  // Check how many the user already has vs purchased slots
  const count = (db.prepare(
    'SELECT COUNT(*) as cnt FROM email_addresses WHERE user_id = ?'
  ).get(userId) as { cnt: number }).cnt;

  const slotsPurchased = (db.prepare(
    "SELECT COUNT(*) as cnt FROM shop_purchases WHERE user_id = ? AND item_type = 'mail_slot'"
  ).get(userId) as { cnt: number }).cnt;
  const maxAddresses = 1 + slotsPurchased; // 1 free + purchased

  if (count >= maxAddresses) {
    res.status(400).json({ error: "you need more mail slots. hit up the shop, broke boy." });
    return;
  }

  // Check if already taken
  const existing = db.prepare(
    'SELECT id FROM email_addresses WHERE address = ?'
  ).get(clean);

  if (existing) {
    res.status(409).json({ error: `${clean}@${DOMAIN} is already taken. be more creative.` });
    return;
  }

  const plainPassword = generateMailPassword();
  const hashedPassword = bcrypt.hashSync(plainPassword, 10);

  const result = db.prepare(
    'INSERT INTO email_addresses (user_id, address, mail_password) VALUES (?, ?, ?)'
  ).run(userId, clean, hashedPassword);

  res.json({
    address: {
      id: result.lastInsertRowid,
      address: clean,
      full: `${clean}@${DOMAIN}`,
      display_name: '',
      signature: '',
      has_mail_password: true,
      created_at: new Date().toISOString(),
      mail_password_plain: plainPassword,
    },
  });
});

// ── DELETE /api/mail/addresses/:id ──
router.delete('/addresses/:id', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const addrId = parseInt(String(req.params['id']), 10);

  const addr = db.prepare(
    'SELECT id FROM email_addresses WHERE id = ? AND user_id = ?'
  ).get(addrId, userId);

  if (!addr) {
    res.status(404).json({ error: "address not found. maybe it never existed, like your social life." });
    return;
  }

  // Delete associated emails too
  db.prepare('DELETE FROM emails WHERE address_id = ? AND owner_id = ?').run(addrId, userId);
  db.prepare('DELETE FROM email_addresses WHERE id = ?').run(addrId);

  res.json({ ok: true });
});

// ── POST /api/mail/addresses/:id/set-password ──
router.post('/addresses/:id/set-password', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const addrId = parseInt(String(req.params['id']), 10);

  const addr = db.prepare(
    'SELECT id, address FROM email_addresses WHERE id = ? AND user_id = ?'
  ).get(addrId, userId) as { id: number; address: string } | undefined;

  if (!addr) {
    res.status(404).json({ error: "nice try" });
    return;
  }

  const { password } = req.body as { password?: string };
  const plain = (typeof password === 'string' && password.length >= 4) ? password : generateMailPassword();

  if (typeof password === 'string' && password.length > 0 && password.length < 4) {
    res.status(400).json({ error: "4 chars minimum. we're not animals." });
    return;
  }

  const hashed = bcrypt.hashSync(plain, 10);
  db.prepare('UPDATE email_addresses SET mail_password = ? WHERE id = ?').run(hashed, addrId);

  res.json({ mail_password_plain: plain });
});

// ── GET /api/mail/messages ──
router.get('/messages', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const folder = (req.query['folder'] as string) || 'inbox';
  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 100);
  const offset = parseInt(req.query['offset'] as string) || 0;
  const search = (req.query['search'] as string)?.trim() || '';
  const starred = req.query['starred'] === 'true';

  let query = `
    SELECT e.id, e.folder, e.from_address, e.to_address, e.subject, e.is_read, e.is_starred, e.message_id, e.in_reply_to, e.thread_id, e.created_at,
      (SELECT COUNT(*) FROM email_attachments WHERE email_id = e.id) as attachment_count
    FROM emails e
    WHERE e.owner_id = ?
  `;
  const params: (string | number)[] = [userId];

  if (starred) {
    query += ' AND is_starred = 1';
  } else {
    query += ' AND folder = ?';
    params.push(folder);
  }

  if (search) {
    query += ' AND (subject LIKE ? OR from_address LIKE ? OR to_address LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  query += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as {
    id: number; folder: string; from_address: string; to_address: string;
    subject: string; is_read: number; is_starred: number; message_id: string | null;
    in_reply_to: string | null; thread_id: string | null; created_at: string;
    attachment_count: number;
  }[];

  const messages = rows.map(r => ({
    ...r,
    subject: r.subject || '(no subject, just vibes)',
    is_read: !!r.is_read,
    is_starred: !!r.is_starred,
  }));

  res.json({ messages });
});

// ── GET /api/mail/messages/:id ──
router.get('/messages/:id', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const msgId = parseInt(String(req.params['id']), 10);

  const row = db.prepare(
    'SELECT * FROM emails WHERE id = ? AND owner_id = ?'
  ).get(msgId, userId) as {
    id: number; owner_id: number; address_id: number | null; folder: string;
    from_address: string; to_address: string; subject: string; body: string;
    is_read: number; is_starred: number; message_id: string | null; in_reply_to: string | null;
    thread_id: string | null; created_at: string;
  } | undefined;

  if (!row) {
    res.status(404).json({ error: "email not found. poof. gone." });
    return;
  }

  // Mark as read
  if (!row.is_read) {
    db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(msgId);
  }

  // Get attachments (metadata only, no blob data)
  const attachments = db.prepare(
    'SELECT id, filename, mime_type, size FROM email_attachments WHERE email_id = ?'
  ).all(msgId) as { id: number; filename: string; mime_type: string; size: number }[];

  res.json({
    message: {
      ...row,
      subject: row.subject || '(no subject, just vibes)',
      is_read: true,
      is_starred: !!row.is_starred,
      attachments,
    },
  });
});

// ── PUT /api/mail/messages/:id ──
router.put('/messages/:id', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const msgId = parseInt(String(req.params['id']), 10);

  const existing = db.prepare(
    'SELECT id FROM emails WHERE id = ? AND owner_id = ?'
  ).get(msgId, userId);

  if (!existing) {
    res.status(404).json({ error: "email not found." });
    return;
  }

  const { is_read, folder, is_starred } = req.body as { is_read?: boolean; folder?: string; is_starred?: boolean };
  const systemFolders = ['inbox', 'sent', 'trash', 'drafts'];

  if (folder !== undefined) {
    if (!systemFolders.includes(folder)) {
      // Check if it's a custom folder owned by this user
      const customFolder = db.prepare('SELECT id FROM mail_folders WHERE user_id = ? AND name = ?').get(userId, folder);
      if (!customFolder) {
        res.status(400).json({ error: `folder "${folder}" doesn't exist. create it first or pick a real one.` });
        return;
      }
    }
  }

  if (is_read !== undefined) {
    db.prepare('UPDATE emails SET is_read = ? WHERE id = ?').run(is_read ? 1 : 0, msgId);
  }
  if (folder !== undefined) {
    db.prepare('UPDATE emails SET folder = ? WHERE id = ?').run(folder, msgId);
  }
  if (is_starred !== undefined) {
    db.prepare('UPDATE emails SET is_starred = ? WHERE id = ?').run(is_starred ? 1 : 0, msgId);
  }

  res.json({ ok: true });
});

// ── DELETE /api/mail/messages/:id ──
router.delete('/messages/:id', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const msgId = parseInt(String(req.params['id']), 10);

  const existing = db.prepare(
    'SELECT id FROM emails WHERE id = ? AND owner_id = ?'
  ).get(msgId, userId);

  if (!existing) {
    res.status(404).json({ error: "already gone. just like your ex." });
    return;
  }

  db.prepare('DELETE FROM email_attachments WHERE email_id = ?').run(msgId);
  db.prepare('DELETE FROM emails WHERE id = ?').run(msgId);
  res.json({ ok: true });
});

// Helper: save attachments for an email
function saveAttachments(emailId: number, files: Express.Multer.File[]) {
  const stmt = db.prepare(
    'INSERT INTO email_attachments (email_id, filename, mime_type, size, data) VALUES (?, ?, ?, ?, ?)'
  );
  for (const file of files) {
    stmt.run(emailId, file.originalname, file.mimetype, file.size, file.buffer);
  }
}

// Helper: clone attachments from one email to another
function cloneAttachments(sourceEmailId: number, targetEmailId: number) {
  const atts = db.prepare('SELECT filename, mime_type, size, data FROM email_attachments WHERE email_id = ?').all(sourceEmailId) as { filename: string; mime_type: string; size: number; data: Buffer }[];
  const stmt = db.prepare('INSERT INTO email_attachments (email_id, filename, mime_type, size, data) VALUES (?, ?, ?, ?, ?)');
  for (const att of atts) {
    stmt.run(targetEmailId, att.filename, att.mime_type, att.size, att.data);
  }
}

// ── POST /api/mail/send ──
router.post('/send', upload.array('attachments', MAX_ATTACHMENTS), async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  // Rate limit
  if (!checkSendRate(userId)) {
    res.status(429).json({ error: "slow down, spam king. 20 emails/hour limit." });
    return;
  }

  const { to, subject, body, from_address, from_name, in_reply_to } = req.body as {
    to?: string; subject?: string; body?: string;
    from_address?: string; from_name?: string; in_reply_to?: string;
  };

  if (!to || typeof to !== 'string') {
    res.status(400).json({ error: 'who are you sending this to? "to" is required.' });
    return;
  }

  if (!body || typeof body !== 'string') {
    res.status(400).json({ error: "can't send an empty email. this isn't a zen koan." });
    return;
  }

  // Determine sender address + display name
  let senderAddr: string;
  let senderName: string;
  if (from_address) {
    const owned = db.prepare(
      'SELECT id, address, display_name FROM email_addresses WHERE address = ? AND user_id = ?'
    ).get(from_address.split('@')[0]!.toLowerCase(), userId) as { id: number; address: string; display_name: string } | undefined;

    if (!owned) {
      res.status(403).json({ error: "you can't send from an address you don't own. identity theft is a crime." });
      return;
    }
    senderAddr = `${owned.address}@${DOMAIN}`;
    senderName = from_name?.trim() || owned.display_name || owned.address;

    if (from_name?.trim() && from_name.trim() !== owned.display_name) {
      db.prepare('UPDATE email_addresses SET display_name = ? WHERE id = ?').run(from_name.trim(), owned.id);
    }
  } else {
    const firstAddr = db.prepare(
      'SELECT id, address, display_name FROM email_addresses WHERE user_id = ? ORDER BY created_at LIMIT 1'
    ).get(userId) as { id: number; address: string; display_name: string } | undefined;

    if (!firstAddr) {
      res.status(400).json({ error: "you need to claim an email address first." });
      return;
    }
    senderAddr = `${firstAddr.address}@${DOMAIN}`;
    senderName = from_name?.trim() || firstAddr.display_name;

    if (from_name?.trim() && from_name.trim() !== firstAddr.display_name) {
      db.prepare('UPDATE email_addresses SET display_name = ? WHERE id = ?').run(from_name.trim(), firstAddr.id);
    }
  }

  const messageId = `<${randomUUID()}@${DOMAIN}>`;
  const finalSubject = subject || '';
  const threadId = getThreadId(in_reply_to ?? null, messageId);

  // Easter egg: emailing yourself
  if (to.toLowerCase() === senderAddr.toLowerCase()) {
    const senderAddrRow = db.prepare(
      'SELECT id FROM email_addresses WHERE address = ? AND user_id = ?'
    ).get(senderAddr.split('@')[0]!, userId) as { id: number } | undefined;

    const inboxResult = db.prepare(`
      INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, is_read, message_id, in_reply_to, thread_id)
      VALUES (?, ?, 'inbox', ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(userId, senderAddrRow?.id ?? null, senderAddr, to, finalSubject, body, messageId, in_reply_to ?? null, threadId);

    if (files.length > 0) saveAttachments(Number(inboxResult.lastInsertRowid), files);

    const sentResult = db.prepare(`
      INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, is_read, message_id, in_reply_to, thread_id)
      VALUES (?, ?, 'sent', ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(userId, senderAddrRow?.id ?? null, senderAddr, to, finalSubject, body, messageId, in_reply_to ?? null, threadId);

    if (files.length > 0) cloneAttachments(Number(inboxResult.lastInsertRowid), Number(sentResult.lastInsertRowid));

    res.json({ ok: true, messageId, easter_egg: "emailing yourself? that's just a diary with extra steps." });
    return;
  }

  const toClean = to.toLowerCase().trim();
  const isInternal = toClean.endsWith(`@${DOMAIN}`);

  if (isInternal) {
    const recipientLocal = toClean.split('@')[0]!;
    const recipientAddr = db.prepare(
      'SELECT id, user_id FROM email_addresses WHERE address = ?'
    ).get(recipientLocal) as { id: number; user_id: number } | undefined;

    if (!recipientAddr) {
      res.status(404).json({ error: `${toClean} doesn't exist. check the address, genius.` });
      return;
    }

    const recipientResult = db.prepare(`
      INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, is_read, message_id, in_reply_to, thread_id)
      VALUES (?, ?, 'inbox', ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(recipientAddr.user_id, recipientAddr.id, senderAddr, toClean, finalSubject, body, messageId, in_reply_to ?? null, threadId);

    if (files.length > 0) saveAttachments(Number(recipientResult.lastInsertRowid), files);

    emitToUser(recipientAddr.user_id, 'mail:new', {
      from: senderAddr,
      subject: finalSubject || '(no subject, just vibes)',
      to: toClean,
    });

    const senderAddrRow = db.prepare(
      'SELECT id FROM email_addresses WHERE address = ?'
    ).get(senderAddr.split('@')[0]!) as { id: number } | undefined;

    const sentResult = db.prepare(`
      INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, is_read, message_id, in_reply_to, thread_id)
      VALUES (?, ?, 'sent', ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(userId, senderAddrRow?.id ?? null, senderAddr, toClean, finalSubject, body, messageId, in_reply_to ?? null, threadId);

    if (files.length > 0) cloneAttachments(Number(recipientResult.lastInsertRowid), Number(sentResult.lastInsertRowid));

    res.json({ ok: true, messageId });
  } else {
    // External delivery
    try {
      const recipientDomain = toClean.split('@')[1]!;
      const mxRecords = await resolveMx(recipientDomain);
      if (!mxRecords.length) {
        res.status(502).json({ error: `no MX records for ${recipientDomain}. that domain can't receive mail.` });
        return;
      }
      mxRecords.sort((a, b) => a.priority - b.priority);
      const mxHost = mxRecords[0]!.exchange;

      const transporter = createTransport({
        host: mxHost,
        port: 25,
        secure: false,
        name: `mail.${DOMAIN}`,
        tls: { rejectUnauthorized: false },
        ...(dkimOptions ? { dkim: dkimOptions } : {}),
      } as Parameters<typeof createTransport>[0]);

      // Build nodemailer attachments from uploaded files
      const mailAttachments = files.map(f => ({
        filename: f.originalname,
        content: f.buffer,
        contentType: f.mimetype,
      }));

      await transporter.sendMail({
        from: `${senderName} <${senderAddr}>`,
        to: toClean,
        subject: finalSubject || '(no subject)',
        text: body,
        messageId,
        ...(in_reply_to ? { inReplyTo: in_reply_to } : {}),
        attachments: mailAttachments.length > 0 ? mailAttachments : undefined,
        headers: {
          'X-Mailer': 'mynig.ga terminal mail',
        },
      });

      const senderAddrRow = db.prepare(
        'SELECT id FROM email_addresses WHERE address = ?'
      ).get(senderAddr.split('@')[0]!) as { id: number } | undefined;

      const sentResult = db.prepare(`
        INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, is_read, message_id, in_reply_to, thread_id)
        VALUES (?, ?, 'sent', ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(userId, senderAddrRow?.id ?? null, senderAddr, toClean, finalSubject, body, messageId, in_reply_to ?? null, threadId);

      if (files.length > 0) saveAttachments(Number(sentResult.lastInsertRowid), files);

      res.json({ ok: true, messageId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'delivery failed';
      res.status(502).json({ error: `couldn't deliver to ${toClean}: ${msg}` });
    }
  }
});

// ── GET /api/mail/attachments/:id ──
router.get('/attachments/:id', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const attId = parseInt(String(req.params['id']), 10);

  const row = db.prepare(`
    SELECT a.filename, a.mime_type, a.data, a.size
    FROM email_attachments a
    JOIN emails e ON e.id = a.email_id
    WHERE a.id = ? AND e.owner_id = ?
  `).get(attId, userId) as { filename: string; mime_type: string; data: Buffer; size: number } | undefined;

  if (!row) {
    res.status(404).json({ error: "attachment not found. it's gone, like your hopes and dreams." });
    return;
  }

  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
  res.setHeader('Content-Length', row.size);
  res.end(row.data);
});

// ── GET /api/mail/thread/:threadId ──
router.get('/thread/:threadId', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const threadId = req.params['threadId'] as string;

  const rows = db.prepare(`
    SELECT e.id, e.folder, e.from_address, e.to_address, e.subject, e.body, e.is_read, e.is_starred, e.message_id, e.in_reply_to, e.thread_id, e.created_at,
      (SELECT COUNT(*) FROM email_attachments WHERE email_id = e.id) as attachment_count
    FROM emails e
    WHERE e.owner_id = ? AND e.thread_id = ?
    ORDER BY e.created_at ASC
  `).all(userId, threadId) as {
    id: number; folder: string; from_address: string; to_address: string;
    subject: string; body: string; is_read: number; is_starred: number;
    message_id: string | null; in_reply_to: string | null; thread_id: string | null;
    created_at: string; attachment_count: number;
  }[];

  const messages = rows.map(r => ({
    ...r,
    subject: r.subject || '(no subject, just vibes)',
    is_read: !!r.is_read,
    is_starred: !!r.is_starred,
    attachments: db.prepare(
      'SELECT id, filename, mime_type, size FROM email_attachments WHERE email_id = ?'
    ).all(r.id) as { id: number; filename: string; mime_type: string; size: number }[],
  }));

  res.json({ messages });
});

// ── POST /api/mail/messages/bulk ──
router.post('/messages/bulk', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { ids, action } = req.body as { ids?: number[]; action?: string };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids required. what are you bulk-actioning, exactly?" });
    return;
  }

  if (!action || typeof action !== 'string') {
    res.status(400).json({ error: "action required: trash, read, unread, star, unstar, delete" });
    return;
  }

  const placeholders = ids.map(() => '?').join(',');
  const verifyQuery = `SELECT id FROM emails WHERE id IN (${placeholders}) AND owner_id = ?`;
  const valid = db.prepare(verifyQuery).all(...ids, userId) as { id: number }[];
  const validIds = new Set(valid.map(r => r.id));
  const filtered = ids.filter(id => validIds.has(id));

  if (filtered.length === 0) {
    res.status(404).json({ error: "none of those emails are yours." });
    return;
  }

  const filteredPlaceholders = filtered.map(() => '?').join(',');

  switch (action) {
    case 'trash':
      db.prepare(`UPDATE emails SET folder = 'trash' WHERE id IN (${filteredPlaceholders})`).run(...filtered);
      break;
    case 'read':
      db.prepare(`UPDATE emails SET is_read = 1 WHERE id IN (${filteredPlaceholders})`).run(...filtered);
      break;
    case 'unread':
      db.prepare(`UPDATE emails SET is_read = 0 WHERE id IN (${filteredPlaceholders})`).run(...filtered);
      break;
    case 'star':
      db.prepare(`UPDATE emails SET is_starred = 1 WHERE id IN (${filteredPlaceholders})`).run(...filtered);
      break;
    case 'unstar':
      db.prepare(`UPDATE emails SET is_starred = 0 WHERE id IN (${filteredPlaceholders})`).run(...filtered);
      break;
    case 'delete':
      db.prepare(`DELETE FROM email_attachments WHERE email_id IN (${filteredPlaceholders})`).run(...filtered);
      db.prepare(`DELETE FROM emails WHERE id IN (${filteredPlaceholders})`).run(...filtered);
      break;
    default:
      res.status(400).json({ error: `unknown action "${action}". try: trash, read, unread, star, unstar, delete` });
      return;
  }

  res.json({ ok: true, affected: filtered.length });
});

// ── POST /api/mail/drafts ──
router.post('/drafts', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { to, subject, body, from_address } = req.body as { to?: string; subject?: string; body?: string; from_address?: string };

  const result = db.prepare(`
    INSERT INTO emails (owner_id, folder, from_address, to_address, subject, body, is_read, message_id)
    VALUES (?, 'drafts', ?, ?, ?, ?, 1, NULL)
  `).run(userId, from_address ?? '', to ?? '', subject ?? '', body ?? '');

  res.json({ ok: true, id: result.lastInsertRowid });
});

// ── PUT /api/mail/drafts/:id ──
router.put('/drafts/:id', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const draftId = parseInt(String(req.params['id']), 10);

  const existing = db.prepare(
    "SELECT id FROM emails WHERE id = ? AND owner_id = ? AND folder = 'drafts'"
  ).get(draftId, userId);

  if (!existing) {
    res.status(404).json({ error: "draft not found." });
    return;
  }

  const { to, subject, body, from_address } = req.body as { to?: string; subject?: string; body?: string; from_address?: string };

  db.prepare(`
    UPDATE emails SET to_address = ?, subject = ?, body = ?, from_address = ?
    WHERE id = ?
  `).run(to ?? '', subject ?? '', body ?? '', from_address ?? '', draftId);

  res.json({ ok: true });
});

// ── GET /api/mail/stats ──
router.get('/stats', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const folders = ['inbox', 'sent', 'trash', 'drafts'] as const;
  const stats: Record<string, { total: number; unread: number }> = {};

  for (const folder of folders) {
    const row = db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM emails WHERE owner_id = ? AND folder = ?
    `).get(userId, folder) as { total: number; unread: number };
    stats[folder] = { total: row.total, unread: row.unread ?? 0 };
  }

  // Starred count
  const starredRow = db.prepare(`
    SELECT COUNT(*) as total FROM emails WHERE owner_id = ? AND is_starred = 1
  `).get(userId) as { total: number };
  stats["starred"] = { total: starredRow.total, unread: 0 };

  // Custom folder counts
  const customFolders = db.prepare('SELECT name FROM mail_folders WHERE user_id = ?').all(userId) as { name: string }[];
  for (const cf of customFolders) {
    const cfRow = db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM emails WHERE owner_id = ? AND folder = ?
    `).get(userId, cf.name) as { total: number; unread: number };
    stats[cf.name] = { total: cfRow.total, unread: cfRow.unread ?? 0 };
  }

  res.json({ stats });
});

// ══════════════════════════════════════════════════
// ── Admin Mail Routes ──
// ══════════════════════════════════════════════════

// ── GET /api/mail/admin/addresses ──
router.get('/admin/addresses', adminMiddleware, (_req: AuthRequest, res: Response): void => {
  const rows = db.prepare(`
    SELECT ea.id, ea.address, ea.user_id, ea.created_at, u.username,
      (SELECT COUNT(*) FROM emails WHERE address_id = ea.id) as email_count
    FROM email_addresses ea
    JOIN users u ON u.id = ea.user_id
    ORDER BY ea.created_at DESC
  `).all() as { id: number; address: string; user_id: number; created_at: string; username: string; email_count: number }[];

  res.json({
    addresses: rows.map(r => ({
      ...r,
      full: `${r.address}@${DOMAIN}`,
    })),
  });
});

// ── DELETE /api/mail/admin/addresses/:id ──
router.delete('/admin/addresses/:id', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const addrId = parseInt(String(req.params['id']), 10);

  const addr = db.prepare('SELECT id, address FROM email_addresses WHERE id = ?').get(addrId) as { id: number; address: string } | undefined;
  if (!addr) {
    res.status(404).json({ error: "address not found." });
    return;
  }

  db.prepare('DELETE FROM emails WHERE address_id = ?').run(addrId);
  db.prepare('DELETE FROM email_addresses WHERE id = ?').run(addrId);

  res.json({ ok: true, deleted: addr.address });
});

// ── GET /api/mail/admin/emails ──
router.get('/admin/emails', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const userId = req.query['user_id'] ? parseInt(req.query['user_id'] as string, 10) : null;
  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 200);
  const offset = parseInt(req.query['offset'] as string) || 0;

  let query = `
    SELECT e.id, e.owner_id, e.address_id, e.folder, e.from_address, e.to_address,
      e.subject, e.is_read, e.created_at, u.username
    FROM emails e
    JOIN users u ON u.id = e.owner_id
  `;
  const params: (number | string)[] = [];

  if (userId) {
    query += ' WHERE e.owner_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as {
    id: number; owner_id: number; address_id: number | null; folder: string;
    from_address: string; to_address: string; subject: string;
    is_read: number; created_at: string; username: string;
  }[];

  res.json({
    emails: rows.map(r => ({
      ...r,
      subject: r.subject || '(no subject, just vibes)',
      is_read: !!r.is_read,
    })),
  });
});

// ── GET /api/mail/admin/emails/:id ──
router.get('/admin/emails/:id', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const msgId = parseInt(String(req.params['id']), 10);

  const row = db.prepare(`
    SELECT e.*, u.username
    FROM emails e
    JOIN users u ON u.id = e.owner_id
    WHERE e.id = ?
  `).get(msgId) as {
    id: number; owner_id: number; address_id: number | null; folder: string;
    from_address: string; to_address: string; subject: string; body: string;
    is_read: number; message_id: string | null; in_reply_to: string | null;
    created_at: string; username: string;
  } | undefined;

  if (!row) {
    res.status(404).json({ error: "email not found." });
    return;
  }

  res.json({
    email: {
      ...row,
      subject: row.subject || '(no subject, just vibes)',
      is_read: !!row.is_read,
    },
  });
});

// ── DELETE /api/mail/admin/emails/:id ──
router.delete('/admin/emails/:id', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const msgId = parseInt(String(req.params['id']), 10);

  const existing = db.prepare('SELECT id FROM emails WHERE id = ?').get(msgId);
  if (!existing) {
    res.status(404).json({ error: "email not found." });
    return;
  }

  db.prepare('DELETE FROM emails WHERE id = ?').run(msgId);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════
// ── Contacts ──
// ══════════════════════════════════════════════════

router.get('/contacts', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const rows = db.prepare('SELECT id, name, address, created_at FROM contacts WHERE user_id = ? ORDER BY name').all(userId);
  res.json({ contacts: rows });
});

router.get('/contacts/suggest', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const q = (req.query['q'] as string)?.trim() || '';
  if (!q) { res.json({ suggestions: [] }); return; }
  const like = `%${q}%`;
  const rows = db.prepare(
    'SELECT id, name, address FROM contacts WHERE user_id = ? AND (name LIKE ? OR address LIKE ?) LIMIT 10'
  ).all(userId, like, like) as { id: number; name: string; address: string }[];
  res.json({ suggestions: rows });
});

router.post('/contacts', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { name, address } = req.body as { name?: string; address?: string };
  if (!address) { res.status(400).json({ error: 'address required.' }); return; }
  const result = db.prepare('INSERT INTO contacts (user_id, name, address) VALUES (?, ?, ?)').run(userId, name ?? '', address);
  res.json({ contact: { id: result.lastInsertRowid, name: name ?? '', address, created_at: new Date().toISOString() } });
});

router.delete('/contacts/:id', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const contactId = parseInt(String(req.params['id']), 10);
  const existing = db.prepare('SELECT id FROM contacts WHERE id = ? AND user_id = ?').get(contactId, userId);
  if (!existing) { res.status(404).json({ error: 'contact not found.' }); return; }
  db.prepare('DELETE FROM contacts WHERE id = ?').run(contactId);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════
// ── Custom Mail Folders ──
// ══════════════════════════════════════════════════

router.get('/folders', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const rows = db.prepare('SELECT id, name, created_at FROM mail_folders WHERE user_id = ? ORDER BY name').all(userId);
  res.json({ folders: rows });
});

router.post('/folders', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'folder name required.' });
    return;
  }
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (clean.length < 1 || clean.length > 32) {
    res.status(400).json({ error: 'folder name: 1-32 chars, alphanumeric.' });
    return;
  }
  const reserved = ['inbox', 'sent', 'trash', 'drafts', 'starred'];
  if (reserved.includes(clean)) {
    res.status(400).json({ error: `"${clean}" is a system folder. be more creative.` });
    return;
  }
  try {
    const result = db.prepare('INSERT INTO mail_folders (user_id, name) VALUES (?, ?)').run(userId, clean);
    res.json({ folder: { id: result.lastInsertRowid, name: clean } });
  } catch {
    res.status(409).json({ error: 'folder already exists.' });
  }
});

router.delete('/folders/:id', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const folderId = parseInt(String(req.params['id']), 10);
  const folder = db.prepare('SELECT id, name FROM mail_folders WHERE id = ? AND user_id = ?').get(folderId, userId) as { id: number; name: string } | undefined;
  if (!folder) { res.status(404).json({ error: 'folder not found.' }); return; }
  // Move emails back to inbox
  db.prepare('UPDATE emails SET folder = ? WHERE owner_id = ? AND folder = ?').run('inbox', userId, folder.name);
  db.prepare('DELETE FROM mail_folders WHERE id = ?').run(folderId);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════
// ── Signatures ──
// ══════════════════════════════════════════════════

router.put('/addresses/:id/signature', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const addrId = parseInt(String(req.params['id']), 10);
  const { signature } = req.body as { signature?: string };

  const addr = db.prepare('SELECT id FROM email_addresses WHERE id = ? AND user_id = ?').get(addrId, userId);
  if (!addr) { res.status(404).json({ error: 'address not found.' }); return; }

  db.prepare('UPDATE email_addresses SET signature = ? WHERE id = ?').run(signature ?? '', addrId);
  res.json({ ok: true });
});

export default router;
