/**
 * Standalone SMTP server — runs as a separate PM2 process
 * Port 25:  inbound receiver (no auth, accepts mail for @mynig.ga)
 * Port 465: submission (requires auth + TLS, relays outgoing mail)
 */

import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { createTransport } from 'nodemailer';
import { resolveMx } from 'dns/promises';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOMAIN = 'mynig.ga';
const INBOUND_PORT = 25;
const SUBMISSION_PORT = 465;
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// Rate limiting: 50 msgs/hour per source IP
const ipCounts = new Map<string, { count: number; resetAt: number }>();
const IP_RATE_LIMIT = 50;

function checkIpRate(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (entry.count >= IP_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipCounts.entries()) {
    if (now > entry.resetAt) ipCounts.delete(ip);
  }
}, 3600_000);

// ── Database ──
const dataDir = resolve(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });
const dbPath = resolve(dataDir, 'mynigga.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ── DKIM ──
const dkimKeyPath = resolve(dataDir, 'dkim-private.pem');
let dkimOptions: object | undefined;
if (existsSync(dkimKeyPath)) {
  try {
    const privateKey = readFileSync(dkimKeyPath, 'utf-8');
    dkimOptions = { domainName: DOMAIN, keySelector: 'mail', privateKey };
  } catch { /* no dkim */ }
}

// ── TLS (Let's Encrypt) ──
const certPath = '/etc/letsencrypt/live/mail.mynig.ga/fullchain.pem';
const keyPath = '/etc/letsencrypt/live/mail.mynig.ga/privkey.pem';
let tlsCert: { cert: Buffer; key: Buffer } | null = null;
if (existsSync(certPath) && existsSync(keyPath)) {
  tlsCert = { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}

// ── Logging ──
function slog(msg: string) {
  console.log(`[SMTP] ${msg}`);
  try {
    db.prepare('INSERT INTO service_logs (service, level, message) VALUES (?, ?, ?)').run('smtp', 'info', msg);
  } catch { /* table may not exist */ }
}

function slogError(msg: string) {
  console.error(`[SMTP] ${msg}`);
  try {
    db.prepare('INSERT INTO service_logs (service, level, message) VALUES (?, ?, ?)').run('smtp', 'error', msg);
  } catch { /* table may not exist */ }
}

// ── Helpers ──
function lookupAddress(localPart: string): { id: number; user_id: number } | undefined {
  return db.prepare(
    'SELECT id, user_id FROM email_addresses WHERE address = ?'
  ).get(localPart) as { id: number; user_id: number } | undefined;
}

function getThreadId(inReplyTo: string | null, messageId: string): string {
  if (inReplyTo) {
    const parent = db.prepare('SELECT thread_id FROM emails WHERE message_id = ? LIMIT 1').get(inReplyTo) as { thread_id: string | null } | undefined;
    if (parent?.thread_id) return parent.thread_id;
  }
  return messageId;
}

// ════════════════════════════════════════════
// PORT 25 — Inbound receiver (no auth)
// ════════════════════════════════════════════

const inboundServer = new SMTPServer({
  name: `mail.${DOMAIN}`,
  banner: `mynig.ga SMTP — welcome to the void`,
  size: MAX_SIZE,
  authOptional: true,
  disabledCommands: ['AUTH'],
  allowInsecureAuth: true,

  onRcptTo(address, session, callback) {
    const email = address.address.toLowerCase();
    if (!email.endsWith(`@${DOMAIN}`)) {
      return callback(new Error(`550 We don't relay for that domain`));
    }
    const localPart = email.split('@')[0]!;
    const found = lookupAddress(localPart);
    if (!found) {
      return callback(new Error(`550 User not found: ${email}`));
    }
    const ip = session.remoteAddress;
    if (!checkIpRate(ip)) {
      return callback(new Error(`421 Too many messages from your IP. Chill.`));
    }
    callback();
  },

  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    let size = 0;
    let callbackCalled = false;

    stream.on('error', (err) => {
      slogError(`inbound stream error: ${err}`);
      if (!callbackCalled) { callbackCalled = true; callback(new Error('451 Error reading message')); }
    });

    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_SIZE) chunks.push(chunk);
    });

    stream.on('end', async () => {
      if (callbackCalled) return;
      callbackCalled = true;
      if (size > MAX_SIZE) return callback(new Error('552 Message too large'));

      try {
        const raw = Buffer.concat(chunks);
        const parsed = await simpleParser(raw);

        const from = parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? 'unknown@unknown';
        const subject = parsed.subject ?? '';
        const body = parsed.text ?? parsed.html ?? '';
        const bodyHtml = parsed.html ?? null;
        const messageId = parsed.messageId ?? null;
        const inReplyTo = Array.isArray(parsed.inReplyTo) ? parsed.inReplyTo[0] ?? null : parsed.inReplyTo ?? null;
        const threadId = getThreadId(inReplyTo, messageId ?? `<${Date.now()}@incoming>`);
        const attachments = parsed.attachments ?? [];

        const insertStmt = db.prepare(
          `INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, body_html, is_read, message_id, in_reply_to, thread_id)
           VALUES (?, ?, 'inbox', ?, ?, ?, ?, ?, 0, ?, ?, ?)`
        );
        const insertAttStmt = db.prepare(
          'INSERT INTO email_attachments (email_id, filename, mime_type, size, data) VALUES (?, ?, ?, ?, ?)'
        );

        for (const rcpt of session.envelope.rcptTo) {
          const email = rcpt.address.toLowerCase();
          const localPart = email.split('@')[0]!;
          const addr = lookupAddress(localPart);
          if (addr) {
            const result = insertStmt.run(addr.user_id, addr.id, from, email, subject, body, bodyHtml, messageId, inReplyTo, threadId);
            const emailDbId = Number(result.lastInsertRowid);
            for (const att of attachments) {
              if (att.content && att.size <= 5 * 1024 * 1024) {
                insertAttStmt.run(emailDbId, att.filename ?? 'attachment', att.contentType ?? 'application/octet-stream', att.size, att.content);
              }
            }
            slog(`delivered: ${from} -> ${email} | "${subject}"`);

            try {
              fetch('http://localhost:3001/api/mail/internal/mail-notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: addr.user_id, from, subject, to: email }),
              }).catch(() => { /* best effort */ });
            } catch { /* best effort */ }
          }
        }
        callback();
      } catch (err) {
        slogError(`parse error: ${err}`);
        callback(new Error('451 Error processing message'));
      }
    });
  },

  onConnect(session, callback) {
    slog(`inbound connection from ${session.remoteAddress}`);
    callback();
  },
});

