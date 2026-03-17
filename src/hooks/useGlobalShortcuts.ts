import { useEffect } from "react";
import type { WindowManager } from "@/hooks/useWindowManager";

interface ShortcutDeps {
  windowManager: WindowManager;
  togglePalette: () => void;
}

export function useGlobalShortcuts({ windowManager, togglePalette }: ShortcutDeps) {
  useEffect(() => {
    function getFocusedWindow() {
      const visible = windowManager.windows.filter((w) => !w.isMinimized);
      if (visible.length === 0) return undefined;
      return visible.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
    }

    function handler(e: KeyboardEvent) {
      // Ignore if typing in an input/textarea (unless it's the palette search)
      const tag = (e.target as HTMLElement)?.tagName;
      const isPaletteInput = (e.target as HTMLElement)?.dataset?.paletteInput === "true";

      // Ctrl+K — command palette (always works)
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        togglePalette();
        return;
      }

      // Don't intercept shortcuts while typing in inputs (except palette)
      if ((tag === "INPUT" || tag === "TEXTAREA") && !isPaletteInput) return;

      // Ctrl+1-9 — focus Nth window
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        const win = windowManager.windows[idx];
        if (win) {
          windowManager.focusWindow(win.id);
        }
        return;
      }

      // Ctrl+W — close focused window
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        e.preventDefault();
        const focused = getFocusedWindow();
        if (focused) {
          windowManager.closeWindow(focused.id);
        }
        return;
      }

      // Ctrl+Arrow — tile windows
      if ((e.ctrlKey || e.metaKey) && e.key === "ArrowLeft") {
        e.preventDefault();
        const focused = getFocusedWindow();
        if (focused) {
          const h = window.innerHeight - 40;
          windowManager.updateWindowPosition(focused.id, 0, 0);
          windowManager.updateWindowSize(focused.id, Math.floor(window.innerWidth / 2), h);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "ArrowRight") {
        e.preventDefault();
        const focused = getFocusedWindow();
        if (focused) {
          const halfW = Math.floor(window.innerWidth / 2);
          const h = window.innerHeight - 40;
          windowManager.updateWindowPosition(focused.id, halfW, 0);
          windowManager.updateWindowSize(focused.id, halfW, h);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "ArrowUp") {
        e.preventDefault();
        const focused = getFocusedWindow();
        if (focused) {
          windowManager.maximizeWindow(focused.id);
        }
        return;
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [windowManager, togglePalette]);
}
