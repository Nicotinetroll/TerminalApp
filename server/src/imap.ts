/**
 * Standalone IMAP server — runs as a separate PM2 process
 * Listens on port 993 (TLS) and 143 (plaintext/STARTTLS)
 * Reads from the same SQLite database as the API
 */

import { createServer as createTlsServer } from 'tls';
import { createServer as createTcpServer } from 'net';
import type { Socket } from 'net';
import type { TLSSocket } from 'tls';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { simpleParser } from 'mailparser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOMAIN = 'mynig.ga';
const IMAPS_PORT = 993;
const IMAP_PORT = 143;

// ── Database ──
const dataDir = resolve(__dirname, '..', 'data');
const dbPath = resolve(dataDir, 'mynigga.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Logging ──
const logStmt = db.prepare('INSERT INTO service_logs (service, level, message) VALUES (?, ?, ?)');

function ilog(level: string, msg: string) {
  console.log(`[IMAP] ${msg}`);
  try { logStmt.run('imap', level, msg); } catch { /* db not ready yet */ }
}

// Cleanup old logs on startup
try {
  const cnt = (db.prepare('SELECT COUNT(*) as cnt FROM service_logs').get() as { cnt: number }).cnt;
  if (cnt > 1000) {
    db.prepare('DELETE FROM service_logs WHERE id NOT IN (SELECT id FROM service_logs ORDER BY id DESC LIMIT 1000)').run();
  }
} catch { /* table may not exist yet */ }

// ── TLS (Let's Encrypt) ──
const certPath = '/etc/letsencrypt/live/mail.mynig.ga/fullchain.pem';
const keyPath = '/etc/letsencrypt/live/mail.mynig.ga/privkey.pem';

let tlsOptions: { cert: Buffer; key: Buffer } | null = null;
if (existsSync(certPath) && existsSync(keyPath)) {
  tlsOptions = {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  };
}

// ── Types ──
interface ImapSession {
  socket: Socket | TLSSocket;
  authenticated: boolean;
  userId: number;
  username: string;
  selectedMailbox: string | null;
  selectedReadonly: boolean;
  buffer: string;
  idling: boolean;
  idleTag: string | null;
  idleExistCount: number;
  deletedIds: Set<number>;
  // Literal consumption (for APPEND etc.)
  literalRemaining: number;
  literalTag: string | null;
  literalFolder: string | null;
  literalFlags: string[];
  literalData: string;
}

interface DbEmail {
  id: number;
  folder: string;
  from_address: string;
  to_address: string;
  subject: string;
  body: string;
  is_read: number;
  is_starred: number;
  message_id: string | null;
  in_reply_to: string | null;
  created_at: string;
}

// ── Folder mapping ──
const SPECIAL_USE: Record<string, string> = {
  'inbox': '\\Inbox',
  'sent': '\\Sent',
  'trash': '\\Trash',
  'drafts': '\\Drafts',
};

function dbFolderToImap(folder: string): string {
  if (folder === 'inbox') return 'INBOX';
  return folder.charAt(0).toUpperCase() + folder.slice(1);
}

function imapFolderToDb(folder: string): string {
  if (folder.toUpperCase() === 'INBOX') return 'inbox';
  return folder.toLowerCase();
}

// ── Get emails for a mailbox ──
function getMailboxEmails(userId: number, folder: string): DbEmail[] {
  return db.prepare(
    'SELECT id, folder, from_address, to_address, subject, body, is_read, is_starred, message_id, in_reply_to, created_at FROM emails WHERE owner_id = ? AND folder = ? ORDER BY created_at ASC'
  ).all(userId, folder) as DbEmail[];
}

function getMailboxStats(userId: number, folder: string): { exists: number; recent: number; unseen: number; firstUnseen: number | null; uidnext: number; uidvalidity: number } {
  const exists = (db.prepare('SELECT COUNT(*) as cnt FROM emails WHERE owner_id = ? AND folder = ?').get(userId, folder) as { cnt: number }).cnt;
  const unseen = (db.prepare('SELECT COUNT(*) as cnt FROM emails WHERE owner_id = ? AND folder = ? AND is_read = 0').get(userId, folder) as { cnt: number }).cnt;
  const maxId = (db.prepare('SELECT MAX(id) as m FROM emails WHERE owner_id = ? AND folder = ?').get(userId, folder) as { m: number | null }).m ?? 0;

  // First unseen = sequence number (1-based position) of first unread message
  let firstUnseen: number | null = null;
  if (unseen > 0) {
    const rows = db.prepare('SELECT is_read FROM emails WHERE owner_id = ? AND folder = ? ORDER BY created_at ASC').all(userId, folder) as { is_read: number }[];
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i]!.is_read) { firstUnseen = i + 1; break; }
    }
  }

  return {
    exists,
    recent: 0,
    unseen,
    firstUnseen,
    uidnext: maxId + 1,
    uidvalidity: 1, // constant for simplicity
  };
}

