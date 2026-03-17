import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getAll } from "@/core/commandRegistry";
import { listAppNames } from "@/core/appLoader";

interface PaletteItem {
  label: string;
  type: "command" | "app";
  description: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  execute: (cmd: string) => void;
}

export function CommandPalette({ open, onClose, execute }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const cmds = getAll().map((c) => ({
      label: c.name,
      type: "command" as const,
      description: c.description,
    }));
    const apps = listAppNames().map((name) => ({
      label: name,
      type: "app" as const,
      description: `run ${name}`,
    }));
    return [...apps, ...cmds];
  }, []);

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
              className={`cmd-palette-item${i === selectedIdx ? " cmd-palette-item--active" : ""}`}
              onClick={() => select(item)}
              onMouseEnter={() => setSelectedIdx(i)}
              type="button"
            >
              <span className="cmd-palette-item-type">
                {item.type === "app" ? "app" : "cmd"}
              </span>
              <span className="cmd-palette-item-label">{item.label}</span>
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
