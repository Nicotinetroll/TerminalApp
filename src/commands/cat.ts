import type { CommandDef } from "@/types/terminal";
import { normalizePath, resolvePath } from "@/core/filesystem";
import { getHomePath } from "@/core/utils";

export const cat: CommandDef = {
  name: "cat",
  description: "Print file contents",
  usage: "cat <file>",
  category: "filesystem",
  run(args, terminal) {
    if (!args[0]) return { text: "cat: missing operand", isError: true };

    const raw = args[0];
    const expanded = raw.startsWith("~/")
      ? getHomePath(terminal.user.username) + raw.slice(1)
      : raw;
    const resolved = normalizePath(terminal.cwd, expanded);
    const node = resolvePath(terminal.fs, resolved);

    if (!node) return { text: `cat: ${raw}: No such file or directory`, isError: true };
    if (node.type === "directory") return { text: `cat: ${raw}: Is a directory`, isError: true };

    return { text: node.content ?? "" };
  },
};
