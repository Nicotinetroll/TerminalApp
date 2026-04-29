import { useState, useRef, useEffect } from "react";
import { checkAppAccess } from "@/core/appRestrictions";
import { LockIcon } from "@/components/LockIcon";

interface AppDef {
  name: string;
  label: string;
  minRole: string | null;
}

const NAV_APPS: AppDef[] = [
  { name: "profile",    label: "profile",    minRole: "user" },
  { name: "paste",      label: "paste",      minRole: "user" },
  { name: "shortlinks", label: "links",      minRole: "user" },
  { name: "transfers",  label: "transfers",  minRole: "basic" },
  { name: "shop",       label: "shop",       minRole: null },
  { name: "downloader", label: "downloader", minRole: "user" },
  { name: "admin",      label: "admin",      minRole: "admin" },
  { name: "stats",      label: "stats",      minRole: "admin" },
];

const ROLE_LEVEL: Record<string, number> = { user: 1, basic: 2, premium: 3, admin: 4 };
const HIDDEN_FROM_NON_ADMIN = ["admin", "stats"];

interface Props {
  onRunApp: (name: string) => void;
  onLogout: () => void;
  username: string;
  userRole: string;
  badges?: Record<string, number>;
  onTogglePalette: () => void;
}

export function Navbar({ onRunApp, onLogout, username, userRole, badges = {}, onTogglePalette }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const level = ROLE_LEVEL[userRole] ?? 0;
  const isAdmin = userRole === "admin";

  // Close mobile menu on outside click
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mobileOpen]);

  const apps = NAV_APPS
    .filter((app) => {
      if (!isAdmin && HIDDEN_FROM_NON_ADMIN.includes(app.name)) return false;
      return true;
    })
    .map((app) => {
      const hasAccess = checkAppAccess(app.name, userRole) &&
        (!app.minRole || level >= (ROLE_LEVEL[app.minRole] ?? 99));
      return { ...app, locked: !hasAccess };
    });

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <span className="navbar-logo glow-text theme-transition">MyNigga</span>
        <div className="navbar-links">
          {apps.map((app) => (
            <button
              key={app.name}
              className={`navbar-link${app.locked ? " navbar-link--locked" : ""}`}
              onClick={() => onRunApp(app.name)}
              type="button"
              data-has-badge={(badges[app.name] ?? 0) > 0 ? "true" : undefined}
            >
              {app.locked && <LockIcon size={10} />}
              {app.label}
              {(badges[app.name] ?? 0) > 0 && (
                <span className="navbar-badge">{badges[app.name]}</span>
              )}
            </button>
          ))}
          <button className="navbar-link navbar-link--kbd" onClick={onTogglePalette} type="button" title="Ctrl+K">
            /
          </button>
        </div>
      </div>

      <div className="navbar-right">
        <button className="navbar-user" onClick={() => onRunApp("profile")} type="button">{username}</button>
        <button className="navbar-logout" onClick={onLogout} type="button">logout</button>
      </div>

      {/* Mobile burger */}
      <button
        className="navbar-burger"
        onClick={() => setMobileOpen((v) => !v)}
        type="button"
        aria-label="Menu"
      >
        {mobileOpen ? "\u2715" : "\u2630"}
      </button>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="navbar-mobile-menu" ref={menuRef}>
          {apps.map((app) => (
            <button
              key={app.name}
              className={`navbar-mobile-item${app.locked ? " navbar-link--locked" : ""}`}
              onClick={() => { onRunApp(app.name); setMobileOpen(false); }}
              type="button"
            >
              {app.locked && <LockIcon size={10} />}
              {app.label}
              {(badges[app.name] ?? 0) > 0 && (
                <span className="navbar-badge">{badges[app.name]}</span>
              )}
            </button>
          ))}
          <div className="navbar-mobile-divider" />
          <button className="navbar-mobile-item" onClick={() => { onRunApp("profile"); setMobileOpen(false); }} type="button">
            <span className="navbar-live-dot" />
            {username}
          </button>
          <button className="navbar-mobile-item" onClick={() => { onLogout(); setMobileOpen(false); }} type="button">
            logout
          </button>
        </div>
      )}
    </nav>
  );
}
