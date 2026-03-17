import { useState, useRef, useEffect } from "react";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { checkAppAccess } from "@/core/appRestrictions";
import { LockIcon } from "@/components/LockIcon";

interface AppDef {
  name: string;
  label: string;
  minRole: string | null;
}

const ALL_APPS: AppDef[] = [
  { name: "mail",     label: "mail",     minRole: "user" },
  { name: "whisper",  label: "whisper",  minRole: "user" },
  { name: "cloud",    label: "cloud",    minRole: "user" },
  { name: "nigdit",   label: "nigdit",   minRole: "user" },
  { name: "memes",    label: "memes",    minRole: null },
  { name: "paste",    label: "paste",    minRole: "user" },
  { name: "profile",  label: "profile",  minRole: "user" },
  { name: "games",    label: "games",    minRole: null },
  { name: "slots",    label: "slots",    minRole: "user" },
  { name: "coinflip", label: "coinflip", minRole: "user" },
  { name: "shortlinks", label: "links",  minRole: "user" },
  { name: "blackjack", label: "blackjack", minRole: "user" },
  { name: "ascii",    label: "ascii",    minRole: null },
  { name: "shop",     label: "shop",     minRole: null },
  { name: "admin",    label: "admin",    minRole: "admin" },
  { name: "stats",    label: "stats",    minRole: "admin" },
];

const ROLE_LEVEL: Record<string, number> = { guest: 0, code: 0, user: 1, classic: 2, club: 3, admin: 4 };
const HIDDEN_FROM_NON_ADMIN = ["admin", "stats"];
const VISIBLE_COUNT = 5;

interface Props {
  onRunApp: (name: string) => void;
  userRole: string;
  badges?: Record<string, number>;
}

export function AppShortcutBar({ onRunApp, userRole, badges = {} }: Props) {
  const { settings, loading } = useGlobalSettings();
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (loading) return null;

  let shortcutNames: string[];
  try {
    const raw = settings["shortcut_apps"];
    shortcutNames = raw ? JSON.parse(raw) as string[] : [];
  } catch {
    shortcutNames = [];
  }

  if (shortcutNames.length === 0) return null;

  const level = ROLE_LEVEL[userRole] ?? 0;
  const isAdmin = userRole === "admin";

  const visible: (AppDef & { locked: boolean })[] = shortcutNames
    .map((name) => ALL_APPS.find((a) => a.name === name))
    .filter((app): app is AppDef => {
      if (!app) return false;
      // Always hide admin/stats from non-admins
      if (!isAdmin && HIDDEN_FROM_NON_ADMIN.includes(app.name)) return false;
      return true;
    })
    .map((app) => {
      // Check both dynamic restrictions and hardcoded minRole
      const hasAccess = checkAppAccess(app.name, userRole) &&
        (!app.minRole || level >= (ROLE_LEVEL[app.minRole] ?? 99));
      return { ...app, locked: !hasAccess };
    });

  if (visible.length === 0) return null;

  const shown = visible.slice(0, VISIBLE_COUNT);
  const overflow = visible.slice(VISIBLE_COUNT);

  return (
    <div className="app-shortcut-bar">
      {shown.map((app) => (
        <button
          key={app.name}
          className={`btn btn-sm${app.locked ? " app-shortcut--locked" : ""}`}
          onClick={() => onRunApp(app.name)}
          type="button"
        >
          {app.locked && <LockIcon size={11} />} {app.label}
          {(badges[app.name] ?? 0) > 0 && (
            <span className="app-badge">{badges[app.name]}</span>
          )}
        </button>
      ))}

      {overflow.length > 0 && (
        <div className="shortcut-more-wrap" ref={dropRef}>
          <button
            className="btn btn-sm"
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            more ▾
          </button>

          {open && (
            <div className="shortcut-more-dropdown">
              {overflow.map((app) => (
                <button
                  key={app.name}
                  className={`shortcut-more-item${app.locked ? " app-shortcut--locked" : ""}`}
                  onClick={() => { onRunApp(app.name); setOpen(false); }}
                  type="button"
                >
                  {app.locked && <LockIcon size={11} />} {app.label}
                  {(badges[app.name] ?? 0) > 0 && (
                    <span className="app-badge">{badges[app.name]}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
