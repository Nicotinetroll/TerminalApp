import type { CommandDef } from "@/types/terminal";

export const pwd: CommandDef = {
  name: "pwd",
  description: "Print working directory",
  category: "filesystem",
  run(_args, terminal) {
    return { text: terminal.cwd };
  },
};
