export function shortenPath(path: string, homePath: string): string {
  if (path === homePath) return "~";
  return path.startsWith(homePath + "/")
    ? "~" + path.slice(homePath.length)
    : path;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural ?? singular + "s"}`;
}

export function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 1) + "…" : str;
}

export function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " ") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
    i++;
  }

  if (current) args.push(current);
  return args;
}

export function getHomePath(username: string): string {
  return `/home/${username}`;
}
