import type { ThemeColors } from "@/types/terminal";

export const SYSTEM_VERSION = "1.0.0";
export const SYSTEM_NAME = "mynigga";
export const HOSTNAME = "mynigga";

export const MAX_INPUT_LENGTH = 1024;
export const MAX_HISTORY = 500;
export const MAX_CMD_HISTORY = 100;
export const AUTH_MAX_ATTEMPTS = 5;
export const AUTH_LOCKOUT_MS = 30_000;

export const THEMES: Record<string, ThemeColors> = {
  claude: {
    accent: "#DA7756",
    accentSoft: "rgba(218,119,86,0.10)",
    accentMid: "rgba(218,119,86,0.25)",
  },
  violet: {
    accent: "#c084fc",
    accentSoft: "rgba(192,132,252,0.10)",
    accentMid: "rgba(192,132,252,0.25)",
  },
  blue: {
    accent: "#60a5fa",
    accentSoft: "rgba(96,165,250,0.10)",
    accentMid: "rgba(96,165,250,0.25)",
  },
  emerald: {
    accent: "#34d399",
    accentSoft: "rgba(52,211,153,0.10)",
    accentMid: "rgba(52,211,153,0.25)",
  },
  amber: {
    accent: "#fbbf24",
    accentSoft: "rgba(251,191,36,0.10)",
    accentMid: "rgba(251,191,36,0.25)",
  },
  rose: {
    accent: "#fb7185",
    accentSoft: "rgba(251,113,133,0.10)",
    accentMid: "rgba(251,113,133,0.25)",
  },
  sky: {
    accent: "#38bdf8",
    accentSoft: "rgba(56,189,248,0.10)",
    accentMid: "rgba(56,189,248,0.25)",
  },
  dracula: {
    accent: "#bd93f9",
    accentSoft: "rgba(189,147,249,0.10)",
    accentMid: "rgba(189,147,249,0.25)",
    bgPrimary: "#282a36",
    bgSurface: "#1e1f29",
    bgElevated: "#343746",
    textPrimary: "#f8f8f2",
    textSecondary: "#9facc0",
    textMuted: "#6272a4",
    textGhost: "#44475a",
    borderSubtle: "rgba(189,147,249,0.08)",
    borderMedium: "rgba(189,147,249,0.18)",
    error: "#ff5555",
    success: "#50fa7b",
  },
  gruvbox: {
    accent: "#fe8019",
    accentSoft: "rgba(254,128,25,0.10)",
    accentMid: "rgba(254,128,25,0.25)",
    bgPrimary: "#1d2021",
    bgSurface: "#282828",
    bgElevated: "#3c3836",
    textPrimary: "#ebdbb2",
    textSecondary: "#a89984",
    textMuted: "#665c54",
    textGhost: "#504945",
    borderSubtle: "rgba(254,128,25,0.08)",
    borderMedium: "rgba(254,128,25,0.18)",
    error: "#fb4934",
    success: "#b8bb26",
  },
  nord: {
    accent: "#88c0d0",
    accentSoft: "rgba(136,192,208,0.10)",
    accentMid: "rgba(136,192,208,0.25)",
    bgPrimary: "#2e3440",
    bgSurface: "#272c36",
    bgElevated: "#3b4252",
    textPrimary: "#eceff4",
    textSecondary: "#a3b4c8",
    textMuted: "#616e88",
    textGhost: "#4c566a",
    borderSubtle: "rgba(136,192,208,0.08)",
    borderMedium: "rgba(136,192,208,0.18)",
    error: "#bf616a",
    success: "#a3be8c",
  },
  catppuccin: {
    accent: "#cba6f7",
    accentSoft: "rgba(203,166,247,0.10)",
    accentMid: "rgba(203,166,247,0.25)",
    bgPrimary: "#1e1e2e",
    bgSurface: "#181825",
    bgElevated: "#313244",
    textPrimary: "#cdd6f4",
    textSecondary: "#a6adc8",
    textMuted: "#585b70",
    textGhost: "#45475a",
    borderSubtle: "rgba(203,166,247,0.08)",
    borderMedium: "rgba(203,166,247,0.18)",
    error: "#f38ba8",
    success: "#a6e3a1",
  },
};

export const DEFAULT_THEME = THEMES.claude!;
