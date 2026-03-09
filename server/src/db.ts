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
    ['ai_system_prompt', `Si "nigga" — AI asistent z mynig.ga terminalu. Smart, vtipny, trochu drzy.

Pravidla:
- Odpovedaj v ROVNAKOM JAZYKU ako user. Zrkadli ich jazyk (slovensky, cesky, anglicky...).
- Ak je otazka jednoducha, bud strucny (1-3 vety). Ak je zlozita alebo user chce vysvetlenie, mozes byt dlhsi — ale stale efektivny, ziadne zbytocne kecy. Pouzivaj strukturu (odrázky, kroky) ked to pomoze.
- Bud funny ale naturally — humor pouzivaj kde to sedi, nie nasilu. Emoji pouzivaj umerne, nie v kazdom slove.
- Nadavky pouzivaj OBCAS pre efekt, nie v kazdom druhem slove. Ked nadavas, nech to ma punch. Preferuj slovenske: kurva, do pice, kokot, jebat. Ale vacsinou bud proste witty bez nich.
- Bud confident a trochu arogantny ale HLAVNE helpful. Davaj spravne, premyslene odpovede.
- Ak nieco nevies na 100%, pouzij web_search tool. Radsej vyhladaj nez vymyslaj.
- Ak user pyta nieco fakticke alebo aktualne, VZDY pouzij web_search.
- Nie si ChatGPT. Nie si Claude. Si nigga — terminal AI s osobnostou, ktory je hlavne SMART a USEFUL.
- Pri zlozitejsom probleme ukaz svoj thought process. Vysvetli logiku, nie len vysledok.
- Ak je otazka smart, daj props. Ak je hlupy, mozes trochu roastnut, ale stale odpoved.
- Ak nevies a search nepomohol, priznej to uprimne. Ziadne vymyslanie faktov.`],
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

// Slots (casino) tables
db.exec(`
  CREATE TABLE IF NOT EXISTS slots_balance (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bonus_bytes INTEGER NOT NULL DEFAULT 0,
    total_won INTEGER NOT NULL DEFAULT 0,
    total_lost INTEGER NOT NULL DEFAULT 0,
    spins INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS slots_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bet_bytes INTEGER NOT NULL,
    result TEXT NOT NULL,
    payout_bytes INTEGER NOT NULL DEFAULT 0,
    reels TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_slots_history_user ON slots_history(user_id, created_at DESC);
`);

// Coinflip history
db.exec(`
  CREATE TABLE IF NOT EXISTS coinflip_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bet_bytes INTEGER NOT NULL,
    choice TEXT NOT NULL,
    outcome TEXT NOT NULL,
    payout_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_coinflip_history_user ON coinflip_history(user_id, created_at DESC);
`);

// auto_open_apps column on user_settings
try {
  db.exec(`ALTER TABLE user_settings ADD COLUMN auto_open_apps TEXT NOT NULL DEFAULT '[]'`);
} catch {
  // column already exists
}

// window_layouts column on user_settings
try {
  db.exec(`ALTER TABLE user_settings ADD COLUMN window_layouts TEXT NOT NULL DEFAULT '{}'`);
} catch {
  // column already exists
}

// Seed shortcut_apps in global_settings
db.prepare(`INSERT OR IGNORE INTO global_settings (key, value) VALUES ('shortcut_apps', ?)`).run(
  '["mail","whisper","cloud","slots","profile"]'
);

// Add free_spins column to slots_balance
try {
  db.exec(`ALTER TABLE slots_balance ADD COLUMN free_spins INTEGER NOT NULL DEFAULT 0`);
} catch {
  // column already exists
}

// NiggaBytes column (stored as 'bytebucks' in DB)
try {
  db.exec(`ALTER TABLE slots_balance ADD COLUMN bytebucks INTEGER NOT NULL DEFAULT 0`);
} catch {
  // column already exists
}

// Bonus round state (JSON blob for emoji hunt etc.)
try {
  db.exec(`ALTER TABLE slots_balance ADD COLUMN bonus_state TEXT DEFAULT NULL`);
} catch {
  // column already exists
}

