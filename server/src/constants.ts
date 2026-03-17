// Shared constants across routes

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DATA_DIR = resolve(__dirname, '..', 'data');
export const TRANSFERS_DIR = resolve(DATA_DIR, 'transfers');

/** Read a numeric setting from global_settings with a fallback default */
export function getSetting(key: string, fallback: number): number {
  const row = db.prepare("SELECT value FROM global_settings WHERE key = ?").get(key) as { value: string } | undefined;
  const val = parseFloat(row?.value ?? '');
  return isNaN(val) ? fallback : val;
}

/** Read a string setting from global_settings with a fallback default */
export function getStringSetting(key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM global_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

/** Storage limits per role (bytes). 0 = unlimited. Reads from DB with defaults. */
export function getStorageLimits(): Record<string, number> {
  return {
    admin: getSetting('storage_admin_mb', 0) * 1024 * 1024,
    club: getSetting('storage_club_mb', 500) * 1024 * 1024,
    classic: getSetting('storage_classic_mb', 500) * 1024 * 1024,
    user: getSetting('storage_user_mb', 500) * 1024 * 1024,
    guest: getSetting('storage_guest_mb', 50) * 1024 * 1024,
  };
}

export function getEffectiveLimit(role: string, bonusBytes: number): number {
  const limits = getStorageLimits();
  const base = limits[role] ?? limits['guest']!;
  if (base === 0) return 0;
  return Math.max(0, base + bonusBytes);
}

/** Per-link transfer max size in bytes by role */
export function getTransferMaxSize(role: string): number {
  const map: Record<string, number> = {
    admin: 50 * 1024 * 1024 * 1024,   // 50 GB
    club: 2 * 1024 * 1024 * 1024,     // 2 GB
    classic: 1024 * 1024 * 1024,       // 1 GB
    user: 1024 * 1024 * 1024,          // 1 GB
    guest: 512 * 1024 * 1024,          // 512 MB
  };
  return map[role] ?? map['guest']!;
}

/** Default free mail slots per role. 0 = none. */
export function getDefaultMailSlots(role: string): number {
  const map: Record<string, [string, number]> = {
    admin:   ['mail_slots_admin', 10],
    club:    ['mail_slots_club', 5],
    classic: ['mail_slots_classic', 3],
    user:    ['mail_slots_user', 1],
    guest:   ['mail_slots_guest', 0],
    code:    ['mail_slots_guest', 0],
  };
  const entry = map[role] ?? map['guest']!;
  return getSetting(entry[0], entry[1]);
}
