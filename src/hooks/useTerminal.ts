import { useState, useCallback, useRef, useEffect } from "react";
import type { User, ThemeColors, HistoryEntry, CommandResult, TerminalAPI, FileSystemNode } from "@/types/terminal";
import { createDefaultFS } from "@/core/filesystem";
import { resolve as resolveCmd } from "@/core/commandRegistry";
import { registerAllCommands } from "@/commands";
import { sanitizeInput, sanitizeArgs } from "@/core/security";
import { parseArgs, getHomePath } from "@/core/utils";
import { DEFAULT_THEME, MAX_HISTORY, MAX_INPUT_LENGTH, THEMES } from "@/config";
import { useDataSync } from "./useDataSync";
import { useWindowManager } from "./useWindowManager";

let commandsRegistered = false;

export function useTerminal(user: User, userId: string | null, onLogout: () => void) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cwd, setCwd] = useState(() => getHomePath(user.username));
  const [theme, setTheme] = useState<ThemeColors>(DEFAULT_THEME);
  const [isProcessing, setIsProcessing] = useState(false);
  const windowManager = useWindowManager();
  const fsRef = useRef<FileSystemNode>(createDefaultFS(user.username));
  const idCounter = useRef(0);
  const cmdHistoryRef = useRef<string[]>([]);
  const themeNameRef = useRef("claude");
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

  // Track theme name when theme changes
  const setThemeWithTracking = useCallback(
    (newTheme: ThemeColors) => {
      setTheme(newTheme);
      // Find theme name by matching accent color
      const name = Object.entries(THEMES).find(
        ([, t]) => t.accent === newTheme.accent
      )?.[0];
      if (name) themeNameRef.current = name;
      scheduleSave();
    },
    [scheduleSave]
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
      }
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

    // don't add empty results from clear
    if (result.text === "" && !result.blocks && !result.isError) {
      setHistory((prev) => {
        const entry: HistoryEntry = {
          id: ++idCounter.current,
          command: input,
          result: { text: "" },
          cwd,
        };
        const next = [...prev, entry];
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
      });
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
  }, [user, cwd, clearHistory, print, onLogout, setThemeWithTracking, scheduleSave, windowManager.openWindow]);

  return {
    history,
    cwd,
    theme,
    isProcessing,
    execute,
    clearHistory,
    fs: fsRef.current,
    cmdHistoryRef,
    windowManager,
  };
}
