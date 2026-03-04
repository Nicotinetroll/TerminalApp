import type { CommandDef } from "@/types/terminal";

export const echo: CommandDef = {
  name: "echo",
  description: "Print text to terminal",
  usage: "echo <text>",
  category: "system",
  run(args) {
    return { text: args.join(" ") };
  },
};
