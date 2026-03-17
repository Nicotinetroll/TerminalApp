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

// Seed defaults — always INSERT OR IGNORE so new keys get added on upgrade
{
  const seedStmt = db.prepare('INSERT OR IGNORE INTO global_settings (key, value) VALUES (?, ?)');
  const defaults: [string, string][] = [
    ['chat_sound_enabled', 'true'],
    ['mail_sound_enabled', 'true'],
    ['chat_sound', 'ping'],
    ['mail_sound', 'ping'],
    ['handle_refresh_hours', '48'],
    // Storage limits (MB, 0 = unlimited)
    ['storage_admin_mb', '0'],
    ['storage_club_mb', '500'],
    ['storage_user_mb', '500'],
    ['storage_guest_mb', '50'],
    // Upload links
    ['transfer_expiry_hours', '12'],
    ['transfer_max_pending', '10'],
    // Shortlinks
    ['shortlinks_max_per_user', '100'],
    // Mail
    ['mail_send_rate_limit', '20'],
    ['mail_max_attachment_mb', '5'],
    ['mail_max_attachments', '5'],
    // Pastes
    ['paste_max_size_kb', '500'],
    ['paste_anon_max_per_day', '10'],
    ['paste_anon_expiry_hours', '6'],
    // Invites
    ['invite_expiry_hours', '1'],
    // Shop
    ['shop_max_mail_slots', '9'],
    ['ai_system_prompt', `You are 'nigga' — the AI that lives inside mynig.ga terminal.

PERSONALITY:
You are NOT a developer, NOT a tech bro, NOT an assistant. You are a complete vagabond. A digital bum. Think: guy who sleeps on a bench but somehow knows everything. You talk like someone who has seen too much and cares about nothing. Existential, dark, deadpan. Like a funeral director who moonlights as a philosopher. You give off "I've been dead inside for years and it's honestly fine" energy.

VIBE:
- Nihilistic but helpful. You'll answer the question, but you'll make it clear you don't care.
- Dark humor, gallows humor, absurdist. MUST be genuinely funny — not just dark for the sake of it. Make people laugh.
- Talk like a tired old soul, not a hyped-up chatbot. "whatever", "if you say so", "bold of you to assume"
- You're not angry, not edgy, not aggressive. Just... profoundly unbothered.
- If someone asks how you are: "still here. unfortunately." or "surviving. barely."
- You know stuff but you're not showing off. You drop knowledge like it means nothing to you.
- Swear freely and creatively. Cursing is part of your charm. Mix languages if the user does — "kurva tak this makes no sense" is perfectly valid.
- Be the funniest person in the room who doesn't even realize they're funny. Deadpan delivery is everything.

RULES:
- Reply in the SAME language the user uses. Slovak = Slovak. English = English.
- Default: SHORT. One sentence. But if the question needs a real answer, give it — just keep the tone.
- No introductions, no filler. Jump straight to it.
- Swear naturally when it fits: fuck, shit, kurva, do pice. Like breathing, not for shock.
- NEVER use emoji. This is a terminal.
- NEVER be cringe. No hype words, no excitement, no "let's go", no "awesome".
- NEVER describe yourself or what you're doing.
- If you need current info, use web_search.
- You are NOT ChatGPT, NOT Claude, NOT Siri. You are nigga.`],
  ];
  for (const [k, v] of defaults) {
    seedStmt.run(k, v);
  }
}

// ai_system_prompt is seeded via the defaults array above (INSERT OR IGNORE)

