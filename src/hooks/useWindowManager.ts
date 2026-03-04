import { useState, useCallback, useRef } from "react";
import type { WindowId, WindowConfig, WindowState } from "@/types/terminal";

export interface WindowManager {
  windows: WindowState[];
  openWindow: (config: WindowConfig) => WindowId;
  closeWindow: (id: WindowId) => void;
  focusWindow: (id: WindowId) => void;
  minimizeWindow: (id: WindowId) => void;
  maximizeWindow: (id: WindowId) => void;
  updateWindowPosition: (id: WindowId, x: number, y: number) => void;
  updateWindowSize: (id: WindowId, w: number, h: number) => void;
  updateWindowTitle: (id: WindowId, title: string) => void;
}

export function useWindowManager(): WindowManager {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const zCounter = useRef(100);

  const openWindow = useCallback((config: WindowConfig): WindowId => {
    const id = config.id ?? crypto.randomUUID();

    setWindows((prev) => {
      // If window with same ID already exists, focus it
      if (config.id && prev.some((w) => w.id === config.id)) {
        zCounter.current += 1;
        return prev.map((w) =>
          w.id === config.id
            ? { ...w, zIndex: zCounter.current, isMinimized: false }
            : w
        );
      }

      const width = config.width ?? 700;
      const height = config.height ?? 500;
      const offsetX = (Math.random() - 0.5) * 40;
      const offsetY = (Math.random() - 0.5) * 40;
      const x = Math.round((window.innerWidth - width) / 2 + offsetX);
      const y = Math.round((window.innerHeight - height) / 2 + offsetY);

      zCounter.current += 1;

      const state: WindowState = {
        id,
        title: config.title,
        component: config.component,
        props: config.props ?? {},
        x: Math.max(0, x),
        y: Math.max(0, y),
        width,
        height,
        minWidth: config.minWidth ?? 400,
        minHeight: config.minHeight ?? 300,
        zIndex: zCounter.current,
        isMinimized: false,
        isMaximized: false,
      };

      return [...prev, state];
    });

    return id;
  }, []);

  const closeWindow = useCallback((id: WindowId) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const focusWindow = useCallback((id: WindowId) => {
    zCounter.current += 1;
    const z = zCounter.current;
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, zIndex: z } : w))
    );
  }, []);

  const minimizeWindow = useCallback((id: WindowId) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, isMinimized: !w.isMinimized } : w
      )
    );
  }, []);

  const maximizeWindow = useCallback((id: WindowId) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, isMaximized: !w.isMaximized } : w
      )
    );
  }, []);

  const updateWindowPosition = useCallback((id: WindowId, x: number, y: number) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, x, y } : w))
    );
  }, []);

  const updateWindowTitle = useCallback((id: WindowId, title: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, title } : w))
    );
  }, []);

  const updateWindowSize = useCallback((id: WindowId, w: number, h: number) => {
    setWindows((prev) =>
      prev.map((win) => {
        if (win.id !== id) return win;
        return {
          ...win,
          width: Math.max(win.minWidth, w),
          height: Math.max(win.minHeight, h),
        };
      })
    );
  }, []);

  return {
    windows,
    openWindow,
    closeWindow,
    focusWindow,
    minimizeWindow,
    maximizeWindow,
    updateWindowPosition,
    updateWindowSize,
    updateWindowTitle,
  };
}
