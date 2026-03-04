import type { CommandDef } from "@/types/terminal";

export const clear: CommandDef = {
  name: "clear",
  description: "Clear terminal screen",
  category: "system",
  run(_args, terminal) {
    terminal.clearHistory();
    return { text: "" };
  },
};
