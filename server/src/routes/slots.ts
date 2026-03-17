import { Router } from 'express';
import type { Response } from 'express';
import db from '../db.js';
import { authMiddleware, adminMiddleware } from '../middleware.js';
import type { AuthRequest } from '../middleware.js';
import { broadcastEvent } from '../socket.js';
import { getEffectiveLimit } from '../constants.js';

const router = Router();

// ── Theme system ──
// All themes share the same weight distribution and multiplier tiers.
// Only the symbol keys and scatter symbol differ.

interface ThemeConfig {
  symbols: readonly string[];
  jackpot: string;    premium1: string;   premium2: string;   premium3: string;
  mid1: string;       mid2: string;       filler1: string;    filler2: string;
  scatter: string;
}

const THEME_CONFIGS: Record<string, ThemeConfig> = {
  classic: {
    symbols: ['skull', 'fire', 'diamond', 'seven', 'cherry', 'lemon', 'coin', 'poop', 'star'],
    jackpot: 'seven', premium1: 'diamond', premium2: 'skull', premium3: 'fire',
    mid1: 'cherry', mid2: 'coin', filler1: 'lemon', filler2: 'poop', scatter: 'star',
  },
  neon: {
    symbols: ['robot', 'disc', 'globe', 'floppy', 'bolt', 'alien', 'orb', 'game', 'spiral'],
    jackpot: 'robot', premium1: 'disc', premium2: 'globe', premium3: 'floppy',
    mid1: 'bolt', mid2: 'alien', filler1: 'orb', filler2: 'game', scatter: 'spiral',
  },
  hell: {
    symbols: ['devil', 'flame', 'bone', 'ogre', 'bat', 'candle', 'chain', 'blood', 'skull2'],
    jackpot: 'devil', premium1: 'flame', premium2: 'bone', premium3: 'ogre',
    mid1: 'bat', mid2: 'candle', filler1: 'chain', filler2: 'blood', scatter: 'skull2',
  },
  space: {
    symbols: ['ufo', 'rocket', 'et', 'star2', 'planet', 'comet', 'moon', 'scope', 'twinkle'],
    jackpot: 'ufo', premium1: 'rocket', premium2: 'et', premium3: 'star2',
    mid1: 'planet', mid2: 'comet', filler1: 'moon', filler2: 'scope', scatter: 'twinkle',
  },
  feast: {
    symbols: ['pizza', 'burger', 'taco', 'donut', 'drum', 'cake2', 'beer', 'fries', 'bday'],
    jackpot: 'pizza', premium1: 'burger', premium2: 'taco', premium3: 'donut',
    mid1: 'drum', mid2: 'cake2', filler1: 'beer', filler2: 'fries', scatter: 'bday',
  },
};

const VALID_BETS_MB = [1, 5, 10, 25];
const VALID_BETS_NB = [1, 2, 5, 10];

// ── Weighted reel strips ──
// Base weights per tier at 92% RTP (the "neutral" point).
// The RTP slider dynamically scales these weights AND payout amounts
// so it controls both win frequency and payout size — like real casinos.
//
// Higher RTP → premium symbols appear more often + payouts scale up
// Lower RTP  → fillers dominate + payouts scale down

type SymbolTier = Exclude<keyof ThemeConfig, 'symbols'>;

interface TierWeight {
  tier: SymbolTier;
  base: number;       // base weight at neutral RTP (92)
  group: 'winning' | 'filler' | 'neutral';  // how RTP scaling affects it
}

const TIER_WEIGHTS: TierWeight[] = [
  { tier: 'filler2',  base: 16, group: 'filler'  },  // trash tier
  { tier: 'filler1',  base: 14, group: 'filler'  },  // common filler
  { tier: 'mid1',     base: 14, group: 'winning'  },  // triple pays 5x
  { tier: 'mid2',     base: 12, group: 'winning'  },  // mid tier
  { tier: 'premium3', base: 12, group: 'winning'  },  // triple pays 8x
  { tier: 'premium2', base: 10, group: 'winning'  },  // pair pays 1x
  { tier: 'premium1', base: 8,  group: 'winning'  },  // pair pays 1.5x
  { tier: 'jackpot',  base: 7,  group: 'winning'  },  // jackpot symbol
  { tier: 'scatter',  base: 7,  group: 'neutral'  },  // free spins (unchanged)
];

const NEUTRAL_RTP = 92;

// ── RTP target (admin-configurable) ──
function getRTPTarget(): number {
  try {
    const row = db.prepare("SELECT value FROM global_settings WHERE key = 'slots_rtp_target'").get() as { value: string } | undefined;
    if (row) {
      const val = parseFloat(row.value);
      return Math.max(80, Math.min(99, val || 92));
    }
    return 92;
  } catch { return 92; }
}

