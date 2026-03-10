import type { FileSystemNode } from "@/types/terminal";
import { getAll, getCommandNames } from "./commandRegistry";
import { normalizePath, resolvePath } from "./filesystem";
import { listAppNames } from "./appLoader";
import { THEMES } from "@/config";

export interface Suggestion {
  value: string;
  label: string;
  description: string;
  category?: string;
}

/**
 * Get command-level suggestions (first word).
 */
export function getCommandSuggestions(partial: string): Suggestion[] {
  if (!partial) {
    return getAll().map((c) => ({
      value: c.name,
      label: c.name,
      description: c.description,
      category: c.category,
    }));
  }
  return getAll()
    .filter((c) => c.name.startsWith(partial))
    .map((c) => ({
      value: c.name,
      label: c.name,
      description: c.description,
      category: c.category,
    }));
}

/**
 * Get argument-level suggestions based on which command is being typed.
 */
const ADMIN_ONLY_APPS = ["admin", "stats"];

export function getArgSuggestions(
  cmdName: string,
  partial: string,
  fs: FileSystemNode,
  cwd: string,
  username: string,
  role = "user"
): Suggestion[] {
  switch (cmdName) {
    case "theme":
      return Object.keys(THEMES)
        .filter((t) => t.startsWith(partial))
        .map((t) => ({
          value: t,
          label: t,
          description: THEMES[t]!.accent,
          category: "theme",
        }));

    case "cd":
      return getPathSuggestions(partial, fs, cwd, username, "directory");

    case "ls":
      return getPathSuggestions(partial, fs, cwd, username, "all");

    case "cat":
    case "touch":
    case "write":
      return getPathSuggestions(partial, fs, cwd, username, "file");

    case "rm":
      return getPathSuggestions(partial, fs, cwd, username, "all");

    case "mkdir":
      return getPathSuggestions(partial, fs, cwd, username, "directory");

    case "help":
      return getCommandNames()
        .filter((n) => n.startsWith(partial))
        .map((n) => {
          const cmd = getAll().find((c) => c.name === n);
          return {
            value: n,
            label: n,
            description: cmd?.description ?? "",
            category: "command",
          };
        });

    case "run": {
      const apps = listAppNames()
        .filter((n) => role === "admin" ? true : !ADMIN_ONLY_APPS.includes(n))
        .filter((n) => n.startsWith(partial));
      return apps.map((n) => ({
        value: n,
        label: n,
        description: "app",
        category: "app",
      }));
    }

    default:
      return [];
  }
}

function getPathSuggestions(
  partial: string,
  fs: FileSystemNode,
  cwd: string,
  _username: string,
  filter: "directory" | "file" | "all"
): Suggestion[] {
  // Determine the directory to list and the prefix typed
  let dirPath: string;
  let prefix: string;

  if (partial.includes("/")) {
    const lastSlash = partial.lastIndexOf("/");
    const pathPart = partial.slice(0, lastSlash) || "/";
    prefix = partial.slice(lastSlash + 1);
    dirPath = normalizePath(cwd, pathPart);
  } else {
    dirPath = cwd;
    prefix = partial;
  }

  const node = resolvePath(fs, dirPath);
  if (!node || node.type !== "directory" || !node.children) return [];

  return Object.values(node.children)
    .filter((child) => {
      if (filter === "directory" && child.type !== "directory") return false;
      if (filter === "file" && child.type !== "file") return false;
      return child.name.startsWith(prefix);
    })
    .map((child) => {
      const isDir = child.type === "directory";
      // Reconstruct the full value to put back in input
      let value: string;
      if (partial.includes("/")) {
        const lastSlash = partial.lastIndexOf("/");
        value = partial.slice(0, lastSlash + 1) + child.name + (isDir ? "/" : "");
      } else {
        value = child.name + (isDir ? "/" : "");
      }

      return {
        value,
        label: child.name + (isDir ? "/" : ""),
        description: isDir ? "directory" : "file",
        category: isDir ? "dir" : "file",
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
