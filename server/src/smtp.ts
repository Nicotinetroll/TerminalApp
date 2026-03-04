/**
 * Standalone SMTP receiver — runs as a separate PM2 process
 * Listens on port 25, receives inbound email, stores in SQLite
 */

import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOMAIN = 'mynig.ga';
const PORT = 25;
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

// Clean up rate limit map every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipCounts.entries()) {
    if (now > entry.resetAt) ipCounts.delete(ip);
  }
}, 3600_000);

// Connect to the same database
const dataDir = resolve(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });
const dbPath = resolve(dataDir, 'mynigga.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Lookup address in DB
function lookupAddress(localPart: string): { id: number; user_id: number } | undefined {
  return db.prepare(
    'SELECT id, user_id FROM email_addresses WHERE address = ?'
  ).get(localPart) as { id: number; user_id: number } | undefined;
}

const server = new SMTPServer({
  name: `mail.${DOMAIN}`,
  banner: `mynig.ga SMTP — welcome to the void`,
  size: MAX_SIZE,
  authOptional: true,
  disabledCommands: ['AUTH'],
  allowInsecureAuth: true,

  // Validate RCPT TO — only accept if we have the address
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

    // Rate limit by source IP
    const ip = session.remoteAddress;
    if (!checkIpRate(ip)) {
      return callback(new Error(`421 Too many messages from your IP. Chill.`));
    }

    callback();
  },

  // Process incoming mail
  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    let size = 0;

    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_SIZE) {
        chunks.push(chunk);
      }
    });

    stream.on('end', async () => {
      if (size > MAX_SIZE) {
        return callback(new Error('552 Message too large'));
      }

      try {
        const raw = Buffer.concat(chunks);
        const parsed = await simpleParser(raw);

        const from = parsed.from?.text ?? 'unknown@unknown';
        const subject = parsed.subject ?? '';
        const body = parsed.text ?? parsed.html ?? '';
        const messageId = parsed.messageId ?? null;
        const inReplyTo = parsed.inReplyTo ?? null;

        // Compute thread_id
        let threadId = messageId ?? `<${Date.now()}@incoming>`;
        if (inReplyTo) {
          const parent = db.prepare('SELECT thread_id FROM emails WHERE message_id = ? LIMIT 1').get(inReplyTo) as { thread_id: string | null } | undefined;
          if (parent?.thread_id) threadId = parent.thread_id;
        }

        // Extract attachments
        const attachments = parsed.attachments ?? [];

        // Deliver to each recipient
        const recipients = session.envelope.rcptTo;
        const insertStmt = db.prepare(`
          INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, is_read, message_id, in_reply_to, thread_id)
          VALUES (?, ?, 'inbox', ?, ?, ?, ?, 0, ?, ?, ?)
        `);

        const insertAttStmt = db.prepare(
          'INSERT INTO email_attachments (email_id, filename, mime_type, size, data) VALUES (?, ?, ?, ?, ?)'
        );

        for (const rcpt of recipients) {
          const email = rcpt.address.toLowerCase();
          const localPart = email.split('@')[0]!;
          const addr = lookupAddress(localPart);
          if (addr) {
            const result = insertStmt.run(
              addr.user_id, addr.id, from, email,
              subject, body, messageId, inReplyTo, threadId
            );

            // Save attachments
            const emailDbId = Number(result.lastInsertRowid);
            for (const att of attachments) {
              if (att.content && att.size <= 5 * 1024 * 1024) { // 5MB limit
                insertAttStmt.run(emailDbId, att.filename ?? 'attachment', att.contentType ?? 'application/octet-stream', att.size, att.content);
              }
            }

            console.log(`[SMTP] Delivered: ${from} -> ${email} | "${subject}" (${attachments.length} attachments)`);

            // Notify the API server to push socket event
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
        console.error('[SMTP] Parse error:', err);
        callback(new Error('451 Error processing message'));
      }
    });
  },

  // Log connections
  onConnect(session, callback) {
    console.log(`[SMTP] Connection from ${session.remoteAddress}`);
    callback();
  },
});

server.on('error', (err) => {
  console.error('[SMTP] Server error:', err);
});

server.listen(PORT, () => {
  console.log(`[SMTP] mynig.ga mail receiver listening on port ${PORT}`);
});
