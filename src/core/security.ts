const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const MAX_INPUT = 1024;
const MAX_ARGS = 32;

export function sanitizeInput(input: string, maxLength = MAX_INPUT): string {
  if (typeof input !== "string") return "";
  return input.slice(0, maxLength).replace(CONTROL_CHAR_RE, "").trim();
}

export function sanitizeArgs(args: string[], maxCount = MAX_ARGS): string[] {
  return args.slice(0, maxCount).map((a) => sanitizeInput(a, 256));
}

export function isValidFilename(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name === "." || name === "..") return false;
  if (/[/\x00]/.test(name)) return false;
  if (name.startsWith("-")) return false;
  return true;
}

export function isPathSafe(resolved: string, root = "/"): boolean {
  if (!resolved.startsWith(root)) return false;
  if (resolved.includes("\x00")) return false;
  if (resolved.split("/").includes("..")) return false;
  return true;
}
