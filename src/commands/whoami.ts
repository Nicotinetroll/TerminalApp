import type { CommandDef } from "@/types/terminal";

export const whoami: CommandDef = {
  name: "whoami",
  description: "Show current user",
  category: "system",
  run(_args, terminal) {
    return { text: terminal.user.email };
  },
};