// Compute scaled weights for a given RTP target.
// rtpRatio > 1 = generous (boost winning symbols, shrink fillers)
// rtpRatio < 1 = stingy  (boost fillers, shrink winning symbols)
function getScaledWeights(rtpTarget: number): { tier: SymbolTier; weight: number }[] {
  // How far from neutral, mapped to a scaling factor.
  // At RTP 80: ratio ≈ 0.70  → winning weights shrink 30%, fillers grow
  // At RTP 92: ratio = 1.00  → no change
  // At RTP 99: ratio ≈ 1.21  → winning weights grow 21%, fillers shrink
  const deviation = (rtpTarget - NEUTRAL_RTP) / (99 - NEUTRAL_RTP); // -1.7..+1.0
  const frequencyScale = Math.max(0.4, 1 + deviation * 0.45); // more aggressive scaling

  const scaled = TIER_WEIGHTS.map(tw => {
    let weight: number;
    if (tw.group === 'winning') {
      weight = tw.base * frequencyScale;
    } else if (tw.group === 'filler') {
      // Inverse: when winners go up, fillers go down (and vice versa)
      weight = tw.base * (2 - frequencyScale);
    } else {
      weight = tw.base; // scatter stays fixed
    }
    return { tier: tw.tier, weight: Math.max(1, weight) };
  });

  return scaled;
}

function weightedSymbol(theme: ThemeConfig, scaledWeights: { tier: SymbolTier; weight: number }[]): string {
  const total = scaledWeights.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const { tier, weight } of scaledWeights) {
    r -= weight;
    if (r <= 0) return theme[tier];
  }
  return theme.filler2;
}

// Payout scaling — secondary adjustment (~40% of the RTP effect).
// At neutral RTP (92) this returns 1.0.
function getPayoutFactor(rtpTarget: number): number {
  const deviation = (rtpTarget - NEUTRAL_RTP) / (99 - NEUTRAL_RTP);
  return Math.max(0.5, 1 + deviation * 0.25); // more aggressive payout scaling
}

// 5 paylines on a 3x3 grid  [col, row] pairs
const PAYLINES: { name: string; cells: [number, number][] }[] = [
  { name: 'middle',   cells: [[0,1], [1,1], [2,1]] },
  { name: 'top',      cells: [[0,0], [1,0], [2,0]] },
  { name: 'bottom',   cells: [[0,2], [1,2], [2,2]] },
  { name: 'diag ↘',   cells: [[0,0], [1,1], [2,2]] },
  { name: 'diag ↗',   cells: [[0,2], [1,1], [2,0]] },
];

// Tier-based multiplier lookup
function getSymbolTier(sym: string, theme: ThemeConfig): string {
  if (sym === theme.jackpot) return 'jackpot';
  if (sym === theme.premium1) return 'premium1';
  if (sym === theme.premium2) return 'premium2';
  if (sym === theme.premium3) return 'premium3';
  if (sym === theme.mid1) return 'mid1';
  if (sym === theme.mid2) return 'mid2';
  if (sym === theme.filler1) return 'filler1';
  if (sym === theme.filler2) return 'filler2';
  if (sym === theme.scatter) return 'scatter';
  return 'filler2';
}

// Multi-line combo: hitting multiple paylines multiplies total payout
// This creates the dopamine spikes — rare multi-line hits pay BIG
const COMBO_MULTIPLIERS = [0, 1, 1.5, 2.5, 4, 10]; // index = number of winning lines

function getLineMultiplier(syms: string[], theme: ThemeConfig): { multiplier: number; result: string } {
  const [a, b, c] = syms as [string, string, string];

  // Three of a kind — big payouts, these create the spikes
  if (a === b && b === c) {
    const tier = getSymbolTier(a, theme);
    switch (tier) {
      case 'jackpot':  return { multiplier: 50,  result: 'jackpot' };
      case 'premium1': return { multiplier: 25,  result: 'triple_premium1' };
      case 'premium2': return { multiplier: 15,  result: 'triple_premium2' };
      case 'premium3': return { multiplier: 10,  result: 'triple_premium3' };
      case 'mid1':
      case 'mid2':     return { multiplier: 5,   result: 'triple_match' };
      default:         return { multiplier: 3,   result: 'triple_match' };
    }
  }

  // Pair detection — only top premium symbols pay
  const pair = (a === b) ? a : (a === c) ? a : (b === c) ? b : null;
  if (pair) {
    const tier = getSymbolTier(pair, theme);
    switch (tier) {
      case 'jackpot':  return { multiplier: 3, result: 'pair_premium' };
      case 'premium1': return { multiplier: 2, result: 'pair_premium' };
      default: break;
    }
  }

  return { multiplier: 0, result: 'lose' };
}

function spinGrid(theme: ThemeConfig, scaledWeights: { tier: SymbolTier; weight: number }[]): string[][] {
  const grid: string[][] = [];
  for (let col = 0; col < 3; col++) {
    grid.push([
      weightedSymbol(theme, scaledWeights),
      weightedSymbol(theme, scaledWeights),
      weightedSymbol(theme, scaledWeights),
    ]);
  }
  return grid;
}

interface LineWin {
  line: number;
  line_name: string;
  symbols: string[];
  multiplier: number;
  result: string;
  payout_bytes: number;
}

