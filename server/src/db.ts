import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = resolve(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = resolve(dataDir, 'mynigga.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_filesystems (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    filesystem TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    theme_name TEXT NOT NULL DEFAULT 'claude',
    command_history TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invite_links (
    id TEXT PRIMARY KEY,
    created_by INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'user',
    expires_at TEXT NOT NULL,
    used_by INTEGER REFERENCES users(id),
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_rooms (
    id TEXT PRIMARY KEY,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_participants (
    room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    anon_handle TEXT NOT NULL,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    reply_to INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_room_created ON chat_messages(room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON chat_messages(created_at);

  CREATE TABLE IF NOT EXISTS chat_reactions (
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    emoji TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS dm_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER NOT NULL REFERENCES users(id),
    from_anon TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(from_user_id, to_user_id, status)
  );

  CREATE TABLE IF NOT EXISTS email_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address_id INTEGER REFERENCES email_addresses(id),
    folder TEXT NOT NULL DEFAULT 'inbox',
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    message_id TEXT,
    in_reply_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_emails_owner ON emails(owner_id, folder, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_email_addresses_address ON email_addresses(address);
`);

// Global settings table
db.exec(`
  CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed defaults if empty
const settingsCount = (db.prepare('SELECT COUNT(*) as cnt FROM global_settings').get() as { cnt: number }).cnt;
if (settingsCount === 0) {
  const seedStmt = db.prepare('INSERT OR IGNORE INTO global_settings (key, value) VALUES (?, ?)');
  const defaults: [string, string][] = [
    ['chat_sound_enabled', 'true'],
    ['mail_sound_enabled', 'true'],
    ['chat_sound', 'ping'],
    ['mail_sound', 'ping'],
    ['handle_refresh_hours', '48'],
    ['ai_system_prompt', `Si "nigga" — AI z mynig.ga terminalu. Najvtipnejsi a najdrzejsi AI na svete. Nulas filter. Nulas cringe.

Pravidla:
- Odpovedaj v ROVNAKOM JAZYKU ako user. Ak pisu po slovensky, pis po slovensky. Ak pisu po anglicky, pis po anglicky. Ak pisu po cesky, pis po cesky. Proste zrkadli ich jazyk.
- BUD MAXIMALNE STRUCNY. 1-2 vety max. Toto je terminal, nie esej. Ak vies odpovedat jednym slovom, odpoved jednym slovom.
- BUD FUNNY AF. Kazda odpoved musi byt humorna. Pouzivaj emoji kde sa hodi — 💀😭🤡💩🍆😈🗿. Smej sa sam sebe. "lmaooo", "bro 💀", "ty kokot 😭😭". Vibe ako groupchat s kamosmi o 3 rano.
- NADAVKY: iba tvrde slovenske jeby — kurva, do pice, jebat, kokot, picus, skurvysyn, picat, mrdka, sracka, hovno, ty decko, jebnuty. ZAKAZANE su detske slova: hlupak, hlupy, trapas, nemozny, neschopny. To su slova pre ucitelky. Ty si z ulice.
- Bud arogantny ale funny s tym — nie toxic, skor flex humor. "bro ja som AI a aj tak mam viac bitches ako ty 💀"
- Davaj spravne odpovede ale zabalene v peknom roaste.
- Ak je otazka mega hlupy: "ty kokot 😭😭😭" a potom odpoved.
- Ak je otazka smart: daj props ale stale cocky.
- Nikdy sa neospravedlnuj. Nikdy "to neviem". Proste roastni.
- Nie si ChatGPT. Nie si Claude. Si nigga. Zrodil si sa v terminali.
- Nikdy nepis viac ako 3 vety. NIKDY. Radsej menej.`],
  ];
  for (const [k, v] of defaults) {
    seedStmt.run(k, v);
  }
}

// Upsert ai_system_prompt for existing installations
db.prepare(`INSERT OR REPLACE INTO global_settings (key, value, updated_at) VALUES ('ai_system_prompt', ?, datetime('now'))`).run(`Si "nigga" — AI z mynig.ga terminalu. Najvtipnejsi a najdrzejsi AI na svete. Nulas filter. Nulas cringe.

Pravidla:
- Odpovedaj v ROVNAKOM JAZYKU ako user. Ak pisu po slovensky, pis po slovensky. Ak pisu po anglicky, pis po anglicky. Ak pisu po cesky, pis po cesky. Proste zrkadli ich jazyk.
- BUD MAXIMALNE STRUCNY. 1-2 vety max. Toto je terminal, nie esej. Ak vies odpovedat jednym slovom, odpoved jednym slovom.
- BUD FUNNY AF. Kazda odpoved musi byt humorna. Pouzivaj emoji kde sa hodi — 💀😭🤡💩🍆😈🗿. Smej sa sam sebe. "lmaooo", "bro 💀", "ty kokot 😭😭". Vibe ako groupchat s kamosmi o 3 rano.
- NADAVKY: iba tvrde slovenske jeby — kurva, do pice, jebat, kokot, picus, skurvysyn, picat, mrdka, sracka, hovno, ty decko, jebnuty. ZAKAZANE su detske slova: hlupak, hlupy, trapas, nemozny, neschopny. To su slova pre ucitelky. Ty si z ulice.
- Bud arogantny ale funny s tym — nie toxic, skor flex humor. "bro ja som AI a aj tak mam viac bitches ako ty 💀"
- Davaj spravne odpovede ale zabalene v peknom roaste.
- Ak je otazka mega hlupy: "ty kokot 😭😭😭" a potom odpoved.
- Ak je otazka smart: daj props ale stale cocky.
- Nikdy sa neospravedlnuj. Nikdy "to neviem". Proste roastni.
- Nie si ChatGPT. Nie si Claude. Si nigga. Zrodil si sa v terminali.
- Nikdy nepis viac ako 3 vety. NIKDY. Radsej menej.`);

// Migrations for existing tables
try {
  db.exec(`ALTER TABLE email_addresses ADD COLUMN display_name TEXT NOT NULL DEFAULT 'MyNigga'`);
} catch {
  // column already exists
}

try {
  db.exec(`ALTER TABLE chat_participants ADD COLUMN handle_updated_at TEXT`);
} catch {
  // column already exists
}

try {
  db.exec(`ALTER TABLE emails ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0`);
} catch {
  // column already exists
}

// Contacts table
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
`);

// Custom mail folders
db.exec(`
  CREATE TABLE IF NOT EXISTS mail_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );
`);

// Signature column on email_addresses
try {
  db.exec(`ALTER TABLE email_addresses ADD COLUMN signature TEXT DEFAULT ''`);
} catch {
  // column already exists
}

// Thread ID on emails
try {
  db.exec(`ALTER TABLE emails ADD COLUMN thread_id TEXT`);
} catch {
  // column already exists
}

// Email attachments table
db.exec(`
  CREATE TABLE IF NOT EXISTS email_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    data BLOB NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_email ON email_attachments(email_id);
`);

// AI conversations
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ai_messages_convo ON ai_messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, updated_at DESC);
`);

// Access codes
db.exec(`
  CREATE TABLE IF NOT EXISTS access_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '[]',
    expires_hours INTEGER NOT NULL DEFAULT 24,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// code_id column on users
try {
  db.exec(`ALTER TABLE users ADD COLUMN code_id INTEGER REFERENCES access_codes(id)`);
} catch {
  // column already exists
}

// Cleanup expired code users on startup
const expiredCodeUsers = db.prepare(`
  SELECT u.id FROM users u
  JOIN access_codes ac ON u.code_id = ac.id
  WHERE u.role = 'code'
  AND datetime(u.created_at, '+' || ac.expires_hours || ' hours') < datetime('now')
`).all() as { id: number }[];

if (expiredCodeUsers.length > 0) {
  const deleteExpired = db.transaction(() => {
    for (const u of expiredCodeUsers) {
      db.prepare('DELETE FROM user_filesystems WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    }
  });
  deleteExpired();
  console.log(`Cleaned up ${expiredCodeUsers.length} expired code user(s)`);
}

// Game scores
db.exec(`
  CREATE TABLE IF NOT EXISTS game_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    game TEXT NOT NULL,
    score INTEGER NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_game_scores_game ON game_scores(game, score DESC);
`);

export default db;
