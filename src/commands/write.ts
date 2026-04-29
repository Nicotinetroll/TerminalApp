import type { CommandDef } from "@/types/terminal";
import { normalizePath, resolvePath } from "@/core/filesystem";
import { isValidFilename } from "@/core/security";
import { getHomePath } from "@/core/utils";

export const write: CommandDef = {
  name: "write",
  description: "Write content to a file",
  usage: "write <filename> <content...>",
  category: "filesystem",
  run(args, terminal) {
    if (!args[0]) return { text: "write: missing filename\nusage: write <filename> <content...>", isError: true };
    if (args.length < 2) return { text: "write: missing content\nusage: write <filename> <content...>", isError: true };

    const raw = args[0];
    const content = args.slice(1).join(" ");

    const expanded = raw.startsWith("~/")
      ? getHomePath(terminal.user.email) + raw.slice(1)
      : raw;

    const resolved = normalizePath(terminal.cwd, expanded);
    const parts = resolved.split("/").filter(Boolean);
    const name = parts[parts.length - 1];
    const parentPath = "/" + parts.slice(0, -1).join("/");

    if (!name || !isValidFilename(name)) {
      return { text: `write: invalid filename: ${raw}`, isError: true };
    }

    const parent = resolvePath(terminal.fs, parentPath);
    if (!parent || parent.type !== "directory") {
      return { text: `write: cannot write '${raw}': No such directory`, isError: true };
    }

    const existing = parent.children?.[name];
    if (existing?.type === "directory") {
      return { text: `write: cannot write '${raw}': Is a directory`, isError: true };
    }

    if (parent.children) {
      parent.children[name] = { name, type: "file", content };
    }

    return { text: "" };
  },
};
