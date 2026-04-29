import { useState, useCallback, useRef, useEffect } from "react";
import type { User, ThemeColors, HistoryEntry, CommandResult, TerminalAPI, FileSystemNode, FullscreenConfig } from "@/types/terminal";
import { createDefaultFS } from "@/core/filesystem";
import { resolve as resolveCmd } from "@/core/commandRegistry";
import { registerAllCommands } from "@/commands";
import { sanitizeInput, sanitizeArgs } from "@/core/security";
import { parseArgs, getHomePath, emailLocalPart } from "@/core/utils";
import { DEFAULT_THEME, MAX_HISTORY, MAX_INPUT_LENGTH, THEMES } from "@/config";
import { useDataSync } from "./useDataSync";
import { useWindowManager } from "./useWindowManager";

let commandsRegistered = false;

function loadCachedTheme(userId: string | null): ThemeColors {
  try {
    // Try user-specific cache first
    if (userId) {
      const name = localStorage.getItem(`mynigga-theme-name:${userId}`);
      if (name) {
        const t = THEMES[name];
        if (t) return t;
      }
    }
    // Fallback to legacy global cache
    const cached = localStorage.getItem("mynigga-theme");
    if (cached) {
      const parsed = JSON.parse(cached) as ThemeColors;
      if (parsed.accent) return parsed;
    }
  } catch { /* */ }
  return DEFAULT_THEME;
}

function getCachedThemeName(userId: string | null): string {
  try {
    if (userId) {
      const name = localStorage.getItem(`mynigga-theme-name:${userId}`);
      if (name && THEMES[name]) return name;
    }
    // Match the random theme picked for this session
    const random = sessionStorage.getItem('mynigga-random-theme');
    if (random && THEMES[random]) return random;
  } catch { /* */ }
  return "claude";
}

export function useTerminal(user: User, userId: string | null, onLogout: () => void) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cwd, setCwd] = useState(() => getHomePath(user.email));
  const [theme, setTheme] = useState<ThemeColors>(() => loadCachedTheme(userId));
  const [isProcessing, setIsProcessing] = useState(false);
  const [fullscreenApp, setFullscreenApp] = useState<FullscreenConfig | null>(null);
  const [fsReady, setFsReady] = useState(false);
  const windowManager = useWindowManager();
  const fsRef = useRef<FileSystemNode>(createDefaultFS(emailLocalPart(user.email)));
  const idCounter = useRef(0);
  const cmdHistoryRef = useRef<string[]>([]);
  const themeNameRef = useRef(getCachedThemeName(userId));
  const dataLoaded = useRef(false);

  if (!commandsRegistered) {
    registerAllCommands();
    commandsRegistered = true;
  }

  const getThemeName = useCallback(() => themeNameRef.current, []);

  const { scheduleSave, loadUserData, resolveTheme } = useDataSync(
    userId,
    fsRef,
    getThemeName,
    cmdHistoryRef
  );

  // Track theme name when theme changes + cache for instant reload
  const setThemeWithTracking = useCallback(
    (newTheme: ThemeColors) => {
      setTheme(newTheme);
      const name = Object.entries(THEMES).find(
        ([, t]) => t.accent === newTheme.accent
      )?.[0];
      if (name) themeNameRef.current = name;
      try {
        // Per-user cache (primary) + legacy global cache (for index.html pre-apply)
        localStorage.setItem("mynigga-theme", JSON.stringify(newTheme));
        if (name && userId) localStorage.setItem(`mynigga-theme-name:${userId}`, name);
      } catch { /* */ }
      scheduleSave();
    },
    [scheduleSave, userId]
  );

  // Load user data on mount
  useEffect(() => {
    if (dataLoaded.current || !userId) return;
    dataLoaded.current = true;

    void loadUserData().then((data) => {
      if (data.filesystem && data.filesystem.type === "directory" && data.filesystem.children) {
        fsRef.current = data.filesystem;
      }
      if (data.commandHistory.length > 0) {
        cmdHistoryRef.current = data.commandHistory;
      }
      const resolvedTheme = resolveTheme(data.themeName);
      if (resolvedTheme) {
        setTheme(resolvedTheme);
        if (data.themeName) themeNameRef.current = data.themeName;
        try {
          localStorage.setItem("mynigga-theme", JSON.stringify(resolvedTheme));
          if (data.themeName && userId) localStorage.setItem(`mynigga-theme-name:${userId}`, data.themeName);
        } catch { /* */ }
      }
      setFsReady(true);
    });
  }, [userId, loadUserData, resolveTheme]);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const print = useCallback((result: CommandResult) => {
    setHistory((prev) => {
      const entry: HistoryEntry = {
        id: ++idCounter.current,
        command: "",
        result,
        cwd: "",
      };
      const next = [...prev, entry];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
  }, []);

  const execute = useCallback(async (raw: string) => {
    const input = sanitizeInput(raw, MAX_INPUT_LENGTH);
    if (!input) return;

    const parts = parseArgs(input);
    const cmdName = parts[0];
    if (!cmdName) return;

    const args = sanitizeArgs(parts.slice(1));

    const api: TerminalAPI = {
      user,
      cwd,
      setCwd,
      setTheme: setThemeWithTracking,
      fs: fsRef.current,
      clearHistory,
      print,
      logout: onLogout,
      openWindow: windowManager.openWindow,
      openFullscreen: setFullscreenApp,
    };

    const cmd = resolveCmd(cmdName);
    let result: CommandResult;

    if (!cmd) {
      result = { text: `${cmdName}: command not found`, isError: true };
    } else {
      setIsProcessing(true);
      try {
        result = await Promise.resolve(cmd.run(args, api));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        result = { text: msg, isError: true };
      } finally {
        setIsProcessing(false);
      }
    }

    // don't add entry for clear (history was already wiped)
    if (result.text === "" && !result.blocks && !result.isError) {
      scheduleSave();
      return;
    }

    setHistory((prev) => {
      const entry: HistoryEntry = {
        id: ++idCounter.current,
        command: input,
        result,
        cwd,
      };
      const next = [...prev, entry];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });

    scheduleSave();
  }, [user, cwd, clearHistory, print, onLogout, setThemeWithTracking, scheduleSave, windowManager.openWindow, setFullscreenApp]);

  const closeFullscreen = useCallback(() => setFullscreenApp(null), []);

  return {
    history,
    cwd,
    theme,
    isProcessing,
    execute,
    clearHistory,
    print,
    fs: fsRef.current,
    fsReady,
    cmdHistoryRef,
    windowManager,
    fullscreenApp,
    closeFullscreen,
  };
}