function checkPaylines(grid: string[][], betBytes: number, payoutFactor: number, theme: ThemeConfig): LineWin[] {
  const wins: LineWin[] = [];
  for (let i = 0; i < PAYLINES.length; i++) {
    const pl = PAYLINES[i]!;
    const symbols = pl.cells.map(([col, row]) => grid[col!]![row!]!);
    const { multiplier, result } = getLineMultiplier(symbols, theme);
    if (multiplier > 0) {
      const adjustedPayout = Math.floor(betBytes * multiplier * payoutFactor);
      wins.push({
        line: i,
        line_name: pl.name,
        symbols,
        multiplier,
        result,
        payout_bytes: adjustedPayout,
      });
    }
  }
  return wins;
}

function hasNearMiss(grid: string[][], theme: ThemeConfig): boolean {
  for (const pl of PAYLINES) {
    const syms = pl.cells.map(([col, row]) => grid[col!]![row!]!);
    if ((syms[0] === syms[1] && syms[1] !== syms[2]) ||
        (syms[0] === syms[2] && syms[0] !== syms[1]) ||
        (syms[1] === syms[2] && syms[0] !== syms[1])) {
      const match = syms[0] === syms[1] ? syms[0]! : syms[1]!;
      const tier = getSymbolTier(match, theme);
      if (tier === 'mid1' || tier === 'mid2' || tier === 'premium3') {
        return true;
      }
    }
  }
  return false;
}

function countScatters(grid: string[][], scatterSym: string): number {
  let count = 0;
  for (const col of grid) {
    for (const sym of col) {
      if (sym === scatterSym) count++;
    }
  }
  return count;
}

function freeSpinsForScatters(count: number): number {
  if (count >= 5) return 12;
  if (count >= 4) return 8;
  if (count >= 3) return 5;
  return 0;
}

const WIN_MESSAGES = [
  "nice pull.",
  "cha-ching bitch.",
  "house is mad.",
  "clean hit.",
  "storage secured.",
  "lucky punk.",
  "W.",
  "ez money.",
  "get paid.",
  "not bad.",
];

const MULTI_WIN_MESSAGES = [
  "MULTI HIT.",
  "COMBO.",
  "absolute carnage.",
  "house is sweating.",
  "MULTI BANGER.",
];

const MEGA_COMBO_MESSAGES = [
  "MEGA COMBO.",
  "THE MACHINE IS CRYING.",
  "ABSOLUTE CARNAGE.",
  "WHAT THE FUCK.",
  "YOU BROKE IT.",
];

const JACKPOT_MESSAGES = [
  "JACKPOT.",
  "HOLY SHIT.",
  "JACKPOT BABY.",
  "THE CHOSEN ONE.",
  "BROOOO.",
];

const LOSE_MESSAGES = [
  "L.",
  "house wins.",
  "gone forever.",
  "played yourself.",
  "rip bozo.",
  "poof.",
  "skill issue.",
  "down bad.",
  "cope.",
  "lmaooo.",
  "not even close.",
  "tragic.",
  "pain.",
  "dust.",
  "bye bytes.",
  "oof.",
];

const PAIR_MESSAGES = [
  "pair hit.",
  "two matching.",
  "small w.",
  "nice pair.",
  "getting warmer.",
];

const NEAR_MISS_MESSAGES = [
  "so close.",
  "almost.",
  "one off.",
  "sike.",
  "tease.",
];

const BROKE_MESSAGES = [
  "you're broke.",
  "can't afford that.",
  "empty pockets.",
  "touch grass.",
  "stop gambling.",
];

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// ── Emoji Hunt bonus round ──

interface BonusState {
  type: 'emoji_hunt';
  symbol: string;       // internal symbol key (e.g. 'poop')
  tier: string;         // tier name
  multiplier: number;   // hunt multiplier per occurrence
  spins_remaining: number;
  spins_total: number;
  total_bonus: number;  // accumulated bonus payout (raw bytes or nb units)
  bet_mb: number;       // locked bet
  currency: string;     // locked currency
}

const BONUS_TRIGGER_CHANCE = 0.01;

// Lucky spin: random 1–20 duration, weighted toward lower numbers
function rollHuntDuration(): number {
  // Weighted: ~40% chance 1-5, ~35% chance 6-12, ~25% chance 13-20
  const r = Math.random();
  if (r < 0.40) return 1 + Math.floor(Math.random() * 5);    // 1-5
  if (r < 0.75) return 6 + Math.floor(Math.random() * 7);    // 6-12
  return 13 + Math.floor(Math.random() * 8);                  // 13-20
}

// Hunt multipliers per tier — nerfed so house doesn't bleed out
// Lower multipliers + fewer spins = still exciting but not a money printer
const HUNT_MULTIPLIERS: Record<string, number> = {
  filler2: 2,    // 💩 appears often → lower mult to compensate
  filler1: 1.5,  // 🍋 common filler
  mid1: 1,       // 🍒
  mid2: 1,       // 🪙
  premium3: 0.8, // 🔥
  premium2: 0.8, // 💀
  premium1: 0.5, // 💎 rare = less per hit
  jackpot: 0.5,  // 7️⃣
};

