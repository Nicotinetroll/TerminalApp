import type { CommandDef } from "@/types/terminal";
import { listAppNames } from "@/core/appLoader";

export const applist: CommandDef = {
  name: "applist",
  description: "List all available apps",
  usage: "applist",
  category: "apps",
  run() {
    const names = listAppNames();

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
