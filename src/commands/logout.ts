import type { CommandDef } from "@/types/terminal";

export const logout: CommandDef = {
  name: "logout",
  description: "Return to login screen",
  category: "system",
  async run(_args, terminal) {
    terminal.logout();
    return { text: "" };
  },
};