// Huntable tiers (weighted by how funny/satisfying they are)
const HUNTABLE_TIERS: { tier: string; weight: number }[] = [
  { tier: 'filler2', weight: 25 },  // 💩 hunt = comedy gold
  { tier: 'filler1', weight: 20 },
  { tier: 'mid1', weight: 15 },
  { tier: 'mid2', weight: 15 },
  { tier: 'premium3', weight: 10 },
  { tier: 'premium2', weight: 8 },
  { tier: 'premium1', weight: 5 },
  { tier: 'jackpot', weight: 2 },
];

function pickHuntTarget(): string {
  const total = HUNTABLE_TIERS.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const t of HUNTABLE_TIERS) {
    r -= t.weight;
    if (r <= 0) return t.tier;
  }
  return 'filler2';
}

// Emoji lookup map for backend (same as frontend themes)
const SYMBOL_EMOJI: Record<string, Record<string, string>> = {
  classic: {
    skull: '💀', fire: '🔥', diamond: '💎', seven: '7️⃣',
    cherry: '🍒', lemon: '🍋', coin: '🪙', poop: '💩', star: '⭐',
  },
};

function getEmojiForSymbol(theme: ThemeConfig, sym: string): string {
  // For now just classic theme
  return SYMBOL_EMOJI['classic']?.[sym] ?? '?';
}

function countSymbolInGrid(grid: string[][], sym: string): number {
  let count = 0;
  for (const col of grid) {
    for (const cell of col) {
      if (cell === sym) count++;
    }
  }
  return count;
}

function resolveTheme(themeId?: string): ThemeConfig {
  if (themeId && THEME_CONFIGS[themeId]) return THEME_CONFIGS[themeId]!;
  return THEME_CONFIGS['classic']!;
}

router.use(authMiddleware);

