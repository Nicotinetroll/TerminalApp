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
    ['mail_sound_enabled', 'true'],
    ['mail_sound', 'ping'],
    // Storage limits (MB, 0 = unlimited)
    ['storage_admin_mb', '0'],
    // Upload links
    ['transfer_expiry_hours', '12'],
    ['transfer_max_pending', '10'],
    // Transfer size limits per role (MB)
    ['transfer_size_admin_mb', '51200'],   // 50 GB
    ['transfer_size_premium_mb', '5120'],  // 5 GB
    ['transfer_size_basic_mb', '1024'],    // 1 GB
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

// Invite subscription fields (admin can grant sub with invite)
try {
  db.exec(`ALTER TABLE invite_links ADD COLUMN subscription_type TEXT`);
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE invite_links ADD COLUMN subscription_days INTEGER`);
} catch { /* column already exists */ }

// Migrations for existing tables
try {
  db.exec(`ALTER TABLE email_addresses ADD COLUMN display_name TEXT NOT NULL DEFAULT 'MyNigga'`);
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

// Slots balance (NiggaBytes currency)
db.exec(`
  CREATE TABLE IF NOT EXISTS slots_balance (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bonus_bytes INTEGER NOT NULL DEFAULT 0,
    total_won INTEGER NOT NULL DEFAULT 0,
    total_lost INTEGER NOT NULL DEFAULT 0,
    spins INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
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
  '["mail","cloud","profile","paste","shop"]'
);

// Seed app_restrictions (empty by default — admin configures per-app min roles)
db.prepare(`INSERT OR IGNORE INTO global_settings (key, value) VALUES ('app_restrictions', '{}')`).run();

// NiggaBytes column (stored as 'bytebucks' in DB)
try {
  db.exec(`ALTER TABLE slots_balance ADD COLUMN bytebucks INTEGER NOT NULL DEFAULT 0`);
} catch {
  // column already exists
}

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

// Add content_type column (NULL = zip mode, set = raw single-file mode)
try {
  db.exec(`ALTER TABLE transfers ADD COLUMN content_type TEXT`);
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
    ['sub_basic_1m_eur', '2.99'],
    ['sub_basic_3m_eur', '2.49'],
    ['sub_basic_12m_eur', '1.99'],
    ['sub_premium_1m_eur', '6.69'],
    ['sub_premium_3m_eur', '5.49'],
    ['sub_premium_12m_eur', '4.49'],
    ['sub_basic_benefits', '["@mynig.ga email","10GB cloud storage","1GB upload links","core apps"]'],
    ['sub_premium_benefits', '["30GB cloud storage","5GB upload links","all apps unlocked","priority support","flex on the poors"]'],
    ['storage_basic_mb', '10240'],
    ['storage_premium_mb', '30720'],
    // Default free mail slots per role
    ['mail_slots_admin', '10'],
    ['mail_slots_premium', '10'],
    ['mail_slots_basic', '3'],
  ];
  const seedPay = db.prepare('INSERT OR IGNORE INTO global_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of paymentSeeds) seedPay.run(k, v);

  // Migration: rename classic→basic, club→pro setting keys
  const renames: [string, string][] = [
    ['sub_classic_1m_eur', 'sub_basic_1m_eur'],
    ['sub_classic_3m_eur', 'sub_basic_3m_eur'],
    ['sub_classic_12m_eur', 'sub_basic_12m_eur'],
    ['sub_club_1m_eur', 'sub_premium_1m_eur'],
    ['sub_club_3m_eur', 'sub_premium_3m_eur'],
    ['sub_club_12m_eur', 'sub_premium_12m_eur'],
    ['sub_pro_1m_eur', 'sub_premium_1m_eur'],
    ['sub_pro_3m_eur', 'sub_premium_3m_eur'],
    ['sub_pro_12m_eur', 'sub_premium_12m_eur'],
    ['storage_classic_mb', 'storage_basic_mb'],
    ['storage_club_mb', 'storage_premium_mb'],
    ['storage_pro_mb', 'storage_premium_mb'],
    ['mail_slots_classic', 'mail_slots_basic'],
    ['mail_slots_club', 'mail_slots_premium'],
    ['mail_slots_pro', 'mail_slots_premium'],
    ['sub_classic_benefits', 'sub_basic_benefits'],
    ['sub_club_benefits', 'sub_premium_benefits'],
    ['sub_pro_benefits', 'sub_premium_benefits'],
  ];
  const renameSetting = db.prepare('UPDATE global_settings SET key = ? WHERE key = ? AND NOT EXISTS (SELECT 1 FROM global_settings WHERE key = ?)');
  for (const [oldK, newK] of renames) renameSetting.run(newK, oldK, newK);

  // Migration: rename user roles classic→basic, club/pro→premium
  db.prepare("UPDATE users SET role = 'basic' WHERE role = 'classic'").run();
  db.prepare("UPDATE users SET role = 'premium' WHERE role = 'club' OR role = 'pro'").run();

  // Migration: rename subscription types
  db.prepare("UPDATE subscriptions SET type = REPLACE(REPLACE(REPLACE(type, 'classic', 'basic'), 'club', 'premium'), 'pro', 'premium') WHERE type LIKE '%classic%' OR type LIKE '%club%' OR type LIKE '%pro%'").run();
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

// ── Email-based auth migration ──
// Add email column to users (nullable initially, we'll backfill)
try {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
} catch { /* column already exists */ }

// Backfill: for users without email, set email = first email_address or username@mynig.ga
{
  const usersNoEmail = db.prepare("SELECT id, username FROM users WHERE email IS NULL").all() as { id: number; username: string }[];
  if (usersNoEmail.length > 0) {
    const updateEmail = db.prepare("UPDATE users SET email = ? WHERE id = ?");
    const getAddr = db.prepare("SELECT address FROM email_addresses WHERE user_id = ? LIMIT 1");
    db.transaction(() => {
      for (const u of usersNoEmail) {
        const addr = getAddr.get(u.id) as { address: string } | undefined;
        const local = addr ? addr.address.split("@")[0]! : u.username;
        const email = `${local}@mynig.ga`;
        updateEmail.run(email, u.id);
      }
    })();
  }
}

// Create unique index on email (if not exists)
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
} catch { /* index already exists */ }

// Migration: make password_hash nullable (needed for passwordless registration flow)
{
  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string; notnull: number }[];
  const pwCol = cols.find(c => c.name === 'password_hash');
  if (pwCol && pwCol.notnull === 1) {
    // Only copy columns that exist in new schema
    const keepCols = ['id', 'username', 'password_hash', 'role', 'created_at', 'updated_at', 'code_id', 'email'];
    const existingKeep = keepCols.filter(c => cols.some(col => col.name === c));
    const colList = existingKeep.join(', ');

    // Must disable FK checks to drop+recreate table with references
    db.pragma('foreign_keys = OFF');
    db.exec('DROP TABLE IF EXISTS users_new');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT,
          role TEXT NOT NULL DEFAULT 'user',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          code_id INTEGER REFERENCES access_codes(id),
          email TEXT
        );
      `);
      db.exec(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users`);
      db.exec(`DROP TABLE users`);
      db.exec(`ALTER TABLE users_new RENAME TO users`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    })();
    db.pragma('foreign_keys = ON');
    console.log('[db] migrated users.password_hash to nullable');
  }
}

