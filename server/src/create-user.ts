import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '..', '.env');

try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env not required for create-user if env vars are set externally
}

import bcrypt from 'bcryptjs';
import db from './db.js';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Usage: npx tsx src/create-user.ts <username> <password> [role]');
  process.exit(1);
}

const username = args[0];
const password = args[1];
const role = args[2] || 'admin';

try {
  const passwordHash = bcrypt.hashSync(password, 10);

  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role)
    VALUES (?, ?, ?)
  `);

  const insertFilesystem = db.prepare(`
    INSERT INTO user_filesystems (user_id, filesystem)
    VALUES (?, '{}')
  `);

  const insertSettings = db.prepare(`
    INSERT INTO user_settings (user_id, theme_name, command_history)
    VALUES (?, 'claude', '[]')
  `);

  const createUser = db.transaction(() => {
    const result = insertUser.run(username, passwordHash, role);
    const userId = result.lastInsertRowid;
    insertFilesystem.run(userId);
    insertSettings.run(userId);
    return userId;
  });

  const userId = createUser();
  console.log(`User created successfully:`);
  console.log(`  ID:       ${userId}`);
  console.log(`  Username: ${username}`);
  console.log(`  Role:     ${role}`);
} catch (err: unknown) {
  if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
    console.error(`Error: Username "${username}" already exists.`);
  } else {
    console.error('Error creating user:', err);
  }
  process.exit(1);
}