// GET /api/slots/balance
router.get('/balance', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  if (role === 'guest') {
    res.status(403).json({ error: "guests can't gamble. log in first, broke boy." });
    return;
  }

  const balance = db.prepare(
    'SELECT bonus_bytes, total_won, total_lost, spins, free_spins, bytebucks, bonus_state FROM slots_balance WHERE user_id = ?'
  ).get(userId) as { bonus_bytes: number; total_won: number; total_lost: number; spins: number; free_spins: number; bytebucks: number; bonus_state: string | null } | undefined;

  const bonusBytes = balance?.bonus_bytes ?? 0;
  const baseLimit = getEffectiveLimit(role, 0);
  const effectiveLimit = getEffectiveLimit(role, bonusBytes);

  const fsRow = db.prepare('SELECT filesystem FROM user_filesystems WHERE user_id = ?').get(userId) as
    | { filesystem: string } | undefined;
  const used = fsRow ? Buffer.byteLength(fsRow.filesystem, 'utf8') : 0;
  const availableBytes = baseLimit === 0 ? 999 * 1024 * 1024 : Math.max(0, effectiveLimit - used);

  const histStats = db.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN result != 'lose' THEN 1 ELSE 0 END) as wins FROM slots_history WHERE user_id = ?`
  ).get(userId) as { total: number; wins: number };
  const winRate = histStats.total > 0 ? histStats.wins / histStats.total : 0;

  // Parse active bonus for response
  let activeBonusInfo = null;
  if (balance?.bonus_state) {
    try {
      const bs = JSON.parse(balance.bonus_state) as BonusState;
      const theme = resolveTheme('classic');
      activeBonusInfo = {
        type: bs.type,
        symbol: bs.symbol,
        emoji: getEmojiForSymbol(theme, bs.symbol),
        tier: bs.tier,
        multiplier: bs.multiplier,
        spins_remaining: bs.spins_remaining,
        spins_total: bs.spins_total,
        total_bonus: bs.total_bonus,
        hits_this_spin: 0,
        hit_payout: 0,
        bet_mb: bs.bet_mb,
        currency: bs.currency,
      };
    } catch { /* invalid state, ignore */ }
  }

  res.json({
    bonus_bytes: bonusBytes,
    base_limit: baseLimit,
    effective_limit: effectiveLimit,
    used,
    available_to_bet: availableBytes,
    free_spins: balance?.free_spins ?? 0,
    niggabytes: balance?.bytebucks ?? 0,
    bonus: activeBonusInfo,
    stats: {
      total_won: balance?.total_won ?? 0,
      total_lost: balance?.total_lost ?? 0,
      spins: balance?.spins ?? 0,
      win_rate: winRate,
    },
  });
});

// POST /api/slots/spin
router.post('/spin', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  if (role === 'guest') {
    res.status(403).json({ error: "nice try freeloader. log in to gamble." });
    return;
  }

  const { bet_mb, theme: themeId, currency: currencyInput } = req.body as { bet_mb?: number; theme?: string; currency?: string };
  const currency = currencyInput === 'niggabytes' ? 'niggabytes' : 'storage';
  const validBets = currency === 'niggabytes' ? VALID_BETS_NB : VALID_BETS_MB;
  if (!bet_mb || !validBets.includes(bet_mb)) {
    res.status(400).json({ error: `invalid bet. choose one of: ${validBets.join(', ')} ${currency === 'niggabytes' ? 'NB' : 'MB'}` });
    return;
  }
  const theme = resolveTheme(themeId);
  const betBytes = bet_mb * 1024 * 1024;
  const rtpTarget = getRTPTarget();
  const scaledWeights = getScaledWeights(rtpTarget);
  const payoutFactor = getPayoutFactor(rtpTarget);

  // Entire spin in a transaction to prevent double-spend race conditions
  db.transaction(() => {

  const balance = db.prepare(
    'SELECT bonus_bytes, total_won, total_lost, spins, free_spins, bytebucks, bonus_state FROM slots_balance WHERE user_id = ?'
  ).get(userId) as { bonus_bytes: number; total_won: number; total_lost: number; spins: number; free_spins: number; bytebucks: number; bonus_state: string | null } | undefined;

  const bonusBytes = balance?.bonus_bytes ?? 0;
  const freeSpins = balance?.free_spins ?? 0;
  const currentNB = balance?.bytebucks ?? 0;
  const baseLimit = getEffectiveLimit(role, 0);
  const isFreeSpin = freeSpins > 0;

  // Parse active bonus state
  let activeBonus: BonusState | null = null;
  if (balance?.bonus_state) {
    try {
      activeBonus = JSON.parse(balance.bonus_state) as BonusState;
    } catch { activeBonus = null; }
  }

  // If bonus is active, enforce locked bet/currency
  // (frontend also enforces this, but backend is authoritative)
  const effectiveBet = activeBonus ? activeBonus.bet_mb : bet_mb;
  const effectiveCurrency = activeBonus ? activeBonus.currency : currency;
  const effectiveBetBytes = effectiveBet * 1024 * 1024;

  // Check affordability
  if (effectiveCurrency === 'niggabytes') {
    if (!isFreeSpin && !activeBonus && currentNB < effectiveBet) {
      res.status(400).json({ error: "not enough NiggaBytes. you're NB broke." });
      return;
    }
  } else if (!isFreeSpin && !activeBonus && baseLimit > 0) {
    const effectiveLimit = getEffectiveLimit(role, bonusBytes);
    const fsRow = db.prepare('SELECT filesystem FROM user_filesystems WHERE user_id = ?').get(userId) as
      | { filesystem: string } | undefined;
    const used = fsRow ? Buffer.byteLength(fsRow.filesystem, 'utf8') : 0;
    const available = Math.max(0, effectiveLimit - used);
    if (effectiveBetBytes > available) {
      res.status(400).json({ error: pickRandom(BROKE_MESSAGES) });
      return;
    }
  }

  // Spin the 3x3 grid (weights scaled by RTP target)
  const grid = spinGrid(theme, scaledWeights);

  // Check all 5 paylines (with RTP-adjusted payouts)
  const wins = checkPaylines(grid, effectiveBetBytes, payoutFactor, theme);
  const rawPayout = wins.reduce((sum, w) => sum + w.payout_bytes, 0);
  const comboMultiplier = wins.length >= 2 ? (COMBO_MULTIPLIERS[Math.min(wins.length, 5)] ?? 1) : 1;
  const totalPayout = Math.floor(rawPayout * comboMultiplier);
  const hasJackpot = wins.some(w => w.result === 'jackpot');

  // Check for scatter → free spins
  const scatterCount = countScatters(grid, theme.scatter);
  const freeSpinsAwarded = freeSpinsForScatters(scatterCount);

  // ── Bonus round: count hits & compute bonus payout ──
  let bonusHitsThisSpin = 0;
  let bonusHitPayout = 0;
  let bonusEnded = false;
  let bonusAwarded: BonusState | null = null;

  if (activeBonus) {
    // Count target symbol in the 3x3 grid
    bonusHitsThisSpin = countSymbolInGrid(grid, theme[activeBonus.tier as keyof ThemeConfig] as string);
    if (bonusHitsThisSpin > 0) {
      if (activeBonus.currency === 'niggabytes') {
        bonusHitPayout = Math.ceil(activeBonus.bet_mb * activeBonus.multiplier * bonusHitsThisSpin);
      } else {
        bonusHitPayout = Math.floor(effectiveBetBytes * activeBonus.multiplier * bonusHitsThisSpin);
      }
    }

    activeBonus.spins_remaining--;
    activeBonus.total_bonus += bonusHitPayout;

    if (activeBonus.spins_remaining <= 0) {
      bonusEnded = true;
    }
  }

  // Calculate new balance
  let newBonusBytes = bonusBytes;
  let newNB = currentNB;

  if (effectiveCurrency === 'niggabytes') {
    // NB mode: bet_mb treated as NB units
    if (isFreeSpin) {
      newNB = currentNB + (totalPayout > 0 ? Math.ceil((totalPayout / effectiveBetBytes) * effectiveBet) : 0);
    } else if (totalPayout > 0) {
      const nbWin = Math.ceil((totalPayout / effectiveBetBytes) * effectiveBet) - effectiveBet;
      newNB = currentNB + nbWin;
    } else {
      newNB = currentNB - effectiveBet;
    }
    // Add bonus hit payout (NB units)
    newNB += bonusHitPayout;
    newNB = Math.max(0, newNB);
  } else {
    if (isFreeSpin) {
      newBonusBytes = bonusBytes + totalPayout;
    } else if (totalPayout > 0) {
      newBonusBytes = bonusBytes + (totalPayout - effectiveBetBytes);
    } else {
      newBonusBytes = bonusBytes - effectiveBetBytes;
    }
    // Add bonus hit payout (bytes)
    newBonusBytes += bonusHitPayout;
  }

  const newFreeSpins = (isFreeSpin ? freeSpins - 1 : freeSpins) + freeSpinsAwarded;
  const newTotalWon = (balance?.total_won ?? 0) + totalPayout + bonusHitPayout;
  const newTotalLost = (balance?.total_lost ?? 0) + (totalPayout === 0 && !isFreeSpin && !activeBonus ? effectiveBetBytes : 0);
  const newSpins = (balance?.spins ?? 0) + 1;

  // ── Bonus trigger check ──
  // Only trigger if no active bonus, not in free spins
  if (!activeBonus && !isFreeSpin) {
    const randomTrigger = Math.random() < BONUS_TRIGGER_CHANCE;
    if (randomTrigger) {
      const huntTier = pickHuntTarget();
      const huntSymbol = theme[huntTier as keyof ThemeConfig] as string;
      const huntMultiplier = HUNT_MULTIPLIERS[huntTier] ?? 1;
      const huntDuration = rollHuntDuration();
      bonusAwarded = {
        type: 'emoji_hunt',
        symbol: huntSymbol,
        tier: huntTier,
        multiplier: huntMultiplier,
        spins_remaining: huntDuration,
        spins_total: huntDuration,
        total_bonus: 0,
        bet_mb: effectiveBet,
        currency: effectiveCurrency,
      };
    }
  }

  // Update or clear bonus state
  let newBonusState: string | null = null;
  if (bonusEnded) {
    newBonusState = null; // Clear — bonus is done
  } else if (activeBonus) {
    newBonusState = JSON.stringify(activeBonus); // Updated remaining
  } else if (bonusAwarded) {
    newBonusState = JSON.stringify(bonusAwarded); // New bonus starts
  }

  // Build message
  const isPairOnly = wins.length > 0 && wins.every(w => w.result === 'pair_premium' || w.result === 'pair_match');
  let message: string;
  if (hasJackpot) {
    message = pickRandom(JACKPOT_MESSAGES);
  } else if (freeSpinsAwarded > 0 && wins.length > 0) {
    message = `${freeSpinsAwarded} FREE + ${wins.length} lines.`;
  } else if (freeSpinsAwarded > 0) {
    message = `${freeSpinsAwarded} FREE SPINS.`;
  } else if (wins.length >= 3) {
    message = `${wins.length}x ${comboMultiplier}x ${pickRandom(MEGA_COMBO_MESSAGES)}`;
  } else if (wins.length > 1 && !isPairOnly) {
    message = `${wins.length}x ${comboMultiplier}x ${pickRandom(MULTI_WIN_MESSAGES)}`;
  } else if (wins.length > 1) {
    message = `${wins.length}x ${pickRandom(PAIR_MESSAGES)}`;
  } else if (wins.length === 1 && isPairOnly) {
    message = pickRandom(PAIR_MESSAGES);
  } else if (wins.length === 1) {
    message = pickRandom(WIN_MESSAGES);
  } else if (hasNearMiss(grid, theme)) {
    message = pickRandom(NEAR_MISS_MESSAGES);
  } else {
    message = pickRandom(LOSE_MESSAGES);
  }

  // Easter eggs
  if (newSpins === 69) message = "nice.";
  if (newSpins === 420) message = "blaze it.";
  if (newSpins === 666) message = "the devil spins.";
  if (newSpins === 1000) message = "get help.";
  // All same symbol — works for any theme
  const allFlat = grid.flat();
  if (allFlat.every(s => s === allFlat[0])) {
    if (allFlat[0] === theme.filler2) message = "ALL TRASH. impressive.";
    else if (allFlat[0] === theme.filler1) message = "9 of a kind. wtf.";
  }

  // Update DB
  db.prepare(`
    INSERT INTO slots_balance (user_id, bonus_bytes, total_won, total_lost, spins, free_spins, bytebucks, bonus_state, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      bonus_bytes = excluded.bonus_bytes,
      total_won = excluded.total_won,
      total_lost = excluded.total_lost,
      spins = excluded.spins,
      free_spins = excluded.free_spins,
      bytebucks = excluded.bytebucks,
      bonus_state = excluded.bonus_state,
      updated_at = excluded.updated_at
  `).run(userId, newBonusBytes, newTotalWon, newTotalLost, newSpins, newFreeSpins, newNB, newBonusState);

  const bestResult = hasJackpot ? 'jackpot' : wins.length > 0 ? 'win' : 'lose';

  db.prepare(`
    INSERT INTO slots_history (user_id, bet_bytes, result, payout_bytes, reels, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(userId, isFreeSpin ? 0 : effectiveBetBytes, bestResult, totalPayout + bonusHitPayout, JSON.stringify(grid));

  // Broadcast global events
  if (hasJackpot) {
    broadcastEvent({ type: 'jackpot', message: '🚨 someone just hit the JACKPOT. the house is crying rn' });
  } else if (wins.length >= 4) {
    broadcastEvent({ type: 'big_win', message: `🔥 someone just hit ${wins.length} lines (${comboMultiplier}x COMBO). absolute carnage.` });
  } else if (wins.length >= 3) {
    broadcastEvent({ type: 'big_win', message: `🔥 ${wins.length}-line combo just dropped. house is sweating.` });
  }

  const newEffectiveLimit = getEffectiveLimit(role, newBonusBytes);
  const fsRow2 = db.prepare('SELECT filesystem FROM user_filesystems WHERE user_id = ?').get(userId) as
    | { filesystem: string } | undefined;
  const usedNow = fsRow2 ? Buffer.byteLength(fsRow2.filesystem, 'utf8') : 0;

  const histStats2 = db.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN result != 'lose' THEN 1 ELSE 0 END) as wins FROM slots_history WHERE user_id = ?`
  ).get(userId) as { total: number; wins: number };
  const winRate = histStats2.total > 0 ? histStats2.wins / histStats2.total : 0;

  // Build bonus response object
  const bonusResponse = activeBonus ? {
    type: activeBonus.type,
    symbol: activeBonus.symbol,
    emoji: getEmojiForSymbol(theme, activeBonus.symbol),
    tier: activeBonus.tier,
    multiplier: activeBonus.multiplier,
    spins_remaining: activeBonus.spins_remaining,
    spins_total: activeBonus.spins_total,
    total_bonus: activeBonus.total_bonus,
    hits_this_spin: bonusHitsThisSpin,
    hit_payout: bonusHitPayout,
    bet_mb: activeBonus.bet_mb,
    currency: activeBonus.currency,
  } : null;

  // When bonus ends, send the final accumulated total (including last spin's hits)
  const bonusFinalResponse = bonusEnded && activeBonus ? {
    type: activeBonus.type,
    symbol: activeBonus.symbol,
    emoji: getEmojiForSymbol(theme, activeBonus.symbol),
    tier: activeBonus.tier,
    multiplier: activeBonus.multiplier,
    spins_remaining: 0,
    spins_total: activeBonus.spins_total,
    total_bonus: activeBonus.total_bonus,
    hits_this_spin: bonusHitsThisSpin,
    hit_payout: bonusHitPayout,
    bet_mb: activeBonus.bet_mb,
    currency: activeBonus.currency,
  } : null;

  const bonusAwardedResponse = bonusAwarded ? {
    type: bonusAwarded.type,
    symbol: bonusAwarded.symbol,
    emoji: getEmojiForSymbol(theme, bonusAwarded.symbol),
    tier: bonusAwarded.tier,
    multiplier: bonusAwarded.multiplier,
    spins_remaining: bonusAwarded.spins_remaining,
    spins_total: bonusAwarded.spins_total,
    total_bonus: 0,
    hits_this_spin: 0,
    hit_payout: 0,
    bet_mb: bonusAwarded.bet_mb,
    currency: bonusAwarded.currency,
  } : null;

  res.json({
    grid,
    wins: wins.map(w => ({
      line: w.line,
      line_name: w.line_name,
      symbols: w.symbols,
      multiplier: w.multiplier,
      payout_bytes: w.payout_bytes,
    })),
    total_payout_bytes: totalPayout,
    bet_bytes: isFreeSpin ? 0 : effectiveBetBytes,
    is_free_spin: isFreeSpin,
    free_spins_awarded: freeSpinsAwarded,
    free_spins_remaining: newFreeSpins,
    has_jackpot: hasJackpot,
    combo_multiplier: comboMultiplier,
    message,
    currency: effectiveCurrency,
    nb_balance: newNB,
    bonus: bonusEnded ? null : (bonusResponse ?? bonusAwardedResponse),
    bonus_awarded: bonusAwardedResponse,
    bonus_final: bonusFinalResponse,
    balance: {
      bonus_bytes: newBonusBytes,
      effective_limit: newEffectiveLimit,
      used: usedNow,
      available_to_bet: baseLimit === 0 ? 999 * 1024 * 1024 : Math.max(0, newEffectiveLimit - usedNow),
    },
    stats: {
      total_won: newTotalWon,
      total_lost: newTotalLost,
      spins: newSpins,
      win_rate: winRate,
    },
  });

  })(); // end spin transaction
});

// GET /api/slots/history
router.get('/history', (req: AuthRequest, res: Response): void => {
  const userId = req.user!.userId;

  const rows = db.prepare(
    'SELECT id, bet_bytes, result, payout_bytes, reels, created_at FROM slots_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(userId) as { id: number; bet_bytes: number; result: string; payout_bytes: number; reels: string; created_at: string }[];

  const history = rows.map(r => ({
    ...r,
    grid: JSON.parse(r.reels) as string[][],
  }));

  res.json({ history });
});

// ── Admin endpoints ──

// GET /api/slots/admin/players
router.get('/admin/players', adminMiddleware, (_req: AuthRequest, res: Response): void => {
  const rows = db.prepare(`
    SELECT
      u.id as user_id,
      u.username,
      u.role,
      COALESCE(sb.bonus_bytes, 0) as bonus_bytes,
      COALESCE(sb.total_won, 0) as total_won,
      COALESCE(sb.total_lost, 0) as total_lost,
      COALESCE(sb.spins, 0) as spins,
      COALESCE(sb.free_spins, 0) as free_spins,
      COALESCE(sh_stats.wins, 0) as wins,
      COALESCE(sh_stats.total, 0) as total_spins_hist
    FROM users u
    LEFT JOIN slots_balance sb ON sb.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
        COUNT(*) as total,
        SUM(CASE WHEN result != 'lose' THEN 1 ELSE 0 END) as wins
      FROM slots_history
      GROUP BY user_id
    ) sh_stats ON sh_stats.user_id = u.id
    WHERE COALESCE(sb.spins, 0) > 0
    ORDER BY COALESCE(sb.spins, 0) DESC
  `).all() as {
    user_id: number; username: string; role: string;
    bonus_bytes: number; total_won: number; total_lost: number;
    spins: number; free_spins: number; wins: number; total_spins_hist: number;
  }[];

  const players = rows.map(r => ({
    userId: r.user_id,
    username: r.username,
    role: r.role,
    bonus_bytes: r.bonus_bytes,
    total_won: r.total_won,
    total_lost: r.total_lost,
    spins: r.spins,
    free_spins: r.free_spins,
    win_rate: r.total_spins_hist > 0 ? r.wins / r.total_spins_hist : 0,
  }));

  res.json({ players });
});

// DELETE /api/slots/admin/reset/:userId
router.delete('/admin/reset/:userId', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const targetId = parseInt(req.params['userId'] as string, 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: 'invalid user id, genius.' });
    return;
  }

  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(targetId) as { username: string } | undefined;
  if (!user) {
    res.status(404).json({ error: 'user not found. they might have already rage-quit.' });
    return;
  }

  db.prepare(`
    INSERT INTO slots_balance (user_id, bonus_bytes, total_won, total_lost, spins, free_spins, bytebucks, bonus_state, updated_at)
    VALUES (?, 0, 0, 0, 0, 0, 0, NULL, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      bonus_bytes = 0, total_won = 0, total_lost = 0, spins = 0, free_spins = 0, bytebucks = 0, bonus_state = NULL, updated_at = datetime('now')
  `).run(targetId);

  db.prepare('DELETE FROM slots_history WHERE user_id = ?').run(targetId);

  res.json({ ok: true, message: `${user.username}'s casino career has been erased. clean slate, fresh degen.` });
});

