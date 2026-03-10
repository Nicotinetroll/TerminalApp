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
import { MobileAppBar } from "./MobileAppBar";
import { AppShortcutBar } from "./AppShortcutBar";
import { HOSTNAME } from "@/config";
import { getAll } from "@/core/commandRegistry";
import { WhisperPanel } from "@/apps/whisper/WhisperPanel";
import { GlobalSettingsProvider } from "@/hooks/useGlobalSettings";
import { useMailNotifications } from "@/hooks/useMailNotifications";
import { useParallaxButtons } from "@/hooks/useParallaxButtons";
import { GlobalEventToast } from "./GlobalEventToast";
import { AppRestrictionSync } from "./AppRestrictionSync";
import type { GlobalEvent } from "@/hooks/useGlobalEvents";
import * as api from "@/lib/api";
import type { WindowLayout } from "@/lib/api";

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
  const { history, cwd, theme, isProcessing, execute, print, fs, cmdHistoryRef, windowManager: rawWindowManager } = useTerminal(user, userId, onLogout);
  useParallaxButtons();
  const [roomTokenUsed, setRoomTokenUsed] = useState(false);
  const [autoOpenApps, setAutoOpenApps] = useState<string[]>([]);
  const autoOpenDone = useRef(false);
  const windowLayoutsRef = useRef<Record<string, WindowLayout>>({});
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const homePath = getHomePath(user.username);

  const completionCtx = useMemo(
    () => ({ fs, cwd, username: user.username, role: user.role }),
    [fs, cwd, user.username, user.role]
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
    submit,
  } = useKeyboard(execute, completionCtx, cmdHistoryRef);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

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

  // Wrap openWindow to inject saved layouts for apps
  const wrappedOpenWindow = useCallback(
    (...args: Parameters<typeof rawWindowManager.openWindow>) => {
      const config = args[0];
      if (config.appName) {
        const saved = windowLayoutsRef.current[config.appName];
        if (saved) {
          config.x = saved.x;
          config.y = saved.y;
          config.width = saved.width;
          config.height = saved.height;
        }
      }
      return rawWindowManager.openWindow(config);
    },
    [rawWindowManager.openWindow]
  );
  const windowManager = useMemo(
    () => ({ ...rawWindowManager, openWindow: wrappedOpenWindow }),
    [rawWindowManager, wrappedOpenWindow]
  );

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
        appName: "whisper",
      });
    }
  }, [roomToken, user.role, roomTokenUsed, windowManager]);

  // Load auto-open apps + saved window layouts from settings
  useEffect(() => {
    if (!userId || autoOpenDone.current) return;
    autoOpenDone.current = true;

    void api.loadSettings().then((settings) => {
      const apps = settings?.auto_open_apps ?? [];
      const layouts = settings?.window_layouts ?? {};
      setAutoOpenApps(apps);
      windowLayoutsRef.current = layouts;
      // Auto-open each app with a small delay between them
      for (let i = 0; i < apps.length; i++) {
        const name = apps[i]!;
        setTimeout(() => {
          void execute(`run ${name}`);
        }, i * 150);
      }
    });
  }, [userId, execute]);

  const handleToggleAutoOpen = useCallback((appName: string) => {
    setAutoOpenApps((prev) => {
      const next = prev.includes(appName)
        ? prev.filter((a) => a !== appName)
        : [...prev, appName];
      void api.saveSettings({ auto_open_apps: next });
      return next;
    });
  }, []);

  const handleRunApp = useCallback((name: string) => {
    void execute(`run ${name}`);
  }, [execute]);


  // Save all current window layouts (debounced)
  const saveLayouts = useCallback(() => {
    if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(() => {
      const layouts: Record<string, WindowLayout> = {};
      for (const w of rawWindowManager.windows) {
        if (w.appName) {
          layouts[w.appName] = { x: w.x, y: w.y, width: w.width, height: w.height };
        }
      }
      windowLayoutsRef.current = layouts;
      void api.saveSettings({ window_layouts: layouts });
    }, 500);
  }, [rawWindowManager.windows]);

  const handleLayoutChange = useCallback(() => {
    saveLayouts();
  }, [saveLayouts]);

  const handleGlobalEvent = useCallback((event: GlobalEvent) => {
    const prefixes: Record<string, string> = {
      jackpot: "[JACKPOT]",
      big_win: "[BIG WIN]",
      record: "[RECORD]",
    };
    const prefix = prefixes[event.type] ?? "[EVENT]";
    print({ text: `${prefix} ${event.message}` });
  }, [print]);

  return (
    <GlobalSettingsProvider>
    <AppRestrictionSync />
    <MailNotificationListener />
    <GlobalEventToast onEvent={handleGlobalEvent} />
    <div className="terminal-page screen-flicker font-mono">
      <div className="terminal-backdrop-content">
      <LogoHeader
        subtitle={`${user.username}@${HOSTNAME}:${shortenPath(cwd, homePath)}  ·  nsh v1.0`}
      />

      <AppShortcutBar onRunApp={handleRunApp} userRole={user.role} />

      <div className="terminal-frame">
        {/* Mobile header bar */}
        <div className="mobile-header-bar">
          <span className="mobile-header-dot">·</span>
          <span className="mobile-header-user">{user.username}</span>
        </div>

        {/* scrollable output */}
        <div
          ref={scrollRef}
          className="terminal-body terminal-scroll"
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

          {/* Input row — sticky on mobile via CSS */}
          <div className="terminal-input-wrap">
            <div className="relative">
              <div className="flex items-start terminal-input-row">
                <span className="shrink-0 whitespace-pre">
                  <span className="prompt-full">
                    <span className="glow-text theme-transition" style={{ color: "var(--accent)" }}>
                      {user.username}@{HOSTNAME}
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
                {isProcessing ? (
                  <span className="spinner ml-1 mt-1" />
                ) : (
                  <>
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
                        className="ghost-text-overlay pointer-events-none absolute top-0 left-0 font-mono whitespace-pre"
                        style={{ color: "var(--text-ghost)", fontSize: "inherit" }}
                        aria-hidden="true"
                      >
                        <span style={{ visibility: "hidden" }}>{input}</span>
                        {ghostText}
                      </span>
                    )}
                  </span>
                  <button className="mobile-submit-btn ml-2" onMouseDown={e => e.preventDefault()} onClick={() => { submit(); inputRef.current?.focus(); }} type="button">&gt;</button>
                  </>
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
        </div>

        {/* Mobile app bar */}
        <MobileAppBar onRunApp={handleRunApp} userRole={user.role} />

        <StatusBar
          username={user.username}
          cwd={cwd}
          homePath={homePath}
          commandCount={getAll().length}
        />
      </div>
      </div>

      <WindowLayer
        windowManager={windowManager}
        user={user}
        autoOpenApps={autoOpenApps}
        onToggleAutoOpen={handleToggleAutoOpen}
        onLayoutChange={handleLayoutChange}
      />
    </div>
    </GlobalSettingsProvider>
  );
}
