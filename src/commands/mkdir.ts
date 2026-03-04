import type { CommandDef } from "@/types/terminal";
import { normalizePath, resolvePath } from "@/core/filesystem";
import { isValidFilename } from "@/core/security";
import { getHomePath } from "@/core/utils";

export const mkdir: CommandDef = {
  name: "mkdir",
  description: "Create a directory",
  usage: "mkdir <name>",
  category: "filesystem",
  run(args, terminal) {
    if (!args[0]) return { text: "mkdir: missing operand", isError: true };

    const name = args[0];
    if (!isValidFilename(name)) {
      return { text: `mkdir: invalid directory name: ${name}`, isError: true };
    }

    const parentPath = terminal.cwd;
    const parent = resolvePath(terminal.fs, parentPath);
    if (!parent || parent.type !== "directory") {
      return { text: "mkdir: cannot create directory here", isError: true };
    }

    if (parent.children?.[name]) {
      return { text: `mkdir: cannot create '${name}': File exists`, isError: true };
    }

    const fullPath = normalizePath(parentPath, name);
    const targetParent = resolvePath(terminal.fs, parentPath);
    if (targetParent?.children) {
      targetParent.children[name] = {
        name,
        type: "directory",
        children: {},
      };
    }

    void fullPath; // used for potential logging
    return { text: "" };
  },
};
