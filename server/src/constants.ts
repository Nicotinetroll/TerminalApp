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
    premium: getSetting('storage_premium_mb', 30720) * 1024 * 1024,
    basic: getSetting('storage_basic_mb', 10240) * 1024 * 1024,
  };
}

export function getEffectiveLimit(role: string, bonusBytes: number): number {
  const limits = getStorageLimits();
  const base = limits[role] ?? limits['basic'] ?? 10240 * 1024 * 1024;
  if (base === 0) return 0;
  return Math.max(0, base + bonusBytes);
}

/** Per-link transfer max size in bytes by role. Reads from global_settings. */
export function getTransferMaxSize(role: string): number {
  return {
    admin: getSetting('transfer_size_admin_mb', 51200) * 1024 * 1024,
    premium: getSetting('transfer_size_premium_mb', 5120) * 1024 * 1024,
    basic: getSetting('transfer_size_basic_mb', 1024) * 1024 * 1024,
  }[role] ?? getSetting('transfer_size_basic_mb', 1024) * 1024 * 1024;
}

/** Default free mail slots per role. 0 = none. */
export function getDefaultMailSlots(role: string): number {
  const map: Record<string, [string, number]> = {
    admin:  ['mail_slots_admin', 10],
    premium: ['mail_slots_premium', 10],
    basic:  ['mail_slots_basic', 3],
  };
  const entry = map[role] ?? map['basic']!;
  return getSetting(entry[0], entry[1]);
}