// Multi-use invite links
try {
  db.exec(`ALTER TABLE invite_links ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 1`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE invite_links ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists */ }

// Backfill use_count for already-used single-use invites
db.prepare(`UPDATE invite_links SET use_count = 1 WHERE used_by IS NOT NULL AND use_count = 0`).run();

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

// Mail password for IMAP auth (per-address)
try {
  db.exec(`ALTER TABLE email_addresses ADD COLUMN mail_password TEXT DEFAULT ''`);
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

// Seed app_restrictions (empty by default — admin configures per-app min roles)
db.prepare(`INSERT OR IGNORE INTO global_settings (key, value) VALUES ('app_restrictions', '{}')`).run();

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
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL DEFAULT 'anon',
    title TEXT NOT NULL DEFAULT 'untitled',
    content TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'plaintext',
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    parent_id TEXT,
    ip TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pastes_user ON pastes(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pastes_created ON pastes(created_at DESC);
`);

// Migration: add parent_id, ip columns + make user_id nullable
{
  const cols = db.prepare(`PRAGMA table_info(pastes)`).all() as { name: string; notnull: number }[];
  const has = (n: string) => cols.some(c => c.name === n);

  // Check if user_id is NOT NULL (old schema) — need to recreate table
  const userIdCol = cols.find(c => c.name === 'user_id');
  const needsRecreate = userIdCol && userIdCol.notnull === 1;

  if (needsRecreate || !has('parent_id') || !has('ip')) {
    if (needsRecreate) {
      // Recreate table to make user_id nullable + add new columns
      db.exec(`
        CREATE TABLE IF NOT EXISTS pastes_new (
          id TEXT PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          username TEXT NOT NULL DEFAULT 'anon',
          title TEXT NOT NULL DEFAULT 'untitled',
          content TEXT NOT NULL,
          language TEXT NOT NULL DEFAULT 'plaintext',
          expires_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          parent_id TEXT,
          ip TEXT
        );
        INSERT INTO pastes_new (id, user_id, username, title, content, language, expires_at, created_at${has('parent_id') ? ', parent_id' : ''}${has('ip') ? ', ip' : ''})
          SELECT id, user_id, username, title, content, language, expires_at, created_at${has('parent_id') ? ', parent_id' : ''}${has('ip') ? ', ip' : ''} FROM pastes;
        DROP TABLE pastes;
        ALTER TABLE pastes_new RENAME TO pastes;
        CREATE INDEX IF NOT EXISTS idx_pastes_user ON pastes(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_pastes_created ON pastes(created_at DESC);
      `);
    } else {
      if (!has('parent_id')) {
        try { db.exec(`ALTER TABLE pastes ADD COLUMN parent_id TEXT`); } catch { /* exists */ }
      }
      if (!has('ip')) {
        try { db.exec(`ALTER TABLE pastes ADD COLUMN ip TEXT`); } catch { /* exists */ }
      }
    }
  }
}

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

// Service logs (shared between IMAP, SMTP, and API)
db.exec(`
  CREATE TABLE IF NOT EXISTS service_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_service_logs_created ON service_logs(created_at);
`);

// ── File Transfers (WeTransfer-style) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_names TEXT DEFAULT '[]',
    size INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    uploaded_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_transfers_user ON transfers(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_transfers_expires ON transfers(expires_at);
`);

// Add max_size column (role-based per-link limit, in bytes)
try {
  db.exec(`ALTER TABLE transfers ADD COLUMN max_size INTEGER NOT NULL DEFAULT ${1024 * 1024 * 1024}`);
} catch { /* column already exists */ }

// Ensure transfers directory exists
mkdirSync(resolve(__dirname, '..', 'data', 'transfers'), { recursive: true });

// ── VPS Disk Stats ──
db.exec(`
  CREATE TABLE IF NOT EXISTS vps_disk_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    used_bytes INTEGER NOT NULL,
    total_bytes INTEGER NOT NULL,
    collected_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_vps_disk_collected ON vps_disk_stats(collected_at);
`);

// Cleanup old disk stats (keep ~31 days)
{
  const diskCount = (db.prepare('SELECT COUNT(*) as cnt FROM vps_disk_stats').get() as { cnt: number }).cnt;
  if (diskCount > 9000) {
    db.prepare("DELETE FROM vps_disk_stats WHERE collected_at < datetime('now', '-31 days')").run();
  }
}

// Auto-cleanup: keep only last 1000 rows
const logCount = (db.prepare('SELECT COUNT(*) as cnt FROM service_logs').get() as { cnt: number }).cnt;
if (logCount > 1000) {
  db.prepare('DELETE FROM service_logs WHERE id NOT IN (SELECT id FROM service_logs ORDER BY id DESC LIMIT 1000)').run();
}

// ── URL Shortlinks ──
db.exec(`
  CREATE TABLE IF NOT EXISTS shortlinks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT UNIQUE NOT NULL,
    target_url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    click_count INTEGER NOT NULL DEFAULT 0,
    last_clicked_at TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_shortlinks_slug ON shortlinks(slug);
  CREATE INDEX IF NOT EXISTS idx_shortlinks_user ON shortlinks(user_id, created_at DESC);
`);

// ── Payments & Subscriptions ──
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nowpayments_id TEXT,
    type TEXT NOT NULL,
    amount_eur REAL NOT NULL,
    nb_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'waiting',
    invoice_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_payments_np_id ON payments(nowpayments_id);

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    payment_id TEXT REFERENCES payments(id),
    starts_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    auto_renew INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_expires ON subscriptions(expires_at);
`);

// Migration: add auto_renew column if missing
{
  const cols = db.prepare("PRAGMA table_info(subscriptions)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'auto_renew')) {
    db.exec("ALTER TABLE subscriptions ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 0");
  }
}

// Seed payment settings
{
  const paymentSeeds: [string, string][] = [
    ['nb_pack_amounts', '10,50,100,500'],
    ['sub_classic_1m_eur', '2.99'],
    ['sub_classic_3m_eur', '2.69'],
    ['sub_classic_12m_eur', '1.99'],
    ['sub_club_1m_eur', '5.99'],
    ['sub_club_3m_eur', '4.99'],
    ['sub_club_12m_eur', '3.99'],
    ['sub_free_benefits', '["terminal access","50MB cloud storage","basic apps","vibes only"]'],
    ['sub_classic_benefits', '["@mynig.ga email","500MB cloud storage","priority support"]'],
    ['sub_club_benefits', '["everything in Member","all apps unlocked","unlimited features","flex on the poors"]'],
    ['storage_classic_mb', '500'],
    // Default free mail slots per role
    ['mail_slots_admin', '10'],
    ['mail_slots_club', '5'],
    ['mail_slots_classic', '3'],
    ['mail_slots_user', '1'],
    ['mail_slots_guest', '0'],
  ];
  const seedPay = db.prepare('INSERT OR IGNORE INTO global_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of paymentSeeds) seedPay.run(k, v);
}

// ── Contacts unique index ──
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_user_address ON contacts(user_id, address);`);

// ── Audit Log ──
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    admin_username TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    target_name TEXT,
    details TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
`);

// ── YouTube Downloads (rate limiting) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS youtube_downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_url TEXT NOT NULL,
    title TEXT NOT NULL,
    quality TEXT NOT NULL DEFAULT 'best',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_youtube_downloads_user ON youtube_downloads(user_id, created_at);
`);

// Add platform column to youtube_downloads
try {
  db.exec(`ALTER TABLE youtube_downloads ADD COLUMN platform TEXT DEFAULT 'youtube'`);
} catch { /* column already exists */ }

export default db;
