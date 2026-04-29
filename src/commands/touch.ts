import type { CommandDef } from "@/types/terminal";
import { normalizePath, resolvePath } from "@/core/filesystem";
import { isValidFilename } from "@/core/security";
import { getHomePath } from "@/core/utils";

export const touch: CommandDef = {
  name: "touch",
  description: "Create an empty file",
  usage: "touch <filename>",
  category: "filesystem",
  run(args, terminal) {
    if (!args[0]) return { text: "touch: missing file operand", isError: true };

    const raw = args[0];
    const expanded = raw.startsWith("~/")
      ? getHomePath(terminal.user.email) + raw.slice(1)
      : raw;

    // If it contains slashes, we need to resolve parent + name
    const resolved = normalizePath(terminal.cwd, expanded);
    const parts = resolved.split("/").filter(Boolean);
    const name = parts[parts.length - 1];
    const parentPath = "/" + parts.slice(0, -1).join("/");

    if (!name || !isValidFilename(name)) {
      return { text: `touch: invalid filename: ${raw}`, isError: true };
    }

    const parent = resolvePath(terminal.fs, parentPath);
    if (!parent || parent.type !== "directory") {
      return { text: `touch: cannot touch '${raw}': No such directory`, isError: true };
    }

    const existing = parent.children?.[name];
    if (existing?.type === "directory") {
      return { text: `touch: cannot touch '${raw}': Is a directory`, isError: true };
    }

    // File exists → silent success (like real touch)
    if (existing) return { text: "" };

    if (parent.children) {
      parent.children[name] = { name, type: "file", content: "" };
    }

    return { text: "" };
  },
};
