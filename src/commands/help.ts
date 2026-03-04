import type { CommandDef } from "@/types/terminal";
import { getAll, resolve } from "@/core/commandRegistry";

export const help: CommandDef = {
  name: "help",
  description: "List commands or show help for a specific command",
  usage: "help [command]",
  category: "system",
  run(args) {
    if (args[0]) {
      const cmd = resolve(args[0]);
      if (!cmd) return { text: `help: unknown command '${args[0]}'`, isError: true };

      const lines = [`${cmd.name} — ${cmd.description}`];
      if (cmd.usage) lines.push(`  usage: ${cmd.usage}`);
      return { text: lines.join("\n") };
    }

    const grouped: Record<string, CommandDef[]> = {};
    for (const cmd of getAll()) {
      const cat = cmd.category;
      (grouped[cat] ??= []).push(cmd);
    }

    const blocks = Object.entries(grouped).map(([label, cmds]) => ({
      label,
      content: cmds
        .map((c) => `  ${c.name.padEnd(12)} ${c.description}`)
        .join("\n"),
    }));

    return { blocks };
  },
};
