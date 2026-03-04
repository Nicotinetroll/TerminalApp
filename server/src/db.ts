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
  ];
  for (const [k, v] of defaults) {
    seedStmt.run(k, v);
  }
}

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
