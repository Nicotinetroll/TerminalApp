import { checkAppAccess } from "@/core/appRestrictions";

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
  { name: "admin",    icon: "\u2699", minRole: "admin" },
  { name: "stats",    icon: "\uD83D\uDCCA", minRole: "admin" },
];

const ROLE_LEVEL: Record<string, number> = { guest: 0, code: 0, user: 1, club: 2, admin: 3 };

interface Props {
  onRunApp: (name: string) => void;
  userRole: string;
}

export function MobileAppBar({ onRunApp, userRole }: Props) {
  const level = ROLE_LEVEL[userRole] ?? 0;

  const visible = APPS.filter((app) => {
    // Check dynamic admin restrictions first
    if (!checkAppAccess(app.name, userRole)) return false;
    // Then check hardcoded minRole
    if (!app.minRole) return true;
    return level >= (ROLE_LEVEL[app.minRole] ?? 99);
  });

  return (
    <div className="mobile-app-bar">
      {visible.map((app) => (
        <button
          key={app.name}
          className="mobile-app-btn"
          onClick={() => onRunApp(app.name)}
          type="button"
        >
          <span className="mobile-app-icon">{app.icon}</span>
          <span className="mobile-app-label">{app.name}</span>
        </button>
      ))}
    </div>
  );
}
