import type { CommandDef } from "@/types/terminal";
import { normalizePath, resolvePath } from "@/core/filesystem";
import { getHomePath } from "@/core/utils";

const PROTECTED_PATHS = ["/", "/home", "/etc", "/tmp"];

export const rm: CommandDef = {
  name: "rm",
  description: "Remove a file or empty directory",
  usage: "rm <path>",
  category: "filesystem",
  run(args, terminal) {
    if (!args[0]) return { text: "rm: missing operand", isError: true };

    const raw = args[0];
    const expanded = raw.startsWith("~/")
      ? getHomePath(terminal.user.username) + raw.slice(1)
      : raw;

    const resolved = normalizePath(terminal.cwd, expanded);

    if (PROTECTED_PATHS.includes(resolved)) {
      return { text: `rm: refusing to remove '${raw}': Permission denied`, isError: true };
    }

    if (resolved === terminal.cwd) {
      return { text: `rm: cannot remove '${raw}': You're standing in it, genius`, isError: true };
    }

    const parts = resolved.split("/").filter(Boolean);
    const name = parts[parts.length - 1];
    const parentPath = "/" + parts.slice(0, -1).join("/");

    if (!name) {
      return { text: `rm: cannot remove '${raw}'`, isError: true };
    }

    const parent = resolvePath(terminal.fs, parentPath);
    if (!parent || parent.type !== "directory" || !parent.children) {
      return { text: `rm: cannot remove '${raw}': No such file or directory`, isError: true };
    }

    const target = parent.children[name];
    if (!target) {
      return { text: `rm: cannot remove '${raw}': No such file or directory`, isError: true };
    }

    if (target.type === "directory" && target.children && Object.keys(target.children).length > 0) {
      return { text: `rm: cannot remove '${raw}': Directory not empty`, isError: true };
    }

    delete parent.children[name];
    return { text: "" };
  },
};
