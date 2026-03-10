import type { CommandDef } from "@/types/terminal";
import { loadApp, listAppNames } from "@/core/appLoader";
import { checkAppAccess, getAppMinRole, triggerAccessDenied } from "@/core/appRestrictions";

const ADMIN_ONLY_APPS = ["admin", "stats"];

export const run: CommandDef = {
  name: "run",
  description: "Run an app from the apps/ directory",
  usage: "run <appname> [args...]",
  category: "apps",
  async run(args, terminal) {
    const appName = args[0];

    if (!appName) {
      const all = listAppNames();
      const names = terminal.user.role === "admin"
        ? all
        : all.filter((n) => !ADMIN_ONLY_APPS.includes(n));
      if (names.length === 0) {
        return { text: "No apps installed." };
      }
      return {
        blocks: [{
          label: "installed apps",
          content: names.map((n) => `  ${n}`).join("\n"),
        }],
      };
    }

    // Permission check for code users
    if (terminal.user.role === "code") {
      const blocked = ["cloud", "mail"];
      if (blocked.includes(appName)) {
        return { text: "access denied. code users can't touch that shit.", isError: true };
      }
      if (terminal.user.permissions && !terminal.user.permissions.includes(appName)) {
        return { text: "access denied. your code doesn't unlock this app, bitch.", isError: true };
      }
    }

    // Role-based app restriction check (configured in admin settings)
    if (!checkAppAccess(appName, terminal.user.role)) {
      const minRole = getAppMinRole(appName) ?? "club";
      triggerAccessDenied(appName, minRole);
      return { text: `${appName} requires ${minRole} membership.`, isError: true };
    }

    const app = await loadApp(appName);
    if (!app) {
      return { text: `run: app '${appName}' not found`, isError: true };
    }

    try {
      const result = await Promise.race([
        Promise.resolve(app.run(args.slice(1), terminal)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("App execution timed out")), 5000)
        ),
      ]);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { text: `run: ${appName}: ${msg}`, isError: true };
    }
  },
};
