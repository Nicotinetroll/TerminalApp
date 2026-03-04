import { useRef, useCallback, useEffect, useState } from "react";
import type { WindowState, User } from "@/types/terminal";

interface Props {
  window: WindowState;
  user: User;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
}

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_DIRS: { dir: ResizeDir; className: string; cursor: string }[] = [
  { dir: "n", className: "resize-n", cursor: "ns-resize" },
  { dir: "s", className: "resize-s", cursor: "ns-resize" },
  { dir: "e", className: "resize-e", cursor: "ew-resize" },
  { dir: "w", className: "resize-w", cursor: "ew-resize" },
  { dir: "ne", className: "resize-ne", cursor: "nesw-resize" },
  { dir: "nw", className: "resize-nw", cursor: "nwse-resize" },
  { dir: "se", className: "resize-se", cursor: "nwse-resize" },
  { dir: "sw", className: "resize-sw", cursor: "nesw-resize" },
];

export function Window({
  window: win,
  user,
  onClose,
  onFocus,
  onMinimize,
  onMaximize,
  onMove,
  onResize,
}: Props) {
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null);
  const resizeRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    winX: number;
    winY: number;
    winW: number;
    winH: number;
  } | null>(null);
  const [entered, setEntered] = useState(false);
  const isMobile = window.innerWidth <= 768;

  useEffect(() => {
    requestAnimationFrame(() => setEntered(true));
  }, []);

  // Auto-maximize on mobile
  useEffect(() => {
    if (isMobile && !win.isMaximized) {
      onMaximize(win.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest(".window-btn")) return;
      e.preventDefault();
      onFocus(win.id);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        winX: win.x,
        winY: win.y,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const nx = d.winX + (ev.clientX - d.startX);
        const ny = d.winY + (ev.clientY - d.startY);
        onMove(win.id, Math.max(0, nx), Math.max(0, ny));
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [win.id, win.x, win.y, onFocus, onMove]
  );

  const handleResizeStart = useCallback(
    (dir: ResizeDir, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onFocus(win.id);
      resizeRef.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        winX: win.x,
        winY: win.y,
        winW: win.width,
        winH: win.height,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        const r = resizeRef.current;
        if (!r) return;
        const dx = ev.clientX - r.startX;
        const dy = ev.clientY - r.startY;

        let newW = r.winW;
        let newH = r.winH;
        let newX = r.winX;
        let newY = r.winY;

        if (r.dir.includes("e")) newW = r.winW + dx;
        if (r.dir.includes("w")) {
          newW = r.winW - dx;
          newX = r.winX + dx;
        }
        if (r.dir.includes("s")) newH = r.winH + dy;
        if (r.dir.includes("n")) {
          newH = r.winH - dy;
          newY = r.winY + dy;
        }

        newW = Math.max(win.minWidth, newW);
        newH = Math.max(win.minHeight, newH);

        // Clamp position so window doesn't jump when hitting min size
        if (r.dir.includes("w") && newW === win.minWidth) {
          newX = r.winX + r.winW - win.minWidth;
        }
        if (r.dir.includes("n") && newH === win.minHeight) {
          newY = r.winY + r.winH - win.minHeight;
        }

        onMove(win.id, Math.max(0, newX), Math.max(0, newY));
        onResize(win.id, newW, newH);
      };

      const handleMouseUp = () => {
        resizeRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [win.id, win.x, win.y, win.width, win.height, win.minWidth, win.minHeight, onFocus, onMove, onResize]
  );

  if (win.isMinimized) return null;

  const isMax = win.isMaximized;
  const style: React.CSSProperties = {
    position: "fixed",
    left: isMax ? 0 : win.x,
    top: isMax ? 0 : win.y,
    width: isMax ? "100vw" : win.width,
    height: isMax ? "100vh" : win.height,
    zIndex: win.zIndex,
    pointerEvents: "auto",
  };

  const Content = win.component;

  return (
    <div
      className={`window-frame${entered ? " window-enter" : ""}`}
      style={style}
      onMouseDown={() => onFocus(win.id)}
    >
      {/* Title bar */}
      <div className="window-titlebar" onMouseDown={handleDragStart}>
        <span className="window-title">{win.title}</span>
        <div className="window-controls">
          <button
            className="window-btn"
            onClick={() => onMinimize(win.id)}
            title="Minimize"
          >
            ─
          </button>
          <button
            className="window-btn"
            onClick={() => onMaximize(win.id)}
            title="Maximize"
          >
            □
          </button>
          <button
            className="window-btn window-btn-close"
            onClick={() => onClose(win.id)}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="window-body terminal-scroll">
        <Content
          windowId={win.id}
          closeWindow={() => onClose(win.id)}
          user={user}
          {...win.props}
        />
      </div>

      {/* Resize handles */}
      {!isMax &&
        RESIZE_DIRS.map(({ dir, className, cursor }) => (
          <div
            key={dir}
            className={className}
            style={{ cursor }}
            onMouseDown={(e) => handleResizeStart(dir, e)}
          />
        ))}
    </div>
  );
}
