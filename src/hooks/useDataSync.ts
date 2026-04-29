import { useEffect, useRef, useCallback } from "react";
import type { FileSystemNode, ThemeColors } from "@/types/terminal";
import { THEMES } from "@/config";
import * as api from "@/lib/api";

const DEBOUNCE_MS = 5000;

interface SyncedData {
  filesystem: FileSystemNode | null;
  themeName: string | null;
  commandHistory: string[];
}

export function useDataSync(
  userId: string | null,
  fsRef: React.RefObject<FileSystemNode>,
  getThemeName: () => string,
  cmdHistoryRef: React.RefObject<string[]>
) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSaving = useRef(false);
  const dataLoaded = useRef(false);

  const doSave = useCallback(async () => {
    // Block saves until initial data is loaded — prevents overwriting real data with empty default
    if (!userId || isSaving.current || !dataLoaded.current) return;
    isSaving.current = true;
    try {
      await Promise.all([
        api.saveFilesystem(fsRef.current as unknown as Record<string, unknown>),
        api.saveSettings({
          theme_name: getThemeName(),
          command_history: cmdHistoryRef.current,
        }),
      ]);
    } catch {
      // Save failed silently — offline fallback
    } finally {
      isSaving.current = false;
    }
  }, [userId, fsRef, getThemeName, cmdHistoryRef]);

  const scheduleSave = useCallback(() => {
    if (!userId || !dataLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void doSave();
    }, DEBOUNCE_MS);
  }, [userId, doSave]);

  // Save on beforeunload — use sendBeacon for reliable delivery
  useEffect(() => {
    if (!userId) return;

    const handleBeforeUnload = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (!dataLoaded.current) return;
      const token = api.getToken();
      if (!token) return;
      const base = (import.meta.env["VITE_API_URL"] as string) || "/api";
      const headers = { type: "application/json" };
      // sendBeacon is synchronous and guaranteed to be sent even on page close
      try {
        navigator.sendBeacon(
          `${base}/sync/filesystem`,
          new Blob([JSON.stringify({ filesystem: fsRef.current, _token: token })], headers)
        );
        navigator.sendBeacon(
          `${base}/sync/settings`,
          new Blob([JSON.stringify({
            theme_name: getThemeName(),
            command_history: cmdHistoryRef.current,
            _token: token,
          })], headers)
        );
      } catch {
        // Last resort: fire-and-forget fetch
        void doSave();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [userId, doSave, fsRef, getThemeName, cmdHistoryRef]);

  const loadUserData = useCallback(
    async (): Promise<SyncedData> => {
      if (!userId) {
        return { filesystem: null, themeName: null, commandHistory: [] };
      }

      try {
        const [fs, settings] = await Promise.all([
          api.loadFilesystem(),
          api.loadSettings(),
        ]);

        // Mark data as loaded — saves are now safe
        dataLoaded.current = true;

        return {
          filesystem: fs as FileSystemNode | null,
          themeName: settings?.theme_name ?? null,
          commandHistory: settings?.command_history ?? [],
        };
      } catch {
        // Even on error, mark as loaded so the app isn't permanently blocked
        dataLoaded.current = true;
        return { filesystem: null, themeName: null, commandHistory: [] };
      }
    },
    [userId]
  );

  const resolveTheme = useCallback(
    (themeName: string | null): ThemeColors | null => {
      if (!themeName) return null;
      return THEMES[themeName] ?? null;
    },
    []
  );

  return { scheduleSave, loadUserData, resolveTheme };
}
