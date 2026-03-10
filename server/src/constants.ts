// Shared constants across routes

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DATA_DIR = resolve(__dirname, '..', 'data');
export const TRANSFERS_DIR = resolve(DATA_DIR, 'transfers');

// Storage limits per role (bytes). 0 = unlimited
export const STORAGE_LIMITS: Record<string, number> = {
  admin: 0,
  club: 500 * 1024 * 1024,    // 500 MB
  user: 500 * 1024 * 1024,    // 500 MB
  guest: 50 * 1024 * 1024,    // 50 MB
};

export function getEffectiveLimit(role: string, bonusBytes: number): number {
  const base = STORAGE_LIMITS[role] ?? STORAGE_LIMITS['guest']!;
  if (base === 0) return 0;
  return Math.max(0, base + bonusBytes);
}
