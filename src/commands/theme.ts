import type { CommandDef } from "@/types/terminal";
import { THEMES } from "@/config";

export const theme: CommandDef = {
  name: "theme",
  description: "Change accent color theme",
  usage: "theme <name>",
  category: "system",
  run(args, terminal) {
    const name = args[0];
    if (!name) {
      const available = Object.keys(THEMES).join(", ");
      return { text: `available themes: ${available}` };
    }

    const selected = THEMES[name];
    if (!selected) {
      return { text: `theme: unknown theme '${name}'`, isError: true };
    }

    terminal.setTheme(selected);
    return { text: `theme set to ${name}` };
  },
};
