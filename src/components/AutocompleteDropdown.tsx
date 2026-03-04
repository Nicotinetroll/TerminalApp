import { useEffect, useRef } from "react";
import type { Suggestion } from "@/core/completions";

interface Props {
  suggestions: Suggestion[];
  selectedIdx: number;
  onSelect: (suggestion: Suggestion) => void;
  input: string;
  mode: "command" | "arg";
}

const CATEGORY_COLORS: Record<string, string> = {
  system: "#60a5fa",
  filesystem: "#34d399",
  apps: "#fbbf24",
  theme: "#c084fc",
  command: "#60a5fa",
  app: "#fbbf24",
  dir: "#34d399",
  file: "#9aa4b8",
};

function HighlightedLabel({ label, partial }: { label: string; partial: string }) {
  if (!partial || !label.toLowerCase().startsWith(partial.toLowerCase())) {
    return <span>{label}</span>;
  }
  return (
    <span>
      <span style={{ color: "var(--accent)" }}>{label.slice(0, partial.length)}</span>
      {label.slice(partial.length)}
    </span>
  );
}

export function AutocompleteDropdown({ suggestions, selectedIdx, onSelect, input, mode }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const item = el.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // Figure out partial text for highlighting
  const trimmed = input.trimStart();
  let partial: string;
  if (mode === "command") {
    partial = trimmed;
  } else {
    const lastSpace = trimmed.lastIndexOf(" ");
    partial = lastSpace >= 0 ? trimmed.slice(lastSpace + 1) : trimmed;
  }

  return (
    <div
      ref={listRef}
      className="autocomplete-dropdown"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        maxHeight: "200px",
        overflowY: "auto",
        marginTop: "4px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-medium)",
        borderRadius: "8px",
        padding: "4px",
        zIndex: 50,
        backdropFilter: "blur(12px)",
      }}
    >
      {suggestions.map((s, i) => {
        const isSelected = i === selectedIdx;
        const catColor = s.category ? CATEGORY_COLORS[s.category] ?? "var(--text-muted)" : undefined;

        return (
          <div
            key={s.value}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(s);
            }}
            onMouseEnter={() => {
              // We can't set state from here but the visual hover is via CSS
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "5px 10px",
              borderRadius: "6px",
              cursor: "pointer",
              transition: "background 80ms ease",
              background: isSelected ? "var(--accent-soft)" : "transparent",
            }}
          >
            {/* category dot */}
            {catColor && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: catColor,
                  opacity: isSelected ? 1 : 0.5,
                  flexShrink: 0,
                }}
              />
            )}
            <span
              style={{
                color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: 500,
                minWidth: "72px",
              }}
            >
              <HighlightedLabel label={s.label} partial={partial} />
            </span>
            <span
              style={{
                color: "var(--text-ghost)",
                fontSize: "13px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
              }}
            >
              {s.description}
            </span>
            {isSelected && (
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--text-ghost)",
                  flexShrink: 0,
                }}
              >
                enter
              </span>
            )}
          </div>
        );
      })}
      <div
        style={{
          padding: "4px 10px 2px",
          fontSize: "11px",
          color: "var(--text-ghost)",
          borderTop: "1px solid var(--border-subtle)",
          marginTop: "2px",
          display: "flex",
          gap: "12px",
        }}
      >
        <span><kbd>↑↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> accept</span>
        <span><kbd>→</kbd> complete</span>
        <span><kbd>Esc</kbd> dismiss</span>
      </div>
    </div>
  );
}