// ── Build RFC 2822 message from DB row ──
function buildRfc2822(email: DbEmail): string {
  const date = new Date(email.created_at + 'Z').toUTCString();
  const lines: string[] = [];
  lines.push(`From: ${email.from_address}`);
  lines.push(`To: ${email.to_address}`);
  lines.push(`Subject: ${email.subject || '(no subject)'}`);
  lines.push(`Date: ${date}`);
  if (email.message_id) lines.push(`Message-ID: ${email.message_id}`);
  if (email.in_reply_to) lines.push(`In-Reply-To: ${email.in_reply_to}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('');
  lines.push(email.body || '');
  return lines.join('\r\n');
}

// ── Parse IMAP flags from DB ──
function getFlags(email: DbEmail, deletedIds?: Set<number>): string[] {
  const flags: string[] = [];
  if (email.is_read) flags.push('\\Seen');
  if (email.is_starred) flags.push('\\Flagged');
  if (email.folder === 'drafts') flags.push('\\Draft');
  if (deletedIds?.has(email.id)) flags.push('\\Deleted');
  return flags;
}

// ── IMAP response helpers ──
function send(session: ImapSession, line: string) {
  try {
    session.socket.write(line + '\r\n');
  } catch (err) {
    ilog('error', `send failed: ${err}`);
  }
}

// ── IMAP command handlers ──

function handleCapability(session: ImapSession, tag: string) {
  send(session, '* CAPABILITY IMAP4rev1 IDLE NAMESPACE ID UIDPLUS CHILDREN SPECIAL-USE UNSELECT');
  send(session, `${tag} OK CAPABILITY completed`);
}

function handleLogin(session: ImapSession, tag: string, args: string) {
  const parts = parseQuotedArgs(args);
  if (parts.length < 2) {
    send(session, `${tag} BAD missing username or password`);
    return;
  }

  let loginAddr = parts[0]!;
  const password = parts[1]!;

  // Strip @domain if provided (e.g. "bob@mynig.ga" → "bob")
  if (loginAddr.includes('@')) {
    loginAddr = loginAddr.split('@')[0]!;
  }

  // Look up email address and its mail_password
  const addr = db.prepare(
    'SELECT ea.id, ea.user_id, ea.address, ea.mail_password, u.username FROM email_addresses ea JOIN users u ON u.id = ea.user_id WHERE ea.address = ?'
  ).get(loginAddr) as { id: number; user_id: number; address: string; mail_password: string; username: string } | undefined;

  if (!addr || !addr.mail_password || !bcrypt.compareSync(password, addr.mail_password)) {
    ilog('warn', `login failed: ${loginAddr} from ${session.socket.remoteAddress ?? '?'}`);
    send(session, `${tag} NO invalid credentials`);
    return;
  }

  session.authenticated = true;
  session.userId = addr.user_id;
  session.username = addr.username;
  ilog('info', `login: ${addr.address}@${DOMAIN} (${addr.username})`);
  send(session, `${tag} OK welcome ${addr.address}@${DOMAIN}`);
}

function handleList(session: ImapSession, tag: string, args: string) {
  if (!session.authenticated) { send(session, `${tag} NO not authenticated`); return; }

  const parts = parseQuotedArgs(args);
  const refName = parts[0] ?? '';
  const pattern = parts[1] ?? '*';

  if (pattern === '' || (refName === '' && pattern === '')) {
    // Return hierarchy delimiter
    send(session, '* LIST (\\Noselect) "/" ""');
    send(session, `${tag} OK LIST completed`);
    return;
  }

  // System folders
  const folders = ['inbox', 'sent', 'drafts', 'trash'];

  // Custom folders
  const custom = db.prepare('SELECT name FROM mail_folders WHERE user_id = ?').all(session.userId) as { name: string }[];
  for (const f of custom) {
    folders.push(f.name);
  }

  for (const f of folders) {
    const imapName = dbFolderToImap(f);
    const specialUse = SPECIAL_USE[f];
    const attrs = specialUse ? `${specialUse} \\HasNoChildren` : '\\HasNoChildren';
    send(session, `* LIST (${attrs}) "/" "${imapName}"`);
  }
  send(session, `${tag} OK LIST completed`);
}

function handleLsub(session: ImapSession, tag: string, _args: string) {
  if (!session.authenticated) { send(session, `${tag} NO not authenticated`); return; }

  const folders = ['inbox', 'sent', 'drafts', 'trash'];
  const custom = db.prepare('SELECT name FROM mail_folders WHERE user_id = ?').all(session.userId) as { name: string }[];
  for (const f of custom) folders.push(f.name);

  for (const f of folders) {
    const imapName = dbFolderToImap(f);
    send(session, `* LSUB () "/" "${imapName}"`);
  }
  send(session, `${tag} OK LSUB completed`);
}

function handleSelect(session: ImapSession, tag: string, args: string, readonly: boolean) {
  if (!session.authenticated) { send(session, `${tag} NO not authenticated`); return; }

  const parts = parseQuotedArgs(args);
  const mailbox = parts[0] ?? '';
  const dbFolder = imapFolderToDb(mailbox);

  const stats = getMailboxStats(session.userId, dbFolder);

  session.selectedMailbox = dbFolder;
  session.selectedReadonly = readonly;

  send(session, `* ${stats.exists} EXISTS`);
  send(session, `* ${stats.recent} RECENT`);
  if (stats.firstUnseen !== null) {
    send(session, `* OK [UNSEEN ${stats.firstUnseen}]`);
  }
  send(session, `* OK [UIDVALIDITY ${stats.uidvalidity}]`);
  send(session, `* OK [UIDNEXT ${stats.uidnext}]`);
  send(session, '* FLAGS (\\Seen \\Answered \\Flagged \\Deleted \\Draft)');
  send(session, '* OK [PERMANENTFLAGS (\\Seen \\Flagged \\Deleted)]');

  const verb = readonly ? 'EXAMINE' : 'SELECT';
  send(session, `${tag} OK [READ-${readonly ? 'ONLY' : 'WRITE'}] ${verb} completed`);
}

function handleFetch(session: ImapSession, tag: string, args: string, useUid: boolean) {
  if (!session.authenticated || !session.selectedMailbox) {
    send(session, `${tag} NO no mailbox selected`);
    return;
  }

  // Parse sequence set and data items
  const spaceIdx = args.indexOf(' ');
  if (spaceIdx === -1) { send(session, `${tag} BAD invalid FETCH`); return; }

  const seqStr = args.substring(0, spaceIdx);
  let dataItems = args.substring(spaceIdx + 1).trim().toUpperCase();

  // Expand FETCH macros (RFC 3501 Section 6.4.5)
  if (dataItems === 'ALL') dataItems = '(FLAGS INTERNALDATE RFC822.SIZE ENVELOPE)';
  else if (dataItems === 'FAST') dataItems = '(FLAGS INTERNALDATE RFC822.SIZE)';
  else if (dataItems === 'FULL') dataItems = '(FLAGS INTERNALDATE RFC822.SIZE ENVELOPE BODY)';

  const emails = getMailboxEmails(session.userId, session.selectedMailbox);
  if (emails.length === 0) {
    send(session, `${tag} OK FETCH completed`);
    return;
  }

  const indices = resolveSequenceSet(seqStr, emails, useUid);

  for (const idx of indices) {
    const email = emails[idx]!;
    const seqNum = idx + 1;
    const flags = getFlags(email, session.deletedIds).join(' ');
    const rfc = buildRfc2822(email);
    const rfcBytes = Buffer.byteLength(rfc, 'utf-8');

    const parts: string[] = [];

    // UID — always in UID FETCH, or when client explicitly requests it
    if (useUid || /\bUID\b/.test(dataItems)) {
      parts.push(`UID ${email.id}`);
    }

    if (/\bFLAGS\b/.test(dataItems)) {
      parts.push(`FLAGS (${flags})`);
    }

    if (/\bINTERNALDATE\b/.test(dataItems)) {
      const d = new Date(email.created_at + 'Z');
      parts.push(`INTERNALDATE "${formatImapDate(d)}"`);
    }

    if (/\bRFC822\.SIZE\b/.test(dataItems) || /\bENVELOPE\b/.test(dataItems)) {
      parts.push(`RFC822.SIZE ${rfcBytes}`);
    }

    if (/\bENVELOPE\b/.test(dataItems)) {
      const env = buildEnvelope(email);
      parts.push(`ENVELOPE ${env}`);
    }

    // BODY[] or BODY[HEADER] or BODY.PEEK[] or RFC822 or RFC822.HEADER
    const wantsFullBody = dataItems.includes('BODY[]') || dataItems.includes('BODY.PEEK[]') || dataItems === 'RFC822' || dataItems.includes('(RFC822)');
    const wantsHeaders = dataItems.includes('BODY[HEADER') || dataItems.includes('BODY.PEEK[HEADER') || dataItems.includes('RFC822.HEADER');
    const wantsText = dataItems.includes('BODY[TEXT]') || dataItems.includes('BODY.PEEK[TEXT]');

    if (wantsFullBody) {
      parts.push(`BODY[] {${rfcBytes}}\r\n${rfc}`);
      // Mark as seen unless PEEK
      if (!dataItems.includes('PEEK') && !email.is_read) {
        db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(email.id);
      }
    } else if (wantsHeaders) {
      const headerEnd = rfc.indexOf('\r\n\r\n');
      const headers = headerEnd !== -1 ? rfc.substring(0, headerEnd + 4) : rfc;
      const headerBytes = Buffer.byteLength(headers, 'utf-8');

      // Check for HEADER.FIELDS
      const fieldsMatch = dataItems.match(/BODY(?:\.PEEK)?\[HEADER\.FIELDS\s*\(([^)]+)\)\]/);
      if (fieldsMatch) {
        const requestedFields = fieldsMatch[1]!.split(/\s+/).map(f => f.toLowerCase());
        const headerLines = headers.split('\r\n');
        const filtered: string[] = [];
        let including = false;
        for (const line of headerLines) {
          if (line.length === 0) break; // end of headers
          // Continuation line (folded header) — starts with space or tab
          if (line[0] === ' ' || line[0] === '\t') {
            if (including) filtered.push(line);
            continue;
          }
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            const fieldName = line.substring(0, colonIdx).toLowerCase();
            including = requestedFields.includes(fieldName);
            if (including) filtered.push(line);
          } else {
            including = false;
          }
        }
        const filteredStr = filtered.join('\r\n') + '\r\n\r\n';
        const filteredBytes = Buffer.byteLength(filteredStr, 'utf-8');
        const fieldList = fieldsMatch[1]!;
        parts.push(`BODY[HEADER.FIELDS (${fieldList})] {${filteredBytes}}\r\n${filteredStr}`);
      } else {
        parts.push(`BODY[HEADER] {${headerBytes}}\r\n${headers}`);
      }
    } else if (wantsText) {
      const headerEnd = rfc.indexOf('\r\n\r\n');
      const text = headerEnd !== -1 ? rfc.substring(headerEnd + 4) : '';
      const textBytes = Buffer.byteLength(text, 'utf-8');
      parts.push(`BODY[TEXT] {${textBytes}}\r\n${text}`);
    }

    // BODY[n] or BODY.PEEK[n] — MIME part fetch
    if (!wantsFullBody && !wantsHeaders && !wantsText) {
      const partMatch = dataItems.match(/BODY(?:\.PEEK)?\[(\d+)(?:\.MIME)?\]/);
      if (partMatch) {
        const partNum = parseInt(partMatch[1]!, 10);
        if (partNum === 1) {
          const isMime = dataItems.includes('.MIME');
          if (isMime) {
            const mimeHeaders = 'Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n';
            const mimeBytes = Buffer.byteLength(mimeHeaders, 'utf-8');
            parts.push(`BODY[1.MIME] {${mimeBytes}}\r\n${mimeHeaders}`);
          } else {
            const bodyText = email.body || '';
            const bodyBytes = Buffer.byteLength(bodyText, 'utf-8');
            parts.push(`BODY[1] {${bodyBytes}}\r\n${bodyText}`);
          }
          // Mark as seen unless PEEK
          if (!dataItems.includes('PEEK') && !email.is_read) {
            db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(email.id);
          }
        }
      }
    }

    // BODYSTRUCTURE
    if (/\bBODYSTRUCTURE\b/.test(dataItems)) {
      const textBytes = Buffer.byteLength(email.body || '', 'utf-8');
      const lines = (email.body || '').split('\n').length;
      parts.push(`BODYSTRUCTURE ("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "8BIT" ${textBytes} ${lines} NIL NIL NIL NIL)`);
    }

    if (parts.length === 0) {
      // At minimum return UID and FLAGS
      if (!useUid) parts.push(`UID ${email.id}`);
      parts.push(`FLAGS (${flags})`);
    }

    send(session, `* ${seqNum} FETCH (${parts.join(' ')})`);
  }

  send(session, `${tag} OK ${useUid ? 'UID ' : ''}FETCH completed`);
}

