import { useGlobalSettings } from "@/hooks/useGlobalSettings";

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
  { name: "ascii",    label: "ascii",    minRole: null },
  { name: "admin",    label: "admin",    minRole: "admin" },
  { name: "stats",    label: "stats",    minRole: "admin" },
];

const ROLE_LEVEL: Record<string, number> = { guest: 0, code: 0, user: 1, admin: 2 };

interface Props {
  onRunApp: (name: string) => void;
  userRole: string;
}

export function AppShortcutBar({ onRunApp, userRole }: Props) {
  const { settings, loading } = useGlobalSettings();

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

  const visible = shortcutNames
    .map((name) => ALL_APPS.find((a) => a.name === name))
    .filter((app): app is AppDef => {
      if (!app) return false;
      if (!app.minRole) return true;
      return level >= (ROLE_LEVEL[app.minRole] ?? 99);
    });

  if (visible.length === 0) return null;

  return (
    <div className="app-shortcut-bar">
      {visible.map((app) => (
        <button
          key={app.name}
          className="btn btn-sm"
          onClick={() => onRunApp(app.name)}
          type="button"
        >
          {app.label}
        </button>
      ))}
    </div>
  );
}
