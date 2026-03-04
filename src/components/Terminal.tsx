import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import type { User } from "@/types/terminal";
import { useTerminal } from "@/hooks/useTerminal";
import { useKeyboard } from "@/hooks/useKeyboard";
import { shortenPath, getHomePath } from "@/core/utils";
import { TerminalOutput } from "./TerminalOutput";
import { StatusBar } from "./StatusBar";
import { LogoHeader } from "./LogoHeader";
import { AutocompleteDropdown } from "./AutocompleteDropdown";
import { WindowLayer } from "./WindowLayer";
import { HOSTNAME } from "@/config";
import { getAll } from "@/core/commandRegistry";
import { WhisperPanel } from "@/apps/whisper/WhisperPanel";
import { GlobalSettingsProvider } from "@/hooks/useGlobalSettings";
import { useMailNotifications } from "@/hooks/useMailNotifications";

function MailNotificationListener() {
  useMailNotifications();
  return null;
}

interface Props {
  user: User;
  userId: string | null;
  onLogout: () => void;
  roomToken?: string | null;
}

export function Terminal({ user, userId, onLogout, roomToken }: Props) {
  const { history, cwd, theme, isProcessing, execute, fs, cmdHistoryRef, windowManager } = useTerminal(user, userId, onLogout);
  const [roomTokenUsed, setRoomTokenUsed] = useState(false);
  const hasWindows = windowManager.windows.length > 0;
  const homePath = getHomePath(user.username);

  const completionCtx = useMemo(
    () => ({ fs, cwd, username: user.username }),
    [fs, cwd, user.username]
  );

  const {
    input,
    setInput,
    handleKeyDown,
    suggestions,
    selectedIdx,
    acceptSuggestion,
    ghostText,
    mode,
  } = useKeyboard(execute, completionCtx, cmdHistoryRef);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = useCallback(() => {
    if (hasWindows) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [hasWindows]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, input]);

  useEffect(() => {
    if (!isProcessing) focusInput();
  }, [isProcessing, focusInput]);

  useEffect(() => { focusInput(); }, [history, focusInput]);
  useEffect(() => { focusInput(); }, [focusInput]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--accent-soft", theme.accentSoft);
    root.style.setProperty("--accent-mid", theme.accentMid);
  }, [theme]);

  // Auto-open whisper when ?room= token is present
  useEffect(() => {
    if (roomToken && user.role !== "guest" && !roomTokenUsed) {
      setRoomTokenUsed(true);
      windowManager.openWindow({
        id: "whisper",
        title: "whisper",
        component: WhisperPanel,
        props: { initialRoomId: roomToken },
        width: 800,
        height: 600,
      });
    }
  }, [roomToken, user.role, roomTokenUsed, windowManager]);

  return (
    <GlobalSettingsProvider>
    <MailNotificationListener />
    <div className="h-full flex flex-col font-mono screen-flicker">
      <LogoHeader
        subtitle={`${user.username}@${HOSTNAME}:${shortenPath(cwd, homePath)}  ·  nsh v1.0`}
        animate={false}
      />

      {/* scrollable output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-8 pt-2 pb-4 terminal-scroll"
        onClick={() => { if (!window.getSelection()?.toString()) focusInput(); }}
      >
        {history.length === 0 && (
          <div className="mb-4" style={{ color: "var(--text-muted)" }}>
            Welcome to <span className="glow-text" style={{ color: "var(--accent)" }}>{HOSTNAME}</span>
            {" — "}logged in as <span style={{ color: "var(--text-primary)" }}>{user.username}</span>
            <div className="mt-1">
              Type <span style={{ color: "var(--text-secondary)" }}>help</span> for available commands.
            </div>
          </div>
        )}

        <TerminalOutput entries={history} homePath={homePath} username={user.username} />

        <div className="relative">
          <div className="flex items-start">
            <span className="shrink-0 whitespace-pre">
              <span className="glow-text theme-transition" style={{ color: "var(--accent)" }}>
                {user.username}@{HOSTNAME}
              </span>
              <span style={{ color: "var(--text-muted)" }}>:</span>
              <span style={{ color: "var(--accent)", opacity: 0.8 }}>
                {shortenPath(cwd, homePath)}
              </span>
              <span style={{ color: "var(--text-muted)" }}>$ </span>
            </span>
            {isProcessing ? (
              <span className="spinner ml-1 mt-1" />
            ) : (
              <span className="flex-1 relative min-w-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-transparent outline-none font-mono"
                  style={{ color: "var(--text-primary)", caretColor: "var(--accent)", fontSize: "inherit" }}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  data-testid="terminal-input"
                />
                {ghostText && (
                  <span
                    className="pointer-events-none absolute top-0 left-0 font-mono whitespace-pre"
                    style={{ color: "var(--text-ghost)", fontSize: "inherit" }}
                    aria-hidden="true"
                  >
                    <span style={{ visibility: "hidden" }}>{input}</span>
                    {ghostText}
                  </span>
                )}
              </span>
            )}
          </div>

          {suggestions.length > 0 && !isProcessing && (
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

      <StatusBar
        username={user.username}
        cwd={cwd}
        homePath={homePath}
        commandCount={getAll().length}
      />

      <WindowLayer windowManager={windowManager} user={user} />
    </div>
    </GlobalSettingsProvider>
  );
}