function handleStore(session: ImapSession, tag: string, args: string, useUid: boolean) {
  if (!session.authenticated || !session.selectedMailbox) {
    send(session, `${tag} NO no mailbox selected`);
    return;
  }
  if (session.selectedReadonly) {
    send(session, `${tag} NO mailbox is read-only`);
    return;
  }

  // Parse: sequence FLAGS (flag1 flag2)
  const match = args.match(/^(\S+)\s+([+-]?FLAGS(?:\.SILENT)?)\s+\(([^)]*)\)/i);
  if (!match) { send(session, `${tag} BAD invalid STORE`); return; }

  const seqStr = match[1]!;
  const action = match[2]!.toUpperCase();
  const flagStr = match[3]!.toUpperCase();
  const silent = action.includes('.SILENT');

  const emails = getMailboxEmails(session.userId, session.selectedMailbox);
  const indices = resolveSequenceSet(seqStr, emails, useUid);

  for (const idx of indices) {
    const email = emails[idx]!;
    const seqNum = idx + 1;

    if (action.startsWith('+')) {
      // Add flags
      if (flagStr.includes('\\SEEN')) db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(email.id);
      if (flagStr.includes('\\FLAGGED')) db.prepare('UPDATE emails SET is_starred = 1 WHERE id = ?').run(email.id);
      if (flagStr.includes('\\DELETED')) session.deletedIds.add(email.id);
    } else if (action.startsWith('-')) {
      // Remove flags
      if (flagStr.includes('\\SEEN')) db.prepare('UPDATE emails SET is_read = 0 WHERE id = ?').run(email.id);
      if (flagStr.includes('\\FLAGGED')) db.prepare('UPDATE emails SET is_starred = 0 WHERE id = ?').run(email.id);
      if (flagStr.includes('\\DELETED')) session.deletedIds.delete(email.id);
    } else {
      // Replace flags
      const seen = flagStr.includes('\\SEEN') ? 1 : 0;
      const starred = flagStr.includes('\\FLAGGED') ? 1 : 0;
      db.prepare('UPDATE emails SET is_read = ?, is_starred = ? WHERE id = ?').run(seen, starred, email.id);
      if (flagStr.includes('\\DELETED')) {
        session.deletedIds.add(email.id);
      } else {
        session.deletedIds.delete(email.id);
      }
    }

    if (!silent) {
      // Re-read flags
      const updated = db.prepare('SELECT id, is_read, is_starred, folder FROM emails WHERE id = ?').get(email.id) as DbEmail | undefined;
      if (updated) {
        const newFlags = getFlags(updated, session.deletedIds);
        send(session, `* ${seqNum} FETCH (FLAGS (${newFlags.join(' ')})${useUid ? ` UID ${email.id}` : ''})`);
      }
    }
  }

  send(session, `${tag} OK ${useUid ? 'UID ' : ''}STORE completed`);
}