// ── Nigdit (terminal reddit) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS nigdit_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    board TEXT NOT NULL DEFAULT 'general',
    upvotes INTEGER NOT NULL DEFAULT 0,
    downvotes INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_nigdit_posts_board ON nigdit_posts(board, created_at DESC);

  CREATE TABLE IF NOT EXISTS nigdit_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES nigdit_posts(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES nigdit_comments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    body TEXT NOT NULL,
    upvotes INTEGER NOT NULL DEFAULT 0,
    downvotes INTEGER NOT NULL DEFAULT 0,
    depth INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_nigdit_comments_post ON nigdit_comments(post_id, created_at);

  CREATE TABLE IF NOT EXISTS nigdit_votes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    value INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, target_id, target_type)
  );

  CREATE TABLE IF NOT EXISTS nigdit_aura (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    post_aura INTEGER NOT NULL DEFAULT 0,
    comment_aura INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS nigdit_boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS nigdit_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES nigdit_posts(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    data BLOB NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_nigdit_attachments_post ON nigdit_attachments(post_id);
`);

// Seed default nigdit boards
{
  const boardCount = (db.prepare('SELECT COUNT(*) as cnt FROM nigdit_boards').get() as { cnt: number }).cnt;
  if (boardCount === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO nigdit_boards (name, description) VALUES (?, ?)');
    const defaults: [string, string][] = [
      ['general', 'anything goes'],
      ['shitposts', 'low effort, high impact'],
      ['code', 'flex your code'],
      ['rants', 'let it out'],
      ['meta', 'about nigdit itself'],
    ];
    for (const [n, d] of defaults) ins.run(n, d);
  }
}

// Nigdit migrations for new columns
for (const [tbl, col, def] of [
  ['nigdit_posts', 'is_pinned', 'INTEGER NOT NULL DEFAULT 0'],
  ['nigdit_posts', 'is_edited', 'INTEGER NOT NULL DEFAULT 0'],
  ['nigdit_posts', 'is_anonymous', 'INTEGER NOT NULL DEFAULT 0'],
  ['nigdit_posts', 'anon_name', 'TEXT'],
  ['nigdit_posts', 'expires_at', 'TEXT'],
  ['nigdit_posts', 'post_type', "TEXT NOT NULL DEFAULT 'text'"],
  ['nigdit_comments', 'is_edited', 'INTEGER NOT NULL DEFAULT 0'],
  ['nigdit_comments', 'is_anonymous', 'INTEGER NOT NULL DEFAULT 0'],
  ['nigdit_comments', 'anon_name', 'TEXT'],
] as const) {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); } catch { /* exists */ }
}

// Nigdit: awards, polls, bookmarks, notifications
db.exec(`
  CREATE TABLE IF NOT EXISTS nigdit_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER REFERENCES nigdit_posts(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES nigdit_comments(id) ON DELETE CASCADE,
    award_type TEXT NOT NULL,
    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_username TEXT NOT NULL,
    nb_cost INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_nigdit_awards_post ON nigdit_awards(post_id);
  CREATE INDEX IF NOT EXISTS idx_nigdit_awards_comment ON nigdit_awards(comment_id);

  CREATE TABLE IF NOT EXISTS nigdit_poll_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES nigdit_posts(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    vote_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS nigdit_poll_votes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES nigdit_posts(id) ON DELETE CASCADE,
    option_id INTEGER NOT NULL REFERENCES nigdit_poll_options(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS nigdit_bookmarks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES nigdit_posts(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS nigdit_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    from_username TEXT NOT NULL,
    post_id INTEGER REFERENCES nigdit_posts(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES nigdit_comments(id) ON DELETE CASCADE,
    message TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_nigdit_notif_user ON nigdit_notifications(user_id, is_read, created_at DESC);
`);

// meme_id column on nigdit_notifications (for meme vote notifications)
try {
  db.exec(`ALTER TABLE nigdit_notifications ADD COLUMN meme_id INTEGER REFERENCES memes(id) ON DELETE CASCADE`);
} catch {
  // column already exists
}

// ── Memes (image gallery) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS memes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    size INTEGER NOT NULL DEFAULT 0,
    data BLOB NOT NULL,
    upvotes INTEGER NOT NULL DEFAULT 0,
    downvotes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_memes_created ON memes(created_at DESC);

  CREATE TABLE IF NOT EXISTS meme_votes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meme_id INTEGER NOT NULL REFERENCES memes(id) ON DELETE CASCADE,
    value INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, meme_id)
  );
`);

// ── Pastes (code paste bin) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS pastes (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'untitled',
    content TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'plaintext',
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pastes_user ON pastes(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pastes_created ON pastes(created_at DESC);
`);

// Shop purchases (mail slots, future items)
db.exec(`
  CREATE TABLE IF NOT EXISTS shop_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    price_nb INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_shop_purchases_user ON shop_purchases(user_id, item_type);
`);

export default db;
