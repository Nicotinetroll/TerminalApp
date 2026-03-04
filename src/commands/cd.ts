import type { CommandDef } from "@/types/terminal";
import { normalizePath, resolvePath } from "@/core/filesystem";
import { isPathSafe } from "@/core/security";
import { getHomePath } from "@/core/utils";

export const cd: CommandDef = {
  name: "cd",
  description: "Change working directory",
  usage: "cd <path>",
  category: "filesystem",
  run(args, terminal) {
    const raw = args[0] ?? "~";
    const target = raw === "~"
      ? getHomePath(terminal.user.username)
      : raw.startsWith("~/")
        ? getHomePath(terminal.user.username) + raw.slice(1)
        : raw;

    const resolved = normalizePath(terminal.cwd, target);

    if (!isPathSafe(resolved)) {
      return { text: `cd: invalid path: ${raw}`, isError: true };
    }

    const node = resolvePath(terminal.fs, resolved);
    if (!node) return { text: `cd: no such directory: ${raw}`, isError: true };
    if (node.type !== "directory") return { text: `cd: not a directory: ${raw}`, isError: true };

    terminal.setCwd(resolved);
    return { text: "" };
  },
};