inboundServer.on('error', (err) => slogError(`inbound error: ${err}`));
inboundServer.listen(INBOUND_PORT, () => slog(`inbound listening on port ${INBOUND_PORT}`));

// ════════════════════════════════════════════
// PORT 465 — Submission (auth + TLS required)
// ════════════════════════════════════════════

if (!tlsCert) {
  slog('no TLS cert found — submission server (465) disabled');
} else {
  // Store authenticated user info on session
  interface AuthSession {
    user?: { userId: number; username: string; address: string };
  }

  const submissionServer = new SMTPServer({
    name: `mail.${DOMAIN}`,
    banner: `mynig.ga SMTP submission`,
    size: MAX_SIZE,
    secure: true, // implicit TLS on connect (port 465)
    key: tlsCert.key,
    cert: tlsCert.cert,
    authMethods: ['PLAIN', 'LOGIN'],
    allowInsecureAuth: false,

    // Authenticate with email address + mail_password
    onAuth(auth, _session, callback) {
      let loginAddr = (auth.username ?? '').toLowerCase().trim();
      const password = auth.password ?? '';

      // Strip @domain if present
      if (loginAddr.includes('@')) loginAddr = loginAddr.split('@')[0]!;

      const addr = db.prepare(
        'SELECT ea.id, ea.user_id, ea.address, ea.mail_password, u.username FROM email_addresses ea JOIN users u ON u.id = ea.user_id WHERE ea.address = ?'
      ).get(loginAddr) as { id: number; user_id: number; address: string; mail_password: string; username: string } | undefined;

      if (!addr || !addr.mail_password || !bcrypt.compareSync(password, addr.mail_password)) {
        slog(`auth failed: ${loginAddr}`);
        return callback(new Error('Invalid credentials'));
      }

      slog(`auth: ${addr.address}@${DOMAIN} (${addr.username})`);
      callback(null, {
        user: { userId: addr.user_id, username: addr.username, address: `${addr.address}@${DOMAIN}` },
      });
    },

    onMailFrom(address, session, callback) {
      // Must be authenticated
      const authSession = session as typeof session & AuthSession;
      if (!authSession.user) return callback(new Error('530 Authentication required'));
      callback();
    },

    onRcptTo(_address, session, callback) {
      const authSession = session as typeof session & AuthSession;
      if (!authSession.user) return callback(new Error('530 Authentication required'));
      callback();
    },

    onData(stream, session, callback) {
      const authSession = session as typeof session & AuthSession;
      if (!authSession.user) return callback(new Error('530 Authentication required'));

      const chunks: Buffer[] = [];
      let size = 0;
      let callbackCalled = false;

      stream.on('error', (err) => {
        slogError(`submission stream error: ${err}`);
        if (!callbackCalled) { callbackCalled = true; callback(new Error('451 Error reading message')); }
      });

      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= MAX_SIZE) chunks.push(chunk);
      });

      stream.on('end', async () => {
        if (callbackCalled) return;
        callbackCalled = true;
        if (size > MAX_SIZE) return callback(new Error('552 Message too large'));

        try {
          const raw = Buffer.concat(chunks);
          const parsed = await simpleParser(raw);

          const from = authSession.user!.address;
          const subject = parsed.subject ?? '';
          const textBody = parsed.text ?? '';
          const htmlBody = parsed.html ?? '';
          const body = textBody || htmlBody;
          const originalMessageId = parsed.messageId ?? null;
          // Always generate our own Message-ID — Gmail sets @mail.gmail.com which
          // mismatches our domain and triggers spam filters
          const messageId = `<${randomUUID()}@${DOMAIN}>`;
          const inReplyTo = Array.isArray(parsed.inReplyTo) ? parsed.inReplyTo[0] ?? null : parsed.inReplyTo ?? null;
          const threadId = getThreadId(inReplyTo, messageId);
          const userId = authSession.user!.userId;

          const attachments = parsed.attachments ?? [];

          for (const rcpt of session.envelope.rcptTo) {
            const toAddr = rcpt.address.toLowerCase();
            const isInternal = toAddr.endsWith(`@${DOMAIN}`);

            if (isInternal) {
              // Internal delivery
              const recipientLocal = toAddr.split('@')[0]!;
              const recipientAddr = lookupAddress(recipientLocal);
              if (recipientAddr) {
                const result = db.prepare(
                  `INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, body_html, is_read, message_id, in_reply_to, thread_id)
                   VALUES (?, ?, 'inbox', ?, ?, ?, ?, ?, 0, ?, ?, ?)`
                ).run(recipientAddr.user_id, recipientAddr.id, from, toAddr, subject, body, htmlBody || null, messageId, inReplyTo, threadId);

                const emailDbId = Number(result.lastInsertRowid);
                for (const att of attachments) {
                  if (att.content && att.size <= 5 * 1024 * 1024) {
                    db.prepare('INSERT INTO email_attachments (email_id, filename, mime_type, size, data) VALUES (?, ?, ?, ?, ?)')
                      .run(emailDbId, att.filename ?? 'attachment', att.contentType ?? 'application/octet-stream', att.size, att.content);
                  }
                }

                try {
                  fetch('http://localhost:3001/api/mail/internal/mail-notify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: recipientAddr.user_id, from, subject, to: toAddr }),
                  }).catch(() => {});
                } catch { /* best effort */ }
              }
            } else {
              // External delivery via MX
              try {
                const recipientDomain = toAddr.split('@')[1]!;
                const mxRecords = await resolveMx(recipientDomain);
                if (!mxRecords.length) {
                  slogError(`no MX for ${recipientDomain}`);
                  continue;
                }
                mxRecords.sort((a, b) => a.priority - b.priority);

                const transporter = createTransport({
                  host: mxRecords[0]!.exchange,
                  port: 25,
                  secure: false,
                  name: `mail.${DOMAIN}`,
                  tls: { rejectUnauthorized: false },
                  ...(dkimOptions ? { dkim: dkimOptions } : {}),
                } as Parameters<typeof createTransport>[0]);

                const mailAttachments = attachments.map(a => ({
                  filename: a.filename ?? 'attachment',
                  content: a.content,
                  contentType: a.contentType,
                }));

                await transporter.sendMail({
                  from: `${authSession.user!.username} <${from}>`,
                  to: toAddr,
                  subject: subject || '(no subject)',
                  text: textBody || undefined,
                  html: htmlBody || undefined,
                  messageId,
                  ...(inReplyTo ? { inReplyTo } : {}),
                  attachments: mailAttachments.length > 0 ? mailAttachments : undefined,
                  headers: { 'X-Mailer': `mynig.ga terminal mail` },
                });

                slog(`relayed: ${from} -> ${toAddr}`);
              } catch (err) {
                slogError(`relay failed ${from} -> ${toAddr}: ${err}`);
              }
            }

          }

          // Clean up drafts matching the original Gmail Message-ID
          // (Gmail APPENDs drafts with its own Message-ID as you compose)
          if (originalMessageId) {
            const deleted = db.prepare("DELETE FROM emails WHERE owner_id = ? AND folder = 'drafts' AND message_id = ?")
              .run(userId, originalMessageId);
            if (deleted.changes > 0) {
              slog(`cleaned ${deleted.changes} draft(s) for ${originalMessageId}`);
            }
          }

          // Don't save to Sent — IMAP clients (Gmail) handle Sent folder via APPEND
          const allTo = session.envelope.rcptTo.map(r => r.address.toLowerCase()).join(', ');
          slog(`submission: ${from} -> ${allTo}`);
          callback();
        } catch (err) {
          slogError(`submission error: ${err}`);
          callback(new Error('451 Error processing message'));
        }
      });
    },

    onConnect(session, callback) {
      slog(`submission connection from ${session.remoteAddress}`);
      callback();
    },
  });

  submissionServer.on('error', (err) => slogError(`submission error: ${err}`));
  submissionServer.listen(SUBMISSION_PORT, () => slog(`submission listening on port ${SUBMISSION_PORT} (TLS)`));
}

// ── Crash protection ──
process.on('uncaughtException', (err) => slogError(`UNCAUGHT: ${err.stack ?? err.message ?? err}`));
process.on('unhandledRejection', (err) => slogError(`UNHANDLED: ${err}`));
