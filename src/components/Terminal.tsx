import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import type { User } from "@/types/terminal";
import { useTerminal } from "@/hooks/useTerminal";
import { useKeyboard } from "@/hooks/useKeyboard";
import { getHomePath, emailLocalPart } from "@/core/utils";
import { TerminalEmbed } from "./TerminalEmbed";
import { Navbar } from "./Navbar";
import { PanelLayout } from "./PanelLayout";
import { WindowLayer } from "./WindowLayer";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { StatusLine } from "./StatusLine";
import { GlobalSettingsProvider } from "@/hooks/useGlobalSettings";
import { useMailNotifications } from "@/hooks/useMailNotifications";
import { useAppBadges } from "@/hooks/useAppBadges";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { GlobalEventToast } from "./GlobalEventToast";
import { AppRestrictionSync } from "./AppRestrictionSync";
import { MailPanel } from "@/apps/mail/MailPanel";
import { CloudPanel } from "@/apps/cloud/CloudPanel";
import type { GlobalEvent } from "@/hooks/useGlobalEvents";
import { THEMES } from "@/config";
import * as api from "@/lib/api";
import type { WindowLayout } from "@/lib/api";

function MailNotificationListener({ updateBadge }: { updateBadge: (app: string, count: number) => void }) {
  useMailNotifications(updateBadge);
  return null;
}

interface Props {
  user: User;
  userId: string | null;
  onLogout: () => void;
}

// Konami code sequence
const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

export function Terminal({ user, userId, onLogout }: Props) {
  const { history, cwd, theme, isProcessing, execute, print, fs, fsReady, cmdHistoryRef, windowManager: rawWindowManager, fullscreenApp, closeFullscreen } = useTerminal(user, userId, onLogout);
  const { badges, clearBadge, updateBadge } = useAppBadges();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), []);
  const [autoOpenApps, setAutoOpenApps] = useState<string[]>([]);
  const autoOpenDone = useRef(false);
  const windowLayoutsRef = useRef<Record<string, WindowLayout>>({});
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const homePath = getHomePath(user.email);

  const completionCtx = useMemo(
    () => ({ fs, cwd, username: emailLocalPart(user.email), role: user.role }),
    [fs, cwd, user.email, user.role]
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
    searchMode,
    searchQuery,
    searchMatch,
    shortcutsOpen,
    setShortcutsOpen,
  } = useKeyboard(execute, completionCtx, cmdHistoryRef);

  // ── Konami code ──
  const konamiIdx = useRef(0);
  const konamiActive = useRef(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger in inputs (except terminal input)
      const tag = (e.target as HTMLElement)?.tagName;
      const isTerminalInput = (e.target as HTMLElement)?.dataset?.testid === "terminal-input";
      if ((tag === "INPUT" || tag === "TEXTAREA") && !isTerminalInput) return;

      if (konamiActive.current) return;

      if (e.key === KONAMI[konamiIdx.current]) {
        konamiIdx.current++;
        if (konamiIdx.current === KONAMI.length) {
          konamiIdx.current = 0;
          konamiActive.current = true;

          // Cycle through theme accents rapidly
          const themeNames = Object.keys(THEMES);
          let i = 0;
          const iv = setInterval(() => {
            const t = THEMES[themeNames[i % themeNames.length]!];
            if (t) {
              document.documentElement.style.setProperty("--accent", t.accent);
            }
            i++;
          }, 200);

          setTimeout(() => {
            clearInterval(iv);
            // Restore current theme
            document.documentElement.style.setProperty("--accent", theme.accent);
            konamiActive.current = false;
          }, 2000);

          print({
            text: "CHEAT CODE ACTIVATED. just kidding, there are no cheats. you're still broke.",
          });
        }
      } else {
        konamiIdx.current = 0;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [theme.accent, print]);

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

  useGlobalShortcuts({ windowManager, togglePalette });

  // Apply theme
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--accent-soft", theme.accentSoft);
    root.style.setProperty("--accent-mid", theme.accentMid);
    const defaults: Record<string, string> = {
      "--bg-primary": "#0a0a12", "--bg-surface": "#0e0e18", "--bg-elevated": "#14141f",
      "--text-primary": "#e8ecf4", "--text-secondary": "#9aa4b8", "--text-muted": "#586880",
      "--text-ghost": "#354055", "--border-subtle": "rgba(255,255,255,0.06)",
      "--border-medium": "rgba(255,255,255,0.12)", "--error": "#f87171", "--success": "#34d399",
    };
    const map: Record<string, string | undefined> = {
      "--bg-primary": theme.bgPrimary, "--bg-surface": theme.bgSurface, "--bg-elevated": theme.bgElevated,
      "--text-primary": theme.textPrimary, "--text-secondary": theme.textSecondary,
      "--text-muted": theme.textMuted, "--text-ghost": theme.textGhost,
      "--border-subtle": theme.borderSubtle, "--border-medium": theme.borderMedium,
      "--error": theme.error, "--success": theme.success,
    };
    for (const [prop, val] of Object.entries(map)) {
      root.style.setProperty(prop, val ?? defaults[prop]!);
    }
  }, [theme]);

  // Load auto-open apps + saved window layouts from settings
  // Filter out mail/cloud since they're always visible in panels
  useEffect(() => {
    if (!userId || autoOpenDone.current) return;
    autoOpenDone.current = true;

    void api.loadSettings().then((settings) => {
      const apps = (settings?.auto_open_apps ?? []).filter((a: string) => a !== "mail" && a !== "cloud");
      const layouts = settings?.window_layouts ?? {};
      setAutoOpenApps(apps);
      windowLayoutsRef.current = layouts;
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
    clearBadge(name);
    void execute(`run ${name}`);
  }, [execute, clearBadge]);

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
    <MailNotificationListener updateBadge={updateBadge} />
    <GlobalEventToast onEvent={handleGlobalEvent} />
    <div className="terminal-page screen-flicker font-mono">
      <Navbar
        onRunApp={handleRunApp}
        onLogout={onLogout}
        username={emailLocalPart(user.email)}
        userRole={user.role}
        badges={badges}
        onTogglePalette={togglePalette}
      />

      <div className="terminal-backdrop-content">
        <PanelLayout
          mailPanel={<MailPanel user={user} />}
          cloudPanel={<CloudPanel user={user} fs={fs} fsReady={fsReady} cwd={cwd} />}
          terminalPanel={
            <TerminalEmbed
              history={history}
              input={input}
              setInput={setInput}
              handleKeyDown={handleKeyDown}
              suggestions={suggestions}
              selectedIdx={selectedIdx}
              acceptSuggestion={acceptSuggestion}
              ghostText={ghostText}
              mode={mode}
              submit={submit}
              isProcessing={isProcessing}
              user={user}
              cwd={cwd}
              homePath={homePath}
              searchMode={searchMode}
              searchQuery={searchQuery}
              searchMatch={searchMatch}
            />
          }
        />
      </div>

      <StatusLine historyLength={history.length} username={emailLocalPart(user.email)} />

      <WindowLayer
        windowManager={windowManager}
        user={user}
        autoOpenApps={autoOpenApps}
        onToggleAutoOpen={handleToggleAutoOpen}
        onLayoutChange={handleLayoutChange}
      />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} execute={(cmd) => void execute(cmd)} userRole={user.role} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {fullscreenApp && (
        <div className="fullscreen-app-overlay">
          <fullscreenApp.component user={user} onClose={closeFullscreen} {...fullscreenApp.props} />
        </div>
      )}
    </div>
    </GlobalSettingsProvider>
  );
}
