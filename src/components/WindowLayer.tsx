import type { User } from "@/types/terminal";
import type { WindowManager } from "@/hooks/useWindowManager";
import { Window } from "./Window";

interface Props {
  windowManager: WindowManager;
  user: User;
}

export function WindowLayer({ windowManager, user }: Props) {
  const { windows, closeWindow, focusWindow, minimizeWindow, maximizeWindow, updateWindowPosition, updateWindowSize } =
    windowManager;

  if (windows.length === 0) return null;

  const visibleWindows = windows.filter((w) => !w.isMinimized);
  const maxZ = visibleWindows.reduce((max, w) => Math.max(max, w.zIndex), 0);

  return (
    <div className="window-layer">
      {windows.map((win) => (
        <Window
          key={win.id}
          window={win}
          user={user}
          windowManager={windowManager}
          isFocused={!win.isMinimized && win.zIndex === maxZ}
          onClose={closeWindow}
          onFocus={focusWindow}
          onMinimize={minimizeWindow}
          onMaximize={maximizeWindow}
          onMove={updateWindowPosition}
          onResize={updateWindowSize}
        />
      ))}
    </div>
  );
}