// GET /api/slots/admin/config
router.get('/admin/config', adminMiddleware, (_req: AuthRequest, res: Response): void => {
  const rtpTarget = getRTPTarget();
  const payoutFactor = getPayoutFactor(rtpTarget);
  const houseEdge = (100 - rtpTarget).toFixed(1);
  const scaledWeights = getScaledWeights(rtpTarget);
  const totalWeight = scaledWeights.reduce((s, w) => s + w.weight, 0);
  const winningWeight = scaledWeights
    .filter(w => TIER_WEIGHTS.find(tw => tw.tier === w.tier)?.group === 'winning')
    .reduce((s, w) => s + w.weight, 0);

  res.json({
    rtp_target: rtpTarget,
    payout_factor: Math.round(payoutFactor * 1000) / 1000,
    house_edge: houseEdge,
    win_frequency: Math.round((winningWeight / totalWeight) * 1000) / 10,
    win_chance: rtpTarget,
  });
});

// PUT /api/slots/admin/config
router.put('/admin/config', adminMiddleware, (req: AuthRequest, res: Response): void => {
  const { rtp_target, win_chance } = req.body as { rtp_target?: number; win_chance?: number };
  const target = rtp_target ?? win_chance;

  if (typeof target !== 'number' || target < 80 || target > 99) {
    res.status(400).json({ error: 'rtp_target must be 80-99.' });
    return;
  }

  const rounded = Math.round(target * 10) / 10;

  db.prepare(
    `INSERT INTO global_settings (key, value, updated_at) VALUES ('slots_rtp_target', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(String(rounded));

  const houseEdge = (100 - rounded).toFixed(1);

  res.json({
    ok: true,
    rtp_target: rounded,
    house_edge: houseEdge,
    payout_factor: Math.round(getPayoutFactor(rounded) * 1000) / 1000,
  });
});

export default router;
