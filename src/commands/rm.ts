import type { CommandDef } from "@/types/terminal";
import { normalizePath, resolvePath } from "@/core/filesystem";
import { getHomePath } from "@/core/utils";

const PROTECTED_PATHS = ["/", "/home", "/etc", "/tmp"];

const RM_RF_LINES = [
  "Removing /bin/bash... done",
  "Removing /etc/passwd... done",
  "Removing /usr/lib/libc.so... done",
  "Removing /boot/vmlinuz... done",
  "Removing /var/log/syslog... done",
  "Removing /home/*... done",
  "Removing /dev/null... wait what",
  "Removing /dev/brain... not found (as expected)",
  "Removing /root/.ssh/... nice try FBI",
  "Removing literally everything...",
  "",
  "█▓▒░ SYSTEM DESTROYED ░▒▓█",
  "",
  "...just kidding. this is a browser, you absolute psychopath.",
  "nothing was harmed. except maybe your dignity.",
];

export const rm: CommandDef = {
  name: "rm",
  description: "Remove a file or empty directory",
  usage: "rm <path>",
  category: "filesystem",
  run(args, terminal) {
    if (!args[0]) return { text: "rm: missing operand", isError: true };

    // Easter egg: rm -rf /
    const joined = args.join(" ");
    if (joined.includes("-rf") && (joined.includes(" /") || joined.endsWith("/"))) {
      const hasRoot = args.some(a => a === "/" || a === "/*");
      const hasRf = args.some(a => a.includes("rf") || a.includes("fr"));
      if (hasRoot && hasRf) {
        return { text: RM_RF_LINES.join("\n") };
      }
    }

    const raw = args[0];
    const expanded = raw.startsWith("~/")
      ? getHomePath(terminal.user.email) + raw.slice(1)
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
