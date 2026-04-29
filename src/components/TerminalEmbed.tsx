import { useRef, useEffect, useCallback, useState } from "react";
import type { User, HistoryEntry } from "@/types/terminal";
import { shortenPath, emailLocalPart } from "@/core/utils";
import { TerminalOutput } from "./TerminalOutput";
import { AutocompleteDropdown } from "./AutocompleteDropdown";
import { HOSTNAME } from "@/config";
import { useTypingSounds, toggleTypingSounds, getTypingSoundsEnabled } from "@/hooks/useTypingSounds";

interface Props {
  history: HistoryEntry[];
  input: string;
  setInput: (v: string) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  suggestions: string[];
  selectedIdx: number;
  acceptSuggestion: (s: string) => void;
  ghostText: string;
  mode: "command" | "path";
  submit: () => void;
  isProcessing: boolean;
  user: User;
  cwd: string;
  homePath: string;
  searchMode?: boolean;
  searchQuery?: string;
  searchMatch?: string;
}

export function TerminalEmbed({
  history, input, setInput, handleKeyDown, suggestions,
  selectedIdx, acceptSuggestion, ghostText, mode, submit,
  isProcessing, user, cwd, homePath,
  searchMode, searchQuery, searchMatch,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sweeping, setSweeping] = useState(false);
  const prevProcessing = useRef(false);
  const [soundsOn, setSoundsOn] = useState(getTypingSoundsEnabled);
  const { playKeySound } = useTypingSounds();

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Smooth scroll on new output
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [history, input]);

  useEffect(() => {
    if (!isProcessing) focusInput();
  }, [isProcessing, focusInput]);

  useEffect(() => { focusInput(); }, [history, focusInput]);
  useEffect(() => { focusInput(); }, [focusInput]);

  // Processing sweep effect
  useEffect(() => {
    if (isProcessing && !prevProcessing.current) {
      setSweeping(true);
      const t = setTimeout(() => setSweeping(false), 300);
      return () => clearTimeout(t);
    }
    prevProcessing.current = isProcessing;
  }, [isProcessing]);

  const wrappedKeyDown = useCallback((e: React.KeyboardEvent) => {
    playKeySound(e.key);
    handleKeyDown(e);
  }, [handleKeyDown, playKeySound]);

  const handleToggleSound = useCallback(() => {
    const next = toggleTypingSounds();
    setSoundsOn(next);
  }, []);

  // Last login date
  const loginDate = useRef(new Date().toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }));

  return (
    <div
      ref={scrollRef}
      className={`terminal-embed terminal-scroll${sweeping ? " processing-sweep" : ""}`}
      onClick={() => { if (!window.getSelection()?.toString()) focusInput(); }}
    >
      {history.length === 0 && (
        <div className="mb-4" style={{ color: "var(--text-muted)" }}>
          <div style={{ opacity: 0.5, marginBottom: "2px" }}>
            Last login: {loginDate.current} on ttys000
          </div>
          Welcome to <span className="glow-text" style={{ color: "var(--accent)" }}>{HOSTNAME}</span>
          {" — "}logged in as <span style={{ color: "var(--text-primary)" }}>{emailLocalPart(user.email)}</span>
          <div className="mt-1">
            Type <span style={{ color: "var(--text-secondary)" }}>help</span> for available commands.
            Press <span style={{ color: "var(--text-secondary)" }}>?</span> for keyboard shortcuts.
          </div>
        </div>
      )}

      <TerminalOutput entries={history} homePath={homePath} username={emailLocalPart(user.email)} />

      <div className="terminal-input-wrap">
        <div className="relative">
          <div className="flex items-start terminal-input-row">
            {searchMode ? (
              <span className="shrink-0 whitespace-pre" style={{ color: "var(--text-muted)" }}>
                (reverse-i-search)`<span style={{ color: "var(--accent)" }}>{searchQuery}</span>': </span>
            ) : (
              <span className="shrink-0 whitespace-pre">
                <span className="prompt-full">
                  <span className="glow-text theme-transition" style={{ color: "var(--accent)" }}>
                    {emailLocalPart(user.email)}@{HOSTNAME}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>:</span>
                  <span style={{ color: "var(--accent)", opacity: 0.8 }}>
                    {shortenPath(cwd, homePath)}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>$ </span>
                </span>
                <span className="prompt-short">
                  <span style={{ color: "var(--accent)", opacity: 0.8 }}>
                    {shortenPath(cwd, homePath)}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>$ </span>
                </span>
              </span>
            )}
            {isProcessing ? (
              <span className="terminal-spinner-wrap"><span className="terminal-spinner" /></span>
            ) : (
              <>
              <span className="flex-1 relative min-w-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={searchMode ? (searchMatch ?? "") : input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={wrappedKeyDown}
                  className="w-full bg-transparent outline-none font-mono"
                  style={{ color: "var(--text-primary)", caretColor: "var(--accent)", fontSize: "inherit" }}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  data-testid="terminal-input"
                />
                {!searchMode && input === "" && (
                  <span className="block-cursor">&#x2588;</span>
                )}
                {ghostText && !searchMode && (
                  <span
                    className="ghost-text-overlay pointer-events-none absolute top-0 left-0 font-mono whitespace-pre"
                    style={{ color: "var(--text-ghost)", fontSize: "inherit" }}
                    aria-hidden="true"
                  >
                    <span style={{ visibility: "hidden" }}>{input}</span>
                    {ghostText}
                  </span>
                )}
              </span>
              <button
                className="sound-toggle"
                onClick={handleToggleSound}
                type="button"
                title={soundsOn ? "Disable typing sounds" : "Enable typing sounds"}
              >
                {soundsOn ? "🔊" : "🔇"}
              </button>
              <button className="mobile-submit-btn ml-2" onMouseDown={e => e.preventDefault()} onClick={() => { submit(); inputRef.current?.focus(); }} type="button">&gt;</button>
              </>
            )}
          </div>

          {suggestions.length > 0 && !isProcessing && !searchMode && (
            <AutocompleteDropdown
              suggestions={suggestions}
              selectedIdx={selectedIdx}
              onSelect={acceptSuggestion}
              input={input}
              mode={mode}
            />
          )}
        </div>
      </div>
    </div>
  );
}
