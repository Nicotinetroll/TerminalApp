import { useState, useCallback } from "react";
import { THEMES } from "@/config";
import type { WindowContentProps, ThemeColors } from "@/types/terminal";
import { ThemeSwatchGrid } from "@/components/ThemeSwatchGrid";

const THEME_QUIPS: Record<string, string> = {
  claude: "the default. you're not like other girls.",
  violet: "purple reign.",
  blue: "feeling blue? nah, looking blue.",
  emerald: "green with envy.",
  amber: "caution: drip ahead.",
  rose: "romantic terminal energy.",
  sky: "cloud district vibes.",
  dracula: "I vant to suck your... bandwidth.",
  gruvbox: "retro hipster detected.",
  nord: "scandinavian minimalism. ikea terminal.",
  catppuccin: "meow.",
  solarized: "ethan schoonover would be proud. maybe.",
  tokyonight: "shibuya crossing at 2am.",
  matrix: "you chose the green pill.",
  hacker: "I'm in. *cracks knuckles*",
  synthwave: "it's 1984 and you're in a lamborghini.",
  midnight: "3am coding session aesthetic.",
  sunset: "golden hour, every hour.",
  blood: "who hurt you?",
  mono: "50 shades of gray but make it terminal.",
  cyberpunk: "wake up, samurai.",
  satan: "hail santa... wait.",
  abyss: "stare long enough and it stares back.",
  toxic: "radioactive drip.",
  void: "into the void we go. again.",
  ocean: "deep end energy.",
  gold: "midas touched your terminal.",
  bubblegum: "pop.",
  ice: "cold as your ex's heart.",
  neon: "magenta is a lifestyle.",
  forest: "touch grass, but make it aesthetic.",
  retro: "CRT glow hits different.",
  lavender: "soft. gentle. still judging you.",
  light: "brave. foolish, but brave.",
};

interface Props extends WindowContentProps {
  setTheme: (t: ThemeColors) => void;
}

function detectCurrentTheme(): string {
  try {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const match = Object.entries(THEMES).find(([, t]) => t.accent === accent);
    return match?.[0] ?? "claude";
  } catch { return "claude"; }
}

export function ThemePickerPanel({ setTheme, closeWindow }: Props) {
  const [selected, setSelected] = useState(detectCurrentTheme);

  const handleSelect = useCallback((name: string) => {
    const theme = THEMES[name];
    if (!theme) return;
    setSelected(name);
    setTheme(theme);
  }, [setTheme]);

  const quip = THEME_QUIPS[selected] ?? "";

  return (
    <div className="theme-panel">
      <div className="theme-panel-header">
        <span className="theme-panel-title">pick your vibe</span>
        <span className="theme-panel-sub">click to apply instantly</span>
      </div>

      <ThemeSwatchGrid selected={selected} onSelect={handleSelect} />

      {quip && <div className="theme-panel-quip" key={selected}>{quip}</div>}

      <button className="theme-panel-done" onClick={closeWindow}>done</button>
    </div>
  );
}