function handleSearch(session: ImapSession, tag: string, args: string, useUid: boolean) {
  if (!session.authenticated || !session.selectedMailbox) {
    send(session, `${tag} NO no mailbox selected`);
    return;
  }

  const tokens = args.toUpperCase().trim().split(/\s+/);
  const emails = getMailboxEmails(session.userId, session.selectedMailbox);
  const results: number[] = [];

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i]!;
    let match = true;

    if (tokens.includes('UNSEEN') && email.is_read) match = false;
    if (tokens.includes('SEEN') && !email.is_read) match = false;
    if (tokens.includes('FLAGGED') && !email.is_starred) match = false;
    if (tokens.includes('UNFLAGGED') && email.is_starred) match = false;

    if (match) {
      results.push(useUid ? email.id : i + 1);
    }
  }

  send(session, results.length > 0 ? `* SEARCH ${results.join(' ')}` : '* SEARCH');
  send(session, `${tag} OK ${useUid ? 'UID ' : ''}SEARCH completed`);
}

function handleExpunge(session: ImapSession, tag: string) {
  if (!session.authenticated || !session.selectedMailbox) {
    send(session, `${tag} NO no mailbox selected`);
    return;
  }

  // Expunge emails marked \Deleted (tracked in session.deletedIds) from current folder
  const emails = getMailboxEmails(session.userId, session.selectedMailbox);
  let seqOffset = 0;
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i]!;
    if (session.deletedIds.has(email.id)) {
      db.prepare('DELETE FROM email_attachments WHERE email_id = ?').run(email.id);
      db.prepare('DELETE FROM emails WHERE id = ?').run(email.id);
      send(session, `* ${i + 1 - seqOffset} EXPUNGE`);
      seqOffset++;
      session.deletedIds.delete(email.id);
    }
  }

  send(session, `${tag} OK EXPUNGE completed`);
}

