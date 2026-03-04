import type { CommandDef } from "@/types/terminal";

const commands = new Map<string, CommandDef>();

export function register(cmd: CommandDef) {
  commands.set(cmd.name, cmd);
}

export function resolve(name: string): CommandDef | undefined {
  return commands.get(name);
}

export function getAll(): CommandDef[] {
  return Array.from(commands.values());
}

export function getByCategory(category: string): CommandDef[] {
  return getAll().filter((c) => c.category === category);
}

export function getCommandNames(): string[] {
  return Array.from(commands.keys());
}
