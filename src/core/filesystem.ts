import type { FileSystemNode } from "@/types/terminal";

export function normalizePath(cwd: string, target: string): string {
  const parts = target.startsWith("/")
    ? target.split("/")
    : [...cwd.split("/"), ...target.split("/")];

  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return "/" + resolved.join("/");
}

export function resolvePath(
  root: FileSystemNode,
  absolutePath: string
): FileSystemNode | null {
  if (absolutePath === "/") return root;

  const parts = absolutePath.split("/").filter(Boolean);
  let node: FileSystemNode = root;

  for (const part of parts) {
    if (node.type !== "directory" || !node.children) return null;
    const child = node.children[part];
    if (!child) return null;
    node = child;
  }

  return node;
}

export function createDefaultFS(username: string): FileSystemNode {
  return {
    name: "/",
    type: "directory",
    children: {
      home: {
        name: "home",
        type: "directory",
        children: {
          [username]: {
            name: username,
            type: "directory",
            children: {
              apps: { name: "apps", type: "directory", children: {} },
              documents: {
                name: "documents",
                type: "directory",
                children: {
                  "readme.txt": {
                    name: "readme.txt",
                    type: "file",
                    content:
                      "Welcome to MyNig.ga Terminal.\nType 'help' to see available commands.",
                  },
                },
              },
              config: {
                name: "config",
                type: "directory",
                children: {
                  ".env": {
                    name: ".env",
                    type: "file",
                    content: "TERM=mynigga\nSHELL=/bin/nsh\nLANG=en_US.UTF-8",
                  },
                },
              },
            },
          },
        },
      },
      etc: {
        name: "etc",
        type: "directory",
        children: {
          hostname: {
            name: "hostname",
            type: "file",
            content: "mynigga",
          },
          version: {
            name: "version",
            type: "file",
            content: "1.0.0",
          },
        },
      },
      tmp: { name: "tmp", type: "directory", children: {} },
    },
  };
}
