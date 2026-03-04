import type { CommandDef } from "@/types/terminal";
import { listAppNames } from "@/core/appLoader";

const ADMIN_ONLY_APPS = ["admin", "stats"];

export const applist: CommandDef = {
  name: "applist",
  description: "List all available apps",
  usage: "applist",
  category: "apps",
  run(_args, terminal) {
    const all = listAppNames();
    const names = terminal.user.role === "admin"
      ? all
      : all.filter((n) => !ADMIN_ONLY_APPS.includes(n));

    if (names.length === 0) {
      return { text: "no apps installed. this place is emptier than my will to live." };
    }

    return {
      blocks: [{
        label: `installed apps (${names.length})`,
        content: names.map((n) => `  ${n}`).join("\n") +
          "\n\n  run <appname> to launch one, if you dare.",
      }],
    };
  },
};
