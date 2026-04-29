import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getAll } from "@/core/commandRegistry";
import { listAppNames } from "@/core/appLoader";
import { checkAppAccess, getRoleLevel } from "@/core/appRestrictions";
import { LockIcon } from "@/components/LockIcon";

interface PaletteItem {
  label: string;
  type: "command" | "app";
  description: string;
  locked: boolean;
}

// Same minRole map as AppShortcutBar
const APP_MIN_ROLE: Record<string, string | null> = {
  paste: "user", profile: "user",
  shortlinks: "user", downloader: "user", shop: null,
  admin: "admin", stats: "admin",
};

const ROLE_LEVEL: Record<string, number> = { guest: 0, code: 0, user: 1, classic: 2, club: 3, admin: 4 };
const HIDDEN_FROM_NON_ADMIN = ["admin", "stats"];

interface Props {
  open: boolean;
  onClose: () => void;
  execute: (cmd: string) => void;
  userRole: string;
}

export function CommandPalette({ open, onClose, execute, userRole }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isAdmin = userRole === "admin";
  const level = ROLE_LEVEL[userRole] ?? 0;

  const items = useMemo<PaletteItem[]>(() => {
    const cmds = getAll().map((c) => ({
      label: c.name,
      type: "command" as const,
      description: c.description,
      locked: false,
    }));
    const apps = listAppNames()
      .filter((name) => {
        // Always hide admin/stats from non-admins
        if (!isAdmin && HIDDEN_FROM_NON_ADMIN.includes(name)) return false;
        return true;
      })
      .map((name) => {
        const minRole = APP_MIN_ROLE[name] ?? null;
        const hasAccess = checkAppAccess(name, userRole) &&
          (!minRole || level >= (ROLE_LEVEL[minRole] ?? 99));
        return {
          label: name,
          type: "app" as const,
          description: `run ${name}`,
          locked: !hasAccess,
        };
      });
    // Unlocked apps first, then locked
    apps.sort((a, b) => Number(a.locked) - Number(b.locked));
    return [...apps, ...cmds];
  }, [isAdmin, userRole, level]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items
      .map((item) => {
        const idx = item.label.toLowerCase().indexOf(q);
        if (idx === -1) return null;
        return { item, matchIdx: idx };
      })
      .filter(Boolean)
      .sort((a, b) => a!.matchIdx - b!.matchIdx)
      .map((r) => r!.item);
  }, [items, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIdx] as HTMLElement | undefined;
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const select = useCallback(
    (item: PaletteItem) => {
      onClose();
      if (item.type === "app") {
        execute(`run ${item.label}`);
      } else {
        execute(item.label);
      }
    },
    [execute, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[selectedIdx];
        if (item) select(item);
        return;
      }
    },
    [filtered, selectedIdx, select, onClose]
  );

  if (!open) return null;

  return (
    <div className="cmd-palette-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="cmd-palette-input"
          placeholder="type a command or app..."
          spellCheck={false}
          autoComplete="off"
          data-palette-input="true"
        />
        <div className="cmd-palette-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="cmd-palette-empty">nothing found. try harder.</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={`${item.type}-${item.label}`}
              className={`cmd-palette-item${i === selectedIdx ? " cmd-palette-item--active" : ""}${item.locked ? " cmd-palette-item--locked" : ""}`}
              onClick={() => select(item)}
              onMouseEnter={() => setSelectedIdx(i)}
              type="button"
            >
              <span className="cmd-palette-item-type">
                {item.type === "app" ? "app" : "cmd"}
              </span>
              <span className="cmd-palette-item-label">
                {item.locked && <LockIcon size={11} />} {item.label}
              </span>
              <span className="cmd-palette-item-desc">{item.description}</span>
            </button>
          ))}
        </div>
        <div className="cmd-palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