function handleNoop(session: ImapSession, tag: string) {
  // Update EXISTS count if mailbox is selected
  if (session.selectedMailbox) {
    const stats = getMailboxStats(session.userId, session.selectedMailbox);
    send(session, `* ${stats.exists} EXISTS`);
    send(session, `* ${stats.recent} RECENT`);
  }
  send(session, `${tag} OK NOOP completed`);
}

// Track idle sessions for new mail push
const idleSessions = new Set<ImapSession>();

function handleIdle(session: ImapSession, tag: string) {
  if (!session.authenticated) { send(session, `${tag} NO not authenticated`); return; }
  session.idling = true;
  session.idleTag = tag;
  if (session.selectedMailbox) {
    session.idleExistCount = getMailboxStats(session.userId, session.selectedMailbox).exists;
  }
  idleSessions.add(session);
  send(session, '+ idling');
}

// Poll every 10s — push EXISTS to idling sessions when new mail arrives
setInterval(() => {
  for (const session of idleSessions) {
    if (!session.idling || !session.selectedMailbox) {
      idleSessions.delete(session);
      continue;
    }
    try {
      const stats = getMailboxStats(session.userId, session.selectedMailbox);
      if (stats.exists !== session.idleExistCount) {
        send(session, `* ${stats.exists} EXISTS`);
        send(session, `* ${stats.recent} RECENT`);
        session.idleExistCount = stats.exists;
      }
    } catch {
      idleSessions.delete(session);
    }
  }
}, 10_000);

function handleClose(session: ImapSession, tag: string) {
  // RFC 3501: CLOSE silently expunges \Deleted messages (no untagged EXPUNGE responses)
  if (session.selectedMailbox && !session.selectedReadonly) {
    const emails = getMailboxEmails(session.userId, session.selectedMailbox);
    for (const email of emails) {
      if (session.deletedIds.has(email.id)) {
        db.prepare('DELETE FROM email_attachments WHERE email_id = ?').run(email.id);
        db.prepare('DELETE FROM emails WHERE id = ?').run(email.id);
        session.deletedIds.delete(email.id);
      }
    }
  }
  session.selectedMailbox = null;
  session.selectedReadonly = false;
  send(session, `${tag} OK CLOSE completed`);
}

function handleLogout(session: ImapSession, tag: string) {
  send(session, '* BYE see you later');
  send(session, `${tag} OK LOGOUT completed`);
  session.socket.end();
}

function handleStatus(session: ImapSession, tag: string, args: string) {
  if (!session.authenticated) { send(session, `${tag} NO not authenticated`); return; }

  const match = args.match(/^"?([^"(]+?)"?\s*\(([^)]+)\)/);
  if (!match) { send(session, `${tag} BAD invalid STATUS`); return; }

  const mailbox = match[1]!.trim();
  const items = match[2]!.toUpperCase().split(/\s+/);
  const dbFolder = imapFolderToDb(mailbox);
  const stats = getMailboxStats(session.userId, dbFolder);

  const parts: string[] = [];
  for (const item of items) {
    switch (item) {
      case 'MESSAGES': parts.push(`MESSAGES ${stats.exists}`); break;
      case 'RECENT': parts.push(`RECENT ${stats.recent}`); break;
      case 'UNSEEN': parts.push(`UNSEEN ${stats.unseen}`); break;
      case 'UIDNEXT': parts.push(`UIDNEXT ${stats.uidnext}`); break;
      case 'UIDVALIDITY': parts.push(`UIDVALIDITY ${stats.uidvalidity}`); break;
    }
  }

  send(session, `* STATUS "${dbFolderToImap(dbFolder)}" (${parts.join(' ')})`);
  send(session, `${tag} OK STATUS completed`);
}

// ── Helpers ──

function parseQuotedArgs(args: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < args.length) {
    // Skip whitespace
    while (i < args.length && args[i] === ' ') i++;
    if (i >= args.length) break;

    if (args[i] === '"') {
      // Quoted string
      i++;
      let str = '';
      while (i < args.length && args[i] !== '"') {
        if (args[i] === '\\' && i + 1 < args.length) { str += args[i + 1]; i += 2; }
        else { str += args[i]; i++; }
      }
      if (i < args.length) i++; // skip closing quote
      result.push(str);
    } else {
      // Unquoted token
      let str = '';
      while (i < args.length && args[i] !== ' ') { str += args[i]; i++; }
      result.push(str);
    }
  }
  return result;
}

