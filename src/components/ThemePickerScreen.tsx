import { useState, useCallback } from "react";
import { THEMES } from "@/config";
import type { ThemeColors } from "@/types/terminal";
import { AuthLogo } from "@/components/AuthLogo";
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

function applyThemeToRoot(theme: ThemeColors) {
  const root = document.documentElement;
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-soft", theme.accentSoft);
  root.style.setProperty("--accent-mid", theme.accentMid);
  const map: Record<string, string | undefined> = {
    "--bg-primary": theme.bgPrimary,
    "--bg-surface": theme.bgSurface,
    "--bg-elevated": theme.bgElevated,
    "--text-primary": theme.textPrimary,
    "--text-secondary": theme.textSecondary,
    "--text-muted": theme.textMuted,
    "--text-ghost": theme.textGhost,
    "--border-subtle": theme.borderSubtle,
    "--border-medium": theme.borderMedium,
    "--error": theme.error,
    "--success": theme.success,
  };
  const defaults: Record<string, string> = {
    "--bg-primary": "#0a0a12", "--bg-surface": "#0e0e18", "--bg-elevated": "#14141f",
    "--text-primary": "#e8ecf4", "--text-secondary": "#9aa4b8", "--text-muted": "#586880",
    "--text-ghost": "#354055", "--border-subtle": "rgba(255,255,255,0.06)",
    "--border-medium": "rgba(255,255,255,0.12)", "--error": "#f87171", "--success": "#34d399",
  };
  for (const [prop, val] of Object.entries(map)) {
    root.style.setProperty(prop, val ?? defaults[prop]!);
  }
}

interface Props {
  userId: string;
  onComplete: () => void;
}

export function ThemePickerScreen({ userId, onComplete }: Props) {
  const [selected, setSelected] = useState("claude");

  const handleSelect = useCallback((name: string) => {
    setSelected(name);
    const theme = THEMES[name];
    if (theme) applyThemeToRoot(theme);
  }, []);

  const handleConfirm = useCallback(() => {
    const theme = THEMES[selected];
    if (theme) {
      localStorage.setItem("mynigga-theme", JSON.stringify(theme));
      localStorage.setItem(`mynigga-theme-name:${userId}`, selected);
    }
    localStorage.setItem("mynigga-theme-chosen", "1");
    onComplete();
  }, [selected, userId, onComplete]);

  const handleSkip = useCallback(() => {
    localStorage.setItem("mynigga-theme-chosen", "1");
    onComplete();
  }, [onComplete]);

  const quip = THEME_QUIPS[selected] ?? "";

  return (
    <div className="auth-page">
      <div className="auth-card theme-picker-card">
        <AuthLogo />
        <h2 className="theme-picker-title">pick your vibe</h2>
        <p className="theme-picker-sub">you can change this anytime with the <code>theme</code> command</p>

        <ThemeSwatchGrid selected={selected} onSelect={handleSelect} />

        <div className="theme-picker-quip" key={selected}>{quip}</div>

        <div className="theme-picker-footer">
          <button className="auth-btn theme-picker-confirm" onClick={handleConfirm}>
            lock it in
          </button>
          <button className="theme-picker-skip" onClick={handleSkip}>
            skip
          </button>
        </div>
      </div>
    </div>
  );
}
