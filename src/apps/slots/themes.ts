export interface SlotTheme {
  id: string;
  label: string;
  icon: string;
  symbols: readonly string[];
  symbolMap: Record<string, string>;
  jackpot: string;
  premium1: string;
  premium2: string;
  premium3: string;
  mid1: string;
  mid2: string;
  filler1: string;
  filler2: string;
  scatter: string;
  accent: string;
  accentRgb: string;
  winColor: string;
  jackpotColor: string;
  winParticles: string[];
  jackpotParticles: string[];
}

const CLASSIC: SlotTheme = {
  id: "classic",
  label: "CLASSIC",
  icon: "🎰",
  symbols: ["skull", "fire", "diamond", "seven", "cherry", "lemon", "coin", "poop", "star"],
  symbolMap: {
    skull: "💀", fire: "🔥", diamond: "💎", seven: "7️⃣",
    cherry: "🍒", lemon: "🍋", coin: "🪙", poop: "💩", star: "⭐",
  },
  jackpot: "seven", premium1: "diamond", premium2: "skull", premium3: "fire",
  mid1: "cherry", mid2: "coin", filler1: "lemon", filler2: "poop", scatter: "star",
  accent: "#8b5cf6", accentRgb: "139, 92, 246",
  winColor: "#22c55e", jackpotColor: "#fbbf24",
  winParticles: ["✨", "⭐", "💰", "🪙"],
  jackpotParticles: ["✨", "⭐", "💰", "🔥", "💎", "👑", "🎰", "💵", "7️⃣"],
};

export function getTheme(_id: string): SlotTheme {
  return CLASSIC;
}