function resolveSequenceSet(seqStr: string, emails: DbEmail[], useUid: boolean): number[] {
  const results: number[] = [];
  const max = emails.length;
  if (max === 0) return results;

  const ranges = seqStr.split(',');
  for (const range of ranges) {
    const [startStr, endStr] = range.split(':');
    let start: number;
    let end: number;

    if (useUid) {
      start = startStr === '*' ? emails[max - 1]!.id : parseInt(startStr!, 10);
      end = endStr === undefined ? start : (endStr === '*' ? emails[max - 1]!.id : parseInt(endStr, 10));

      for (let i = 0; i < emails.length; i++) {
        const uid = emails[i]!.id;
        if (uid >= Math.min(start, end) && uid <= Math.max(start, end)) {
          results.push(i);
        }
      }
    } else {
      start = startStr === '*' ? max : parseInt(startStr!, 10);
      end = endStr === undefined ? start : (endStr === '*' ? max : parseInt(endStr, 10));

      const lo = Math.max(1, Math.min(start, end));
      const hi = Math.min(max, Math.max(start, end));
      for (let i = lo; i <= hi; i++) {
        results.push(i - 1); // 0-indexed
      }
    }
  }

  return [...new Set(results)].sort((a, b) => a - b);
}

function formatImapDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d.getUTCDate().toString().padStart(2, ' ');
  const mon = months[d.getUTCMonth()]!;
  const year = d.getUTCFullYear();
  const time = `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}:${d.getUTCSeconds().toString().padStart(2, '0')}`;
  return `${day}-${mon}-${year} ${time} +0000`;
}

function buildEnvelope(email: DbEmail): string {
  const date = new Date(email.created_at + 'Z').toUTCString();
  const subject = quoteImapString(email.subject || '');
  const from = formatAddress(email.from_address);
  const to = formatAddress(email.to_address);
  const mid = email.message_id ? quoteImapString(email.message_id) : 'NIL';
  const irt = email.in_reply_to ? quoteImapString(email.in_reply_to) : 'NIL';

  return `("${date}" ${subject} ${from} ${from} ${from} ${to} NIL NIL ${irt} ${mid})`;
}

function formatAddress(addr: string): string {
  // Parse "user@domain" into IMAP address format ((NIL NIL "user" "domain"))
  const parts = addr.replace(/^.*</, '').replace(/>.*$/, '').split('@');
  const local = parts[0] ?? addr;
  const domain = parts[1] ?? DOMAIN;
  return `((NIL NIL "${local}" "${domain}"))`;
}

function quoteImapString(s: string): string {
  if (s.length === 0) return '""';
  // Use literal for strings with special chars
  if (s.includes('"') || s.includes('\\') || s.includes('\r') || s.includes('\n')) {
    const bytes = Buffer.byteLength(s, 'utf-8');
    return `{${bytes}}\r\n${s}`;
  }
  return `"${s}"`;
}

function handleCopy(session: ImapSession, tag: string, args: string, useUid: boolean) {
  if (!session.authenticated || !session.selectedMailbox) {
    send(session, `${tag} NO no mailbox selected`);
    return;
  }

  const spaceIdx = args.indexOf(' ');
  if (spaceIdx === -1) { send(session, `${tag} BAD invalid COPY`); return; }

  const seqStr = args.substring(0, spaceIdx);
  const destParts = parseQuotedArgs(args.substring(spaceIdx + 1));
  const destFolder = imapFolderToDb(destParts[0] ?? 'inbox');

  const emails = getMailboxEmails(session.userId, session.selectedMailbox);
  const indices = resolveSequenceSet(seqStr, emails, useUid);

  const newUids: number[] = [];
  for (const idx of indices) {
    const email = emails[idx]!;
    const result = db.prepare(
      `INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, is_read, is_starred, message_id, in_reply_to, thread_id)
       SELECT owner_id, address_id, ?, from_address, to_address, subject, body, is_read, is_starred, message_id, in_reply_to, thread_id FROM emails WHERE id = ?`
    ).run(destFolder, email.id);
    newUids.push(Number(result.lastInsertRowid));
  }

  if (newUids.length > 0) {
    const srcUids = indices.map(i => emails[i]!.id).join(',');
    const dstUids = newUids.join(',');
    send(session, `${tag} OK [COPYUID 1 ${srcUids} ${dstUids}] COPY completed`);
  } else {
    send(session, `${tag} OK COPY completed`);
  }
}

function handleMove(session: ImapSession, tag: string, args: string, useUid: boolean) {
  if (!session.authenticated || !session.selectedMailbox) {
    send(session, `${tag} NO no mailbox selected`);
    return;
  }

  const spaceIdx = args.indexOf(' ');
  if (spaceIdx === -1) { send(session, `${tag} BAD invalid MOVE`); return; }

  const seqStr = args.substring(0, spaceIdx);
  const destParts = parseQuotedArgs(args.substring(spaceIdx + 1));
  const destFolder = imapFolderToDb(destParts[0] ?? 'inbox');

  const emails = getMailboxEmails(session.userId, session.selectedMailbox);
  const indices = resolveSequenceSet(seqStr, emails, useUid);

  let offset = 0;
  for (const idx of indices) {
    const email = emails[idx]!;
    db.prepare('UPDATE emails SET folder = ? WHERE id = ?').run(destFolder, email.id);
    const seqNum = idx + 1 - offset;
    send(session, `* ${seqNum} EXPUNGE`);
    offset++;
  }

  send(session, `${tag} OK MOVE completed`);
}

function handleAppend(session: ImapSession, tag: string, args: string) {
  if (!session.authenticated) { send(session, `${tag} NO not authenticated`); return; }

  // Parse: "Mailbox" (\Flag1 \Flag2) {size}
  const literalMatch = args.match(/\{(\d+)\}$/);
  if (!literalMatch) { send(session, `${tag} OK APPEND completed`); return; }

  // Extract folder name
  const folderMatch = args.match(/^"?([^"({\s]+)"?\s*/);
  const folder = folderMatch ? imapFolderToDb(folderMatch[1]!) : 'inbox';

  // Extract flags
  const flagsMatch = args.match(/\(([^)]*)\)/);
  const flags = flagsMatch ? flagsMatch[1]!.split(/\s+/).filter(Boolean) : [];

  const size = parseInt(literalMatch[1]!, 10);
  session.literalRemaining = size + 2; // +2 for trailing \r\n
  session.literalTag = tag;
  session.literalFolder = folder;
  session.literalFlags = flags;
  session.literalData = '';
  send(session, '+ go ahead');
}