// Add size column to emails table (for storage accounting)
try {
  db.exec(`ALTER TABLE emails ADD COLUMN size INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists */ }

// Add s3_key column to email_attachments (NULL = legacy BLOB, non-NULL = S3-backed)
try {
  db.exec(`ALTER TABLE email_attachments ADD COLUMN s3_key TEXT`);
} catch { /* column already exists */ }

// ── Cloud Storage (S3-backed files) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS cloud_files (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cloud_files_user ON cloud_files(user_id);
`);

// ── Promo Codes ──
db.exec(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    value REAL NOT NULL,
    sub_tier TEXT,
    max_uses INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 0,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS promo_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_code TEXT NOT NULL REFERENCES promo_codes(code),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    used_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_promo_uses_user ON promo_uses(user_id, promo_code);
`);

// Add promo_code column to payments
try {
  db.exec(`ALTER TABLE payments ADD COLUMN promo_code TEXT`);
} catch { /* column already exists */ }

// ── AI Token Usage Tracking ──
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id);
`);

// ── Chess Games ──
db.exec(`
  CREATE TABLE IF NOT EXISTS chess_games (
    id TEXT PRIMARY KEY,
    white_token TEXT NOT NULL,
    black_token TEXT,
    white_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    black_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    white_name TEXT NOT NULL DEFAULT 'Anonymous',
    black_name TEXT,
    status TEXT NOT NULL DEFAULT 'waiting',
    fen TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn TEXT NOT NULL DEFAULT '',
    moves TEXT NOT NULL DEFAULT '[]',
    result TEXT,
    result_reason TEXT,
    draw_offer_by TEXT,
    is_bot INTEGER NOT NULL DEFAULT 0,
    bot_level INTEGER,
    time_control INTEGER,
    white_time_left REAL,
    black_time_left REAL,
    last_move_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chess_status ON chess_games(status);
`);

// Add body_html column to emails for proper HTML email rendering
try {
  db.exec(`ALTER TABLE emails ADD COLUMN body_html TEXT`);
} catch { /* column already exists */ }

// ── Cloud Shares (public file sharing) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS cloud_shares (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES cloud_files(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    downloads INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cloud_shares_file ON cloud_shares(file_id);
  CREATE INDEX IF NOT EXISTS idx_cloud_shares_user ON cloud_shares(user_id);
  CREATE INDEX IF NOT EXISTS idx_cloud_shares_expires ON cloud_shares(expires_at);
`);

// Add password_hash to cloud_shares
try {
  db.exec(`ALTER TABLE cloud_shares ADD COLUMN password_hash TEXT`);
} catch { /* column already exists */ }

// Seed cloud share expiry default
db.prepare(`INSERT OR IGNORE INTO global_settings (key, value) VALUES ('cloud_share_expiry_days', '7')`).run();

export default db;
