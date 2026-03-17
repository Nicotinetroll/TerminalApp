import { checkAppAccess } from "@/core/appRestrictions";
import { LockIcon } from "@/components/LockIcon";

interface AppDef {
  name: string;
  icon: string;
  minRole: string | null;
}

const APPS: AppDef[] = [
  { name: "mail",     icon: "\u2709", minRole: "user" },
  { name: "whisper",  icon: "\uD83D\uDCAC", minRole: "user" },
  { name: "cloud",    icon: "\u2601", minRole: "user" },
  { name: "profile",  icon: "\uD83D\uDC64", minRole: "user" },
  { name: "games",    icon: "\uD83C\uDFAE", minRole: null },
  { name: "slots",    icon: "\uD83C\uDFB0", minRole: "user" },
  { name: "coinflip", icon: "\uD83E\uDE99", minRole: "user" },
  { name: "shortlinks", icon: "🔗", minRole: "user" },
  { name: "ascii",    icon: "\u2593", minRole: null },
  { name: "shop",     icon: "\uD83D\uDED2", minRole: null },
  { name: "admin",    icon: "\u2699", minRole: "admin" },
  { name: "stats",    icon: "\uD83D\uDCCA", minRole: "admin" },
];

const ROLE_LEVEL: Record<string, number> = { guest: 0, code: 0, user: 1, classic: 2, club: 3, admin: 4 };
const HIDDEN_FROM_NON_ADMIN = ["admin", "stats"];

interface Props {
  onRunApp: (name: string) => void;
  userRole: string;
  badges?: Record<string, number>;
}

export function MobileAppBar({ onRunApp, userRole, badges = {} }: Props) {
  const level = ROLE_LEVEL[userRole] ?? 0;
  const isAdmin = userRole === "admin";

  const visible = APPS
    .filter((app) => {
      // Always hide admin/stats from non-admins
      if (!isAdmin && HIDDEN_FROM_NON_ADMIN.includes(app.name)) return false;
      return true;
    })
    .map((app) => {
      const hasAccess = checkAppAccess(app.name, userRole) &&
        (!app.minRole || level >= (ROLE_LEVEL[app.minRole] ?? 99));
      return { ...app, locked: !hasAccess };
    });

  return (
    <div className="mobile-app-bar">
      {visible.map((app) => (
        <button
          key={app.name}
          className={`mobile-app-btn${app.locked ? " mobile-app-btn--locked" : ""}`}
          onClick={() => onRunApp(app.name)}
          type="button"
        >
          <span className="mobile-app-icon">{app.locked ? <LockIcon size={14} /> : app.icon}</span>
          <span className="mobile-app-label">{app.name}</span>
          {(badges[app.name] ?? 0) > 0 && (
            <span className="app-badge">{badges[app.name]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
