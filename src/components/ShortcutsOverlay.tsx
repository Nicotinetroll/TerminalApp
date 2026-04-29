import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: "Ctrl+K", desc: "Command palette" },
  { keys: "Ctrl+L", desc: "Clear terminal" },
  { keys: "Ctrl+R", desc: "Reverse history search" },
  { keys: "↑ / ↓", desc: "Navigate command history" },
  { keys: "Tab", desc: "Accept autocomplete suggestion" },
  { keys: "→", desc: "Accept ghost text" },
  { keys: "Esc", desc: "Dismiss suggestions / close overlay" },
  { keys: "?", desc: "Show this help (when input empty)" },
  { keys: "Ctrl+1-9", desc: "Focus Nth window" },
  { keys: "Ctrl+W", desc: "Close focused window" },
  { keys: "Ctrl+←/→", desc: "Tile window left/right" },
  { keys: "Ctrl+↑", desc: "Maximize window" },
];

export function ShortcutsOverlay({ open, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="cmd-palette-overlay" onClick={onClose}>
      <div className="cmd-palette shortcuts-overlay" onClick={(e) => e.stopPropagation()} ref={ref}>
        <div className="shortcuts-header">
          <span style={{ color: "var(--accent)", fontWeight: 600 }}>keyboard shortcuts</span>
          <span style={{ color: "var(--text-ghost)", fontSize: "11px" }}>press ? or esc to close</span>
        </div>
        <div className="cmd-palette-list">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="shortcut-row">
              <kbd className="shortcut-key">{s.keys}</kbd>
              <span className="shortcut-desc">{s.desc}</span>
            </div>
          ))}
        </div>
        <div className="cmd-palette-footer">
          <span>protip: most shortcuts work globally</span>
        </div>
      </div>
    </div>
  );
}
