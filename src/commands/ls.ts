import type { CommandDef } from "@/types/terminal";
import { normalizePath, resolvePath } from "@/core/filesystem";
import { getHomePath } from "@/core/utils";

export const ls: CommandDef = {
  name: "ls",
  description: "List directory contents",
  usage: "ls [path]",
  category: "filesystem",
  run(args, terminal) {
    let target = terminal.cwd;

    if (args[0]) {
      const raw = args[0];
      const expanded = raw === "~"
        ? getHomePath(terminal.user.username)
        : raw.startsWith("~/")
          ? getHomePath(terminal.user.username) + raw.slice(1)
          : raw;
      target = normalizePath(terminal.cwd, expanded);
    }

    const node = resolvePath(terminal.fs, target);
    if (!node) return { text: `ls: cannot access '${args[0] ?? target}': No such file or directory`, isError: true };
    if (node.type !== "directory") return { text: node.name, isError: false };

    const entries = Object.values(node.children ?? {});
    if (entries.length === 0) return { text: "" };

    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => (e.type === "directory" ? `${e.name}/` : e.name));

    return { text: lines.join("  ") };
  },
};
