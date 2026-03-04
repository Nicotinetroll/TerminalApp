import type { CommandDef } from "@/types/terminal";

export const date: CommandDef = {
  name: "date",
  description: "Show current date and time",
  category: "system",
  run() {
    return { text: new Date().toString() };
  },
};