async function finishAppend(session: ImapSession) {
  const tag = session.literalTag!;
  const folder = session.literalFolder ?? 'inbox';
  const flags = session.literalFlags;
  const raw = session.literalData;

  // Reset literal state
  session.literalTag = null;
  session.literalFolder = null;
  session.literalFlags = [];
  session.literalData = '';

  try {
    // Use simpleParser to properly decode RFC 2047 headers + Content-Transfer-Encoding body
    const parsed = await simpleParser(Buffer.from(raw, 'utf-8'));

    const from = parsed.from?.text ?? `${session.username}@${DOMAIN}`;
    const to = parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(a => a.text).join(', ') : parsed.to.text) : '';
    const subject = parsed.subject ?? '';
    const body = parsed.text ?? parsed.html ?? '';
    const messageId = parsed.messageId ?? null;
    const inReplyTo = Array.isArray(parsed.inReplyTo) ? parsed.inReplyTo[0] ?? null : parsed.inReplyTo ?? null;

    const isRead = flags.some(f => f.toUpperCase() === '\\SEEN') ? 1 : 0;
    const isStarred = flags.some(f => f.toUpperCase() === '\\FLAGGED') ? 1 : 0;

    // Find address_id for the sender
    const senderAddr = parsed.from?.value?.[0]?.address ?? `${session.username}@${DOMAIN}`;
    const senderLocal = senderAddr.split('@')[0]!;
    const addrRow = db.prepare('SELECT id FROM email_addresses WHERE address = ? AND user_id = ?')
      .get(senderLocal, session.userId) as { id: number } | undefined;

    // Thread ID
    let threadId = messageId ?? `<${Date.now()}@${DOMAIN}>`;
    if (inReplyTo) {
      const parent = db.prepare('SELECT thread_id FROM emails WHERE message_id = ? LIMIT 1')
        .get(inReplyTo) as { thread_id: string | null } | undefined;
      if (parent?.thread_id) threadId = parent.thread_id;
    }

    // Deduplicate: if this message_id already exists for this user in the same folder, skip
    if (messageId) {
      const existing = db.prepare('SELECT id FROM emails WHERE owner_id = ? AND folder = ? AND message_id = ?').get(session.userId, folder, messageId) as { id: number } | undefined;
      if (existing) {
        ilog('info', `append skip (dup): ${messageId}`);
        send(session, `${tag} OK [APPENDUID 1 ${existing.id}] APPEND completed`);
        return;
      }
    }

    const result = db.prepare(
      `INSERT INTO emails (owner_id, address_id, folder, from_address, to_address, subject, body, is_read, is_starred, message_id, in_reply_to, thread_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(session.userId, addrRow?.id ?? null, folder, from, to, subject, body, isRead, isStarred, messageId, inReplyTo, threadId);

    const uid = Number(result.lastInsertRowid);
    ilog('info', `append: ${folder} uid=${uid} from=${from} to=${to} subj="${subject}"`);

    // UIDPLUS response
    send(session, `${tag} OK [APPENDUID 1 ${uid}] APPEND completed`);
  } catch (err) {
    ilog('error', `append failed: ${err}`);
    send(session, `${tag} NO APPEND failed`);
  }
}

// ── Connection handler ──

function handleConnection(socket: Socket | TLSSocket) {
  const session: ImapSession = {
    socket,
    authenticated: false,
    userId: 0,
    username: '',
    selectedMailbox: null,
    selectedReadonly: false,
    buffer: '',
    idling: false,
    idleTag: null,
    idleExistCount: 0,
    deletedIds: new Set(),
    literalRemaining: 0,
    literalTag: null,
    literalFolder: null,
    literalFlags: [],
    literalData: '',
  };

  const addr = socket.remoteAddress ?? 'unknown';
  ilog('info', `connection from ${addr}`);

  send(session, `* OK [CAPABILITY IMAP4rev1 IDLE NAMESPACE ID UIDPLUS CHILDREN SPECIAL-USE UNSELECT] ${DOMAIN} ready`);

  socket.on('data', (chunk: Buffer) => {
    session.buffer += chunk.toString('utf-8');

    // If consuming a literal (e.g. APPEND body), collect bytes
    if (session.literalRemaining > 0) {
      const consumed = Math.min(session.literalRemaining, session.buffer.length);
      session.literalData += session.buffer.substring(0, consumed);
      session.buffer = session.buffer.substring(consumed);
      session.literalRemaining -= consumed;
      if (session.literalRemaining <= 0 && session.literalTag) {
        // Done — store the appended message (async: decode RFC 2047 + base64)
        finishAppend(session).catch(err => ilog('error', `finishAppend: ${err}`));
      }
      if (session.literalRemaining > 0) return;
    }

    // Process complete lines
    let nlIdx: number;
    while ((nlIdx = session.buffer.indexOf('\r\n')) !== -1) {
      const line = session.buffer.substring(0, nlIdx);
      session.buffer = session.buffer.substring(nlIdx + 2);

      if (line.trim().length === 0) continue;

      // Log raw command (mask passwords)
      const logLine = line.includes('LOGIN') ? line.replace(/LOGIN\s+\S+\s+\S+/, 'LOGIN *** ***') : line;
      ilog('info', `< ${addr} ${logLine}`);

      // Handle IDLE continuation
      if (session.idling && line.toUpperCase() === 'DONE') {
        session.idling = false;
        idleSessions.delete(session);
        if (session.idleTag) {
          send(session, `${session.idleTag} OK IDLE terminated`);
          session.idleTag = null;
        }
        continue;
      }

      // Parse tag and command
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) {
        send(session, `* BAD invalid command`);
        continue;
      }

      const tag = line.substring(0, spaceIdx);
      const rest = line.substring(spaceIdx + 1);

      // Split command and args
      const cmdSpaceIdx = rest.indexOf(' ');
      let command: string;
      let args: string;

      if (cmdSpaceIdx === -1) {
        command = rest.toUpperCase();
        args = '';
      } else {
        command = rest.substring(0, cmdSpaceIdx).toUpperCase();
        args = rest.substring(cmdSpaceIdx + 1);
      }

      // Handle UID prefix
      let useUid = false;
      if (command === 'UID') {
        useUid = true;
        const subSpaceIdx = args.indexOf(' ');
        if (subSpaceIdx === -1) {
          command = args.toUpperCase();
          args = '';
        } else {
          command = args.substring(0, subSpaceIdx).toUpperCase();
          args = args.substring(subSpaceIdx + 1);
        }
      }

      try {
        switch (command) {
          case 'CAPABILITY': handleCapability(session, tag); break;
          case 'LOGIN': handleLogin(session, tag, args); break;
          case 'AUTHENTICATE': send(session, `${tag} NO use LOGIN instead`); break;
          case 'LIST': handleList(session, tag, args); break;
          case 'XLIST': handleList(session, tag, args); break;
          case 'LSUB': handleLsub(session, tag, args); break;
          case 'SELECT': handleSelect(session, tag, args, false); break;
          case 'EXAMINE': handleSelect(session, tag, args, true); break;
          case 'FETCH': handleFetch(session, tag, args, useUid); break;
          case 'STORE': handleStore(session, tag, args, useUid); break;
          case 'SEARCH': handleSearch(session, tag, args, useUid); break;
          case 'EXPUNGE': handleExpunge(session, tag); break;
          case 'CLOSE': handleClose(session, tag); break;
          case 'STATUS': handleStatus(session, tag, args); break;
          case 'NOOP': handleNoop(session, tag); break;
          case 'CHECK': handleNoop(session, tag); break;
          case 'IDLE': handleIdle(session, tag); break;
          case 'LOGOUT': handleLogout(session, tag); break;
          case 'NAMESPACE':
            send(session, '* NAMESPACE (("" "/")) NIL NIL');
            send(session, `${tag} OK NAMESPACE completed`);
            break;
          case 'ID':
            send(session, `* ID ("name" "mynig.ga" "version" "1.0")`);
            send(session, `${tag} OK ID completed`);
            break;
          case 'ENABLE':
            send(session, `${tag} OK nothing to enable`);
            break;
          case 'COPY':
            handleCopy(session, tag, args, useUid);
            break;
          case 'MOVE':
            handleMove(session, tag, args, useUid);
            break;
          case 'COMPRESS':
            send(session, `${tag} NO COMPRESS not supported`);
            break;
          case 'UNSELECT':
            session.selectedMailbox = null;
            session.selectedReadonly = false;
            send(session, `${tag} OK UNSELECT completed`);
            break;
          case 'GETQUOTAROOT':
          case 'GETQUOTA':
          case 'SETQUOTA':
            send(session, `${tag} NO QUOTA not supported`);
            break;
          case 'SUBSCRIBE':
          case 'UNSUBSCRIBE':
            send(session, `${tag} OK ${command} completed`);
            break;
          case 'CREATE':
          case 'DELETE':
          case 'RENAME':
            send(session, `${tag} NO ${command} not supported via IMAP`);
            break;
          case 'APPEND':
            handleAppend(session, tag, args);
            break;
          default:
            send(session, `${tag} BAD unknown command ${command}`);
        }
      } catch (err) {
        ilog('error', `error handling ${command}: ${err}`);
        send(session, `${tag} NO internal error`);
      }
    }
  });

  socket.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') {
      ilog('error', `socket error: ${err.message}`);
    }
  });

  socket.on('close', () => {
    idleSessions.delete(session);
    ilog('info', `disconnected: ${session.username || addr}`);
  });

  socket.setTimeout(30 * 60 * 1000); // 30 min timeout
  socket.on('timeout', () => {
    send(session, '* BYE idle timeout');
    socket.end();
  });
}

// ── Crash protection ──
process.on('uncaughtException', (err) => {
  ilog('error', `UNCAUGHT: ${err.stack ?? err.message ?? err}`);
});
process.on('unhandledRejection', (err) => {
  ilog('error', `UNHANDLED REJECTION: ${err}`);
});

// ── Start servers ──

if (tlsOptions) {
  const tlsServer = createTlsServer(tlsOptions, (socket) => handleConnection(socket));
  tlsServer.on('error', (err) => ilog('error', `TLS server error: ${err}`));
  tlsServer.listen(IMAPS_PORT, () => {
    ilog('info', `TLS listening on port ${IMAPS_PORT}`);
  });
}

const tcpServer = createTcpServer((socket) => handleConnection(socket));
tcpServer.on('error', (err) => ilog('error', `TCP server error: ${err}`));
tcpServer.listen(IMAP_PORT, () => {
  ilog('info', `plaintext listening on port ${IMAP_PORT}`);
});
