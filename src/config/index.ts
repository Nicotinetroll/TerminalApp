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
};

export const DEFAULT_THEME = THEMES.claude!;
